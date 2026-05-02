import { describe, it, expect, vi } from 'vitest';
import { applySpeedLimit, clearSpeedLimit, teardownSpeedLimits } from './speedlimit';
import type { LocalShellTransport } from '../../transports/local-shell';
import type { InterfaceType } from '#db/repositories/interface/types';
import type { Client } from '../types';

describe('wireguard/speedlimit', () => {
  function mockTransport() {
    const commands: string[] = [];
    return {
      transport: {
        exec: vi.fn(async (cmd: string) => {
          commands.push(cmd);
          return { stdout: '', stderr: '', exitCode: 0 };
        }),
      } as unknown as LocalShellTransport,
      commands,
    };
  }

  const mockIface = { name: 'wg0' } as InterfaceType;
  const mockPeer = { id: 42, ipv4Address: '10.8.0.5', publicKey: 'abc123' } as Client;

  it('applySpeedLimit sends expected tc commands', async () => {
    const { transport, commands } = mockTransport();

    await applySpeedLimit(transport, mockIface, mockPeer, 512, 1024);

    expect(commands).toContain('tc qdisc add dev wg0 root handle 1: htb default 9999 2>/dev/null || true');
    expect(commands).toContain('tc class add dev wg0 parent 1:1 classid 1:2c htb rate 1024kbit ceil 1024kbit 2>/dev/null || tc class change dev wg0 parent 1:1 classid 1:2c htb rate 1024kbit ceil 1024kbit');
    expect(commands).toContain('tc filter add dev wg0 protocol ip parent 1: prio 1 u32 match ip dst 10.8.0.5/32 flowid 1:2c 2>/dev/null || true');
    expect(commands).toContain('tc filter add dev wg0 parent ffff: protocol ip u32 match ip src 10.8.0.5/32 action mirred egress redirect dev ifb-wg0 2>/dev/null || true');
    expect(commands).toContain('tc class add dev ifb-wg0 parent 1:1 classid 1:2c htb rate 512kbit ceil 512kbit 2>/dev/null || tc class change dev ifb-wg0 parent 1:1 classid 1:2c htb rate 512kbit ceil 512kbit');
  });

  it('clearSpeedLimit sends expected cleanup commands', async () => {
    const { transport, commands } = mockTransport();

    await clearSpeedLimit(transport, mockIface, mockPeer);

    expect(commands).toContain('tc filter del dev wg0 protocol ip parent 1: prio 1 u32 match ip dst 10.8.0.5/32 2>/dev/null || true');
    expect(commands).toContain('tc class del dev wg0 classid 1:2c 2>/dev/null || true');
    expect(commands).toContain('tc filter del dev wg0 parent ffff: protocol ip u32 match ip src 10.8.0.5/32 2>/dev/null || true');
    expect(commands).toContain('tc filter del dev ifb-wg0 protocol ip parent 1: prio 1 u32 match ip src 10.8.0.5/32 2>/dev/null || true');
    expect(commands).toContain('tc class del dev ifb-wg0 classid 1:2c 2>/dev/null || true');
  });

  it('teardownSpeedLimits removes all qdiscs and ifb', async () => {
    const { transport, commands } = mockTransport();

    await teardownSpeedLimits(transport, 'wg0');

    expect(commands).toContain('tc qdisc del dev wg0 root 2>/dev/null || true');
    expect(commands).toContain('tc qdisc del dev wg0 ingress 2>/dev/null || true');
    expect(commands).toContain('tc qdisc del dev ifb-wg0 root 2>/dev/null || true');
    expect(commands).toContain('ip link del ifb-wg0 2>/dev/null || true');
  });
});
