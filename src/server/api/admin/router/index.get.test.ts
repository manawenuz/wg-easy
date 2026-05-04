import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

describe('admin/router/index.get', () => {
  type Handler = (event: {
    context: { principal: unknown };
  }) => Promise<unknown>;

  beforeAll(() => {
    vi.stubGlobal('defineEventHandler', vi.fn((fn: unknown) => fn));
    vi.stubGlobal('requirePermission', vi.fn(async () => {}));
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('Database', {
      routers: {
        getAll: vi.fn(async () => [
          {
            id: 1,
            name: 'router-1',
            host: '192.168.1.1',
            port: 8729,
            engineType: 'mikrotik',
            transport: 'routeros-api',
            credentialsEncrypted: 'secret-ciphertext',
            sshPassphraseEncrypted: 'secret-passphrase',
            enabled: true,
            lastSeen: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          {
            id: 2,
            name: 'router-2',
            host: '192.168.1.2',
            port: 22,
            engineType: 'mikrotik',
            transport: 'ssh',
            credentialsEncrypted: 'another-secret',
            sshPassphraseEncrypted: null,
            enabled: false,
            lastSeen: new Date(),
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ]),
      },
    });
  });

  it('returns all routers with credentials stripped', async () => {
    const handler = (await import('./index.get')).default as Handler;
    const result = (await handler({ context: { principal: {} } })) as Array<{
      id: number;
      name: string;
      credentialsEncrypted?: string;
      sshPassphraseEncrypted?: string;
    }>;

    expect(result).toHaveLength(2);
    expect(result[0]!.id).toBe(1);
    expect(result[0]!.name).toBe('router-1');
    expect(result[0]!.credentialsEncrypted).toBeUndefined();
    expect(result[0]!.sshPassphraseEncrypted).toBeUndefined();

    expect(result[1]!.id).toBe(2);
    expect(result[1]!.name).toBe('router-2');
    expect(result[1]!.credentialsEncrypted).toBeUndefined();
    expect(result[1]!.sshPassphraseEncrypted).toBeUndefined();
  });

  it('includes engine metadata (dockerized) in the response', async () => {
    const handler = (await import('./index.get')).default as Handler;
    const result = (await handler({ context: { principal: {} } })) as Array<Record<string, unknown>>;

    expect(result[0]!).toHaveProperty('dockerized');
    expect(result[1]!).toHaveProperty('dockerized');
  });
});
