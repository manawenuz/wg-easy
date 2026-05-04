import type { Client } from '../types';
import type { InterfaceType } from '#db/repositories/interface/types';

interface Transport {
  exec(cmd: string): Promise<{ stdout: string; stderr: string }>;
}

const IFB_MTU = 9000;

function classIdFor(clientId: ID): number {
  // Keep classid in tc-friendly range (2-65535)
  return (Number(clientId) % 0xFFFE) + 2;
}

async function setupIfb(
  transport: Transport,
  ifaceName: string
): Promise<void> {
  const ifbName = `ifb-${ifaceName}`;

  // Try to create the ifb device; ignore errors if it already exists
  await transport.exec(
    `ip link add ${ifbName} type ifb 2>/dev/null || true`
  );
  await transport.exec(`ip link set ${ifbName} up 2>/dev/null || true`);

  // Set up HTB qdisc on the ifb device
  await transport.exec(
    `tc qdisc add dev ${ifbName} root handle 1: htb default 9999 2>/dev/null || true`
  );
  await transport.exec(
    `tc class add dev ${ifbName} parent 1: classid 1:1 htb rate 10gbit 2>/dev/null || true`
  );
}

export async function applySpeedLimit(
  transport: Transport,
  iface: InterfaceType,
  peer: Client,
  upKbps: number,
  downKbps: number
): Promise<void> {
  const ifaceName = iface.name;
  const ifbName = `ifb-${ifaceName}`;
  const classId = classIdFor(peer.id);
  const hexId = classId.toString(16);

  // Setup egress (download) qdisc on the WG interface
  await transport.exec(
    `tc qdisc add dev ${ifaceName} root handle 1: htb default 9999 2>/dev/null || true`
  );
  await transport.exec(
    `tc class add dev ${ifaceName} parent 1: classid 1:1 htb rate 10gbit 2>/dev/null || true`
  );

  // Egress shaping (download from client's perspective) — skip if unlimited
  if (downKbps > 0) {
    await transport.exec(
      `tc class add dev ${ifaceName} parent 1:1 classid 1:${hexId} htb rate ${downKbps}kbit ceil ${downKbps}kbit 2>/dev/null || tc class change dev ${ifaceName} parent 1:1 classid 1:${hexId} htb rate ${downKbps}kbit ceil ${downKbps}kbit`
    );
    await transport.exec(
      `tc filter add dev ${ifaceName} protocol ip parent 1: prio 1 u32 match ip dst ${peer.ipv4Address}/32 flowid 1:${hexId} 2>/dev/null || true`
    );
  }

  // Setup ingress redirect to ifb for upload shaping
  await transport.exec(
    `tc qdisc add dev ${ifaceName} handle ffff: ingress 2>/dev/null || true`
  );

  // Setup ifb device and redirect ingress traffic
  await setupIfb(transport, ifaceName);

  // Redirect ingress (upload) traffic to ifb — skip if upload is unlimited
  if (upKbps > 0) {
    await transport.exec(
      `tc filter add dev ${ifaceName} parent ffff: protocol ip u32 match ip src ${peer.ipv4Address}/32 action mirred egress redirect dev ${ifbName} 2>/dev/null || true`
    );

    // Shape upload traffic on the ifb device
    await transport.exec(
      `tc class add dev ${ifbName} parent 1:1 classid 1:${hexId} htb rate ${upKbps}kbit ceil ${upKbps}kbit 2>/dev/null || tc class change dev ${ifbName} parent 1:1 classid 1:${hexId} htb rate ${upKbps}kbit ceil ${upKbps}kbit`
    );
    await transport.exec(
      `tc filter add dev ${ifbName} protocol ip parent 1: prio 1 u32 match ip src ${peer.ipv4Address}/32 flowid 1:${hexId} 2>/dev/null || true`
    );
  }
}

export async function clearSpeedLimit(
  transport: Transport,
  iface: InterfaceType,
  peer: Client
): Promise<void> {
  const ifaceName = iface.name;
  const ifbName = `ifb-${ifaceName}`;
  const classId = classIdFor(peer.id);
  const hexId = classId.toString(16);

  // Remove egress filters and class
  await transport.exec(
    `tc filter del dev ${ifaceName} protocol ip parent 1: prio 1 u32 match ip dst ${peer.ipv4Address}/32 2>/dev/null || true`
  );
  await transport.exec(
    `tc class del dev ${ifaceName} classid 1:${hexId} 2>/dev/null || true`
  );

  // Remove ingress redirect filter
  await transport.exec(
    `tc filter del dev ${ifaceName} parent ffff: protocol ip u32 match ip src ${peer.ipv4Address}/32 2>/dev/null || true`
  );

  // Remove ifb filters and class
  await transport.exec(
    `tc filter del dev ${ifbName} protocol ip parent 1: prio 1 u32 match ip src ${peer.ipv4Address}/32 2>/dev/null || true`
  );
  await transport.exec(
    `tc class del dev ${ifbName} classid 1:${hexId} 2>/dev/null || true`
  );
}

export async function teardownSpeedLimits(
  transport: Transport,
  ifaceName: string
): Promise<void> {
  const ifbName = `ifb-${ifaceName}`;

  await transport.exec(
    `tc qdisc del dev ${ifaceName} root 2>/dev/null || true`
  );
  await transport.exec(
    `tc qdisc del dev ${ifaceName} ingress 2>/dev/null || true`
  );
  await transport.exec(
    `tc qdisc del dev ${ifbName} root 2>/dev/null || true`
  );
  await transport.exec(
    `ip link del ${ifbName} 2>/dev/null || true`
  );
}
