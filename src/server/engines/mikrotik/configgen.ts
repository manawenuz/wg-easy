import type { Client } from '../types';
import type { InterfaceType } from '#db/repositories/interface/types';

export type ApiOp =
  | { action: 'add'; path: string; params: Record<string, string | number | boolean> }
  | { action: 'set'; path: string; id: string; params: Record<string, string | number | boolean> }
  | { action: 'remove'; path: string; id: string };

function peerComment(peer: Client): string {
  return `${peer.id}:${peer.name}`;
}

function peerAllowedAddress(peer: Client, enableIpv6: boolean): string {
  const parts = [`${peer.ipv4Address}/32`];
  if (enableIpv6) {
    parts.push(`${peer.ipv6Address}/128`);
  }
  return parts.join(',');
}

export function generatePeerParams(
  iface: InterfaceType,
  peer: Client,
  enableIpv6: boolean
): Record<string, string | number | boolean> {
  return {
    interface: iface.name,
    'public-key': peer.publicKey,
    'allowed-address': peerAllowedAddress(peer, enableIpv6),
    'preshared-key': peer.preSharedKey,
    comment: peerComment(peer),
    disabled: peer.enabled ? 'no' : 'yes',
  };
}

export function diffPeers(
  iface: InterfaceType,
  desired: Client[],
  actual: Array<Record<string, unknown>>,
  enableIpv6: boolean
): ApiOp[] {
  const ops: ApiOp[] = [];
  const path = '/interface/wireguard/peers';

  // Map existing peers by comment (client_id:name)
  const existingByComment = new Map<string, { id: string; row: Record<string, unknown> }>();
  for (const row of actual) {
    const comment = String(row.comment ?? '');
    const mikrotikId = String(row['.id'] ?? row.id ?? '');
    if (comment && mikrotikId) {
      existingByComment.set(comment, { id: mikrotikId, row });
    }
  }

  const desiredComments = new Set<string>();

  for (const peer of desired) {
    const comment = peerComment(peer);
    desiredComments.add(comment);
    const params = generatePeerParams(iface, peer, enableIpv6);
    const existing = existingByComment.get(comment);

    if (!existing) {
      ops.push({ action: 'add', path, params });
    } else {
      // Check if update needed by comparing key fields
      const row = existing.row;
      const needsUpdate =
        String(row['public-key'] ?? row.publicKey ?? '') !== peer.publicKey ||
        String(row['allowed-address'] ?? row.allowedAddress ?? '') !==
          String(params['allowed-address']) ||
        String(row['preshared-key'] ?? row.presharedKey ?? '') !== peer.preSharedKey ||
        String(row.disabled ?? 'no') !== String(params.disabled);

      if (needsUpdate) {
        ops.push({ action: 'set', path, id: existing.id, params });
      }
    }
  }

  // Remove peers that we manage but are no longer desired
  for (const [comment, existing] of existingByComment) {
    if (!desiredComments.has(comment)) {
      ops.push({ action: 'remove', path, id: existing.id });
    }
  }

  return ops;
}

export const configgen = {
  generatePeerParams,
  diffPeers,
};
