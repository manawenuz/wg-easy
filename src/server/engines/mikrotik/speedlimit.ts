import type { RouterOsSshTransport } from '../../transports/routeros-ssh';
import type { RouterOsApiTransport } from '../../transports/routeros-api';
import type { Client } from '../types';

type RouterOsTransport = RouterOsSshTransport | RouterOsApiTransport;

function queueUpName(clientId: ID): string {
  return `wg-${clientId}-up`;
}

function queueDownName(clientId: ID): string {
  return `wg-${clientId}-down`;
}

function packetMarkUp(clientId: ID): string {
  return `wg-${clientId}-up`;
}

function packetMarkDown(clientId: ID): string {
  return `wg-${clientId}-down`;
}

export async function applySpeedLimit(
  transport: RouterOsTransport,
  peer: Client,
  upKbps: number,
  downKbps: number
): Promise<void> {
  const clientId = peer.id;
  const ipv4 = peer.ipv4Address;
  const upName = queueUpName(clientId);
  const downName = queueDownName(clientId);
  const markUp = packetMarkUp(clientId);
  const markDown = packetMarkDown(clientId);

  // Remove existing entries first to ensure idempotency
  await clearSpeedLimit(transport, peer);

  // Add mangle rules
  await transport.write('/ip/firewall/mangle', {
    chain: 'forward',
    'src-address': `${ipv4}/32`,
    action: 'mark-packet',
    'new-packet-mark': markUp,
    comment: upName,
    disabled: 'no',
  });

  await transport.write('/ip/firewall/mangle', {
    chain: 'forward',
    'dst-address': `${ipv4}/32`,
    action: 'mark-packet',
    'new-packet-mark': markDown,
    comment: downName,
    disabled: 'no',
  });

  // Add queue tree entries
  await transport.write('/queue/tree', {
    name: upName,
    parent: 'global',
    'packet-mark': markUp,
    'max-limit': `${upKbps}k`,
    comment: upName,
    disabled: 'no',
  });

  await transport.write('/queue/tree', {
    name: downName,
    parent: 'global',
    'packet-mark': markDown,
    'max-limit': `${downKbps}k`,
    comment: downName,
    disabled: 'no',
  });
}

export async function clearSpeedLimit(transport: RouterOsTransport, peer: Client): Promise<void> {
  const clientId = peer.id;
  const upName = queueUpName(clientId);
  const downName = queueDownName(clientId);

  // Find and remove queue tree entries by name
  const queues = await transport.print('/queue/tree');
  for (const row of queues) {
    const name = String(row.name ?? '');
    if (name === upName || name === downName) {
      const id = String(row['.id'] ?? row.id ?? '');
      if (id) {
        await transport.remove('/queue/tree', id);
      }
    }
  }

  // Find and remove mangle entries by comment
  const mangles = await transport.print('/ip/firewall/mangle');
  for (const row of mangles) {
    const comment = String(row.comment ?? '');
    if (comment === upName || comment === downName) {
      const id = String(row['.id'] ?? row.id ?? '');
      if (id) {
        await transport.remove('/ip/firewall/mangle', id);
      }
    }
  }
}

export const speedlimit = {
  applySpeedLimit,
  clearSpeedLimit,
};
