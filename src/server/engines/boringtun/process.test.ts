import { EventEmitter } from 'events';
import { spawn } from 'child_process';
import { createConnection } from 'net';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  BoringtunProcessManager,
  uapiSet,
  uapiGet,
  parseUapiGet,
} from './process';

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return {
    ...actual,
    spawn: vi.fn(),
  };
});

vi.mock('net', async (importOriginal) => {
  const actual = await importOriginal<typeof import('net')>();
  return {
    ...actual,
    createConnection: vi.fn(),
  };
});

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  access: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../utils/cmd', () => ({
  exec: vi.fn().mockResolvedValue(''),
}));

describe('BoringtunProcessManager', () => {
  let manager: BoringtunProcessManager;
  let mockProc: EventEmitter & {
    pid: number;
    exitCode: null | number;
    kill: ReturnType<typeof vi.fn>;
    removeAllListeners: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    manager = new BoringtunProcessManager();

    mockProc = Object.assign(new EventEmitter(), {
      pid: 1234,
      exitCode: null,
      kill: vi.fn(),
      removeAllListeners: vi.fn(),
    });

    vi.mocked(spawn).mockReturnValue(mockProc as unknown as ReturnType<typeof spawn>);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('starts boringtun-cli and waits for socket', async () => {
    const startPromise = manager.start('wg0');
    await vi.advanceTimersByTimeAsync(200);
    await startPromise;

    expect(spawn).toHaveBeenCalledWith(
      'boringtun-cli',
      ['wg0'],
      {
        detached: false,
        stdio: ['ignore', 'ignore', 'ignore'],
      }
    );
    expect(manager.isRunning('wg0')).toBe(true);
  });

  it('stops boringtun-cli and removes from tracking', async () => {
    manager['processes'].set('wg0', mockProc as unknown as ReturnType<typeof spawn>);
    await manager.stop('wg0');

    expect(mockProc.removeAllListeners).toHaveBeenCalledWith('exit');
    expect(mockProc.kill).toHaveBeenCalledWith('SIGTERM');
    expect(manager.isRunning('wg0')).toBe(false);
  });

  it('restarts on crash up to max restarts', async () => {
    const { access } = await import('node:fs/promises');
    vi.mocked(access)
      .mockRejectedValueOnce(new Error('not found'))
      .mockResolvedValue(undefined);

    const startPromise = manager.start('wg0');
    await vi.advanceTimersByTimeAsync(200);
    await startPromise;

    // Simulate crash
    mockProc.exitCode = 1;
    mockProc.emit('exit', 1, null);

    await vi.advanceTimersByTimeAsync(200);

    // Should have spawned a second time (restart)
    expect(spawn).toHaveBeenCalledTimes(2);
  });
});

describe('UAPI client', () => {
  let mockSocket: EventEmitter & {
    write: ReturnType<typeof vi.fn>;
    end: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
    setTimeout: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockSocket = Object.assign(new EventEmitter(), {
      write: vi.fn(),
      end: vi.fn(),
      destroy: vi.fn(),
      setTimeout: vi.fn(),
    });

    vi.mocked(createConnection).mockReturnValue(mockSocket as unknown as ReturnType<typeof createConnection>);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('uapiSet sends config and checks errno=0', async () => {
    const promise = uapiSet('/var/run/wireguard/wg0.sock', 'private_key=abc');

    mockSocket.emit('connect');
    mockSocket.emit('data', Buffer.from('errno=0\n\n'));
    mockSocket.emit('end');

    await promise;

    expect(mockSocket.write).toHaveBeenCalledWith('private_key=abc\n');
  });

  it('uapiSet throws on error response', async () => {
    const promise = uapiSet('/var/run/wireguard/wg0.sock', 'private_key=abc');

    mockSocket.emit('connect');
    mockSocket.emit('data', Buffer.from('errno=22\n\n'));
    mockSocket.emit('end');

    await expect(promise).rejects.toThrow('UAPI set failed');
  });

  it('uapiGet sends get=1 and returns response', async () => {
    const promise = uapiGet('/var/run/wireguard/wg0.sock');

    mockSocket.emit('connect');
    mockSocket.emit(
      'data',
      Buffer.from('private_key=secret\nlisten_port=51820\n\n')
    );
    mockSocket.emit('end');

    const response = await promise;
    expect(response).toContain('private_key=secret');
    expect(mockSocket.write).toHaveBeenCalledWith('get=1\n\n');
  });

  it('parseUapiGet extracts peer usage samples', () => {
    const response =
      'private_key=secret\n' +
      'listen_port=51820\n' +
      'public_key=peer1\n' +
      'rx_bytes=100\n' +
      'tx_bytes=200\n' +
      'last_handshake_time_sec=1710000000\n' +
      'endpoint=1.2.3.4:51820\n' +
      'public_key=peer2\n' +
      'rx_bytes=0\n' +
      'tx_bytes=0\n' +
      'last_handshake_time_sec=0\n' +
      'endpoint=(none)\n' +
      '\n';

    const samples = parseUapiGet(response);

    expect(samples).toHaveLength(2);
    expect(samples[0]).toMatchObject({
      publicKey: 'peer1',
      rxBytes: 100n,
      txBytes: 200n,
      lastHandshakeAt: new Date(1710000000000),
      endpoint: '1.2.3.4:51820',
    });
    expect(samples[1]).toMatchObject({
      publicKey: 'peer2',
      rxBytes: 0n,
      txBytes: 0n,
      lastHandshakeAt: null,
      endpoint: null,
    });
  });
});
