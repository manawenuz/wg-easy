import { describe, it, expect, vi, beforeAll } from 'vitest';

describe('dashboard/login/challenge.post', () => {
  type Handler = (event: {
    context: Record<string, unknown>;
  }) => Promise<unknown>;

  const makeEvent = (body: unknown) =>
    ({ context: {}, body }) as unknown as Parameters<Handler>[0];

  beforeAll(() => {
    vi.stubGlobal('defineEventHandler', vi.fn((fn: unknown) => fn));
    vi.stubGlobal('readBody', vi.fn(async (event: { body: unknown }) => event.body));
    vi.stubGlobal('createError', vi.fn((opts: { statusCode: number; statusMessage: string }) => {
      const err = new Error(opts.statusMessage);
      (err as Error & { statusCode: number }).statusCode = opts.statusCode;
      throw err;
    }));
  });

  it('issues a challenge with nonce and serverPublicKey', async () => {
    const challengeHandler = (await import('./challenge.post')).default as Handler;
    const event = makeEvent({ publicKey: 'test-public-key' });
    const result = (await challengeHandler(event)) as {
      challengeId: string;
      nonce: string;
      serverPublicKey: string;
    };

    expect(result.challengeId).toBeDefined();
    expect(result.nonce).toBeDefined();
    expect(result.serverPublicKey).toBeDefined();
    expect(typeof result.nonce).toBe('string');
    expect(typeof result.serverPublicKey).toBe('string');
  });

  it('returns 400 when publicKey is missing', async () => {
    const challengeHandler = (await import('./challenge.post')).default as Handler;
    const event = makeEvent({});

    await expect(challengeHandler(event)).rejects.toThrow('publicKey is required');
  });
});
