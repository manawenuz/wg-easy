import { EventEmitter } from 'events';
import { spawn } from 'child_process';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BoringtunProcessManager } from './process';

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return { ...actual, spawn: vi.fn() };
});

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  access: vi.fn().mockResolvedValue(undefined),
  unlink: vi.fn().mockResolvedValue(undefined),
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
    await vi.advanceTimersByTimeAsync(400);
    await startPromise;

    expect(spawn).toHaveBeenCalledWith(
      'boringtun-cli',
      ['--disable-drop-privileges', 'wg0'],
      { detached: false, stdio: ['ignore', 'ignore', 'ignore'] }
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
    await vi.advanceTimersByTimeAsync(400);
    await startPromise;

    // Simulate crash (non-zero exit = not daemonization)
    mockProc.exitCode = 1;
    mockProc.emit('exit', 1, null);

    await vi.advanceTimersByTimeAsync(500);

    // Should have spawned a second time (restart)
    expect(spawn).toHaveBeenCalledTimes(2);
  });
});
