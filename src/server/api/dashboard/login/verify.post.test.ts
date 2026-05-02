import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import nacl from 'tweetnacl';
import crypto from 'node:crypto';
import { createChallenge, resetRateLimiter } from '../../../utils/wgKeyAuth';
import { roles } from '#shared/utils/permissions';

vi.mock('h3', async () => {
  const actual = await vi.importActual<typeof import('h3')>('h3');
  return {
    ...actual,
    getRequestIP: vi.fn(() => '127.0.0.1'),
  };
});

function computeSignature(
  clientSecretKey: Uint8Array,
  serverPublicKey: string,
  nonce: string
): string {
  const serverPublicKeyBytes = Buffer.from(serverPublicKey, 'base64');
  const sharedSecret = nacl.scalarMult(
    clientSecretKey,
    new Uint8Array(serverPublicKeyBytes)
  );
  const nonceBytes = Buffer.from(nonce, 'base64');
  const message = new Uint8Array(nonceBytes.length + sharedSecret.length);
  message.set(nonceBytes);
  message.set(sharedSecret, nonceBytes.length);
  const signature = crypto
    .createHash('sha512')
    .update(Buffer.from(message))
    .digest();
  return signature.toString('base64');
}

describe('dashboard/login/verify.post', () => {
  type Handler = (event: {
    context: Record<string, unknown>;
  }) => Promise<unknown>;

  const makeEvent = (body: unknown) =>
    ({ context: {}, body, headers: {} }) as unknown as Parameters<Handler>[0];

  let mockSession: { update: ReturnType<typeof vi.fn>; clear: ReturnType<typeof vi.fn> };

  beforeAll(() => {
    vi.stubGlobal('defineEventHandler', vi.fn((fn: unknown) => fn));
    vi.stubGlobal('readBody', vi.fn(async (event: { body: unknown }) => event.body));
    vi.stubGlobal('createError', vi.fn((opts: { statusCode: number; statusMessage: string }) => {
      const err = new Error(opts.statusMessage);
      (err as Error & { statusCode: number }).statusCode = opts.statusCode;
      throw err;
    }));
    vi.stubGlobal('useSession', vi.fn(async () => mockSession));
    vi.stubGlobal('WG_ENV', { INSECURE: false });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimiter();
    mockSession = { update: vi.fn(), clear: vi.fn() };

    vi.stubGlobal('Database', {
      clients: {
        findByPublicKey: vi.fn(),
      },
      general: {
        getSessionConfig: vi.fn(async () => ({ sessionPassword: 'test-password' })),
      },
    });
  });

  it('returns 200 and sets cookie for valid login', async () => {
    const clientKeypair = nacl.box.keyPair();
    const publicKeyBase64 = Buffer.from(clientKeypair.publicKey).toString('base64');
    const { challengeId, nonce, serverPublicKey } = createChallenge(publicKeyBase64);
    const signature = computeSignature(clientKeypair.secretKey, serverPublicKey, nonce);

    const mockClient = {
      id: 1,
      enabled: true,
      user: {
        id: 42,
        enabled: true,
        role: roles.CLIENT,
      },
    };

    vi.mocked(Database.clients.findByPublicKey).mockResolvedValue(mockClient as any);

    const verifyHandler = (await import('./verify.post')).default as Handler;
    const event = makeEvent({ challengeId, signature });
    const result = await verifyHandler(event);

    expect(result).toEqual({ ok: true });
    expect(mockSession.update).toHaveBeenCalledWith({ userId: 42 });
  });

  it('returns 401 for invalid challenge', async () => {
    const verifyHandler = (await import('./verify.post')).default as Handler;
    const event = makeEvent({ challengeId: 'non-existent', signature: 'abc' });

    await expect(verifyHandler(event)).rejects.toThrow('Invalid challenge or signature');
  });

  it('returns 401 when client public key is not found', async () => {
    const clientKeypair = nacl.box.keyPair();
    const publicKeyBase64 = Buffer.from(clientKeypair.publicKey).toString('base64');
    const { challengeId, nonce, serverPublicKey } = createChallenge(publicKeyBase64);
    const signature = computeSignature(clientKeypair.secretKey, serverPublicKey, nonce);

    vi.mocked(Database.clients.findByPublicKey).mockResolvedValue(null as any);

    const verifyHandler = (await import('./verify.post')).default as Handler;
    const event = makeEvent({ challengeId, signature });

    await expect(verifyHandler(event)).rejects.toThrow('Invalid public key');
  });

  it('returns 403 when client is disabled', async () => {
    const clientKeypair = nacl.box.keyPair();
    const publicKeyBase64 = Buffer.from(clientKeypair.publicKey).toString('base64');
    const { challengeId, nonce, serverPublicKey } = createChallenge(publicKeyBase64);
    const signature = computeSignature(clientKeypair.secretKey, serverPublicKey, nonce);

    const mockClient = {
      id: 1,
      enabled: false,
      user: { id: 42, enabled: true, role: roles.CLIENT },
    };

    vi.mocked(Database.clients.findByPublicKey).mockResolvedValue(mockClient as any);

    const verifyHandler = (await import('./verify.post')).default as Handler;
    const event = makeEvent({ challengeId, signature });

    await expect(verifyHandler(event)).rejects.toThrow('Client is disabled');
  });

  it('returns 403 when user is disabled', async () => {
    const clientKeypair = nacl.box.keyPair();
    const publicKeyBase64 = Buffer.from(clientKeypair.publicKey).toString('base64');
    const { challengeId, nonce, serverPublicKey } = createChallenge(publicKeyBase64);
    const signature = computeSignature(clientKeypair.secretKey, serverPublicKey, nonce);

    const mockClient = {
      id: 1,
      enabled: true,
      user: { id: 42, enabled: false, role: roles.CLIENT },
    };

    vi.mocked(Database.clients.findByPublicKey).mockResolvedValue(mockClient as any);

    const verifyHandler = (await import('./verify.post')).default as Handler;
    const event = makeEvent({ challengeId, signature });

    await expect(verifyHandler(event)).rejects.toThrow('User is disabled');
  });

  it('returns 403 when user role is not client', async () => {
    const clientKeypair = nacl.box.keyPair();
    const publicKeyBase64 = Buffer.from(clientKeypair.publicKey).toString('base64');
    const { challengeId, nonce, serverPublicKey } = createChallenge(publicKeyBase64);
    const signature = computeSignature(clientKeypair.secretKey, serverPublicKey, nonce);

    const mockClient = {
      id: 1,
      enabled: true,
      user: { id: 42, enabled: true, role: roles.ADMIN },
    };

    vi.mocked(Database.clients.findByPublicKey).mockResolvedValue(mockClient as any);

    const verifyHandler = (await import('./verify.post')).default as Handler;
    const event = makeEvent({ challengeId, signature });

    await expect(verifyHandler(event)).rejects.toThrow('Invalid user role');
  });

  it('returns 429 after 10 attempts from same IP', async () => {
    const verifyHandler = (await import('./verify.post')).default as Handler;

    // Make 10 failed attempts
    for (let i = 0; i < 10; i++) {
      const event = makeEvent({ challengeId: `bad-${i}`, signature: 'bad' });
      try {
        await verifyHandler(event);
      } catch {
        // expected
      }
    }

    // 11th attempt should be rate limited
    const event = makeEvent({ challengeId: 'bad-10', signature: 'bad' });
    await expect(verifyHandler(event)).rejects.toThrow('Too many attempts');
  });

  it('rejects replay of same challenge', async () => {
    const clientKeypair = nacl.box.keyPair();
    const publicKeyBase64 = Buffer.from(clientKeypair.publicKey).toString('base64');
    const { challengeId, nonce, serverPublicKey } = createChallenge(publicKeyBase64);
    const signature = computeSignature(clientKeypair.secretKey, serverPublicKey, nonce);

    const mockClient = {
      id: 1,
      enabled: true,
      user: { id: 42, enabled: true, role: roles.CLIENT },
    };

    vi.mocked(Database.clients.findByPublicKey).mockResolvedValue(mockClient as any);

    const verifyHandler = (await import('./verify.post')).default as Handler;

    // First attempt succeeds
    const event = makeEvent({ challengeId, signature });
    await verifyHandler(event);

    // Second attempt with same challenge fails
    await expect(verifyHandler(event)).rejects.toThrow('Invalid challenge or signature');
  });
});
