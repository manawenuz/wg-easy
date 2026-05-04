import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { getRequestURL } from 'h3';

vi.mock('h3', async () => {
  const actual = await vi.importActual<typeof import('h3')>('h3');
  return {
    ...actual,
    getRequestURL: vi.fn(),
  };
});

vi.mock('../utils/principal', () => ({
  resolvePrincipal: vi.fn(),
}));

const { resolvePrincipal } = await import('../utils/principal');

describe('principal middleware', () => {
  let principalMiddleware: (event: { context: { principal?: unknown } }) => Promise<void>;

  const makeEvent = (pathname: string, existingPrincipal?: unknown) =>
    ({
      context: { principal: existingPrincipal },
    }) as Parameters<typeof principalMiddleware>[0];

  beforeAll(async () => {
    vi.stubGlobal('defineEventHandler', vi.fn((fn: unknown) => fn));
    vi.stubGlobal('getRequestURL', getRequestURL);
    vi.stubGlobal('resolvePrincipal', resolvePrincipal);
    const mod = await import('./principal');
    principalMiddleware = mod.default as typeof principalMiddleware;
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves principal and writes it to event.context.principal', async () => {
    const mockPrincipal = { kind: 'admin', user: { id: 1 } };
    vi.mocked(getRequestURL).mockReturnValue(new URL('http://localhost/api/test'));
    vi.mocked(resolvePrincipal).mockResolvedValue(mockPrincipal as any);

    const event = makeEvent('/api/test');
    await principalMiddleware(event);

    expect(resolvePrincipal).toHaveBeenCalledWith(event);
    expect(event.context.principal).toBe(mockPrincipal);
  });

  it('leaves event.context.principal undefined when resolvePrincipal returns null', async () => {
    vi.mocked(getRequestURL).mockReturnValue(new URL('http://localhost/api/test'));
    vi.mocked(resolvePrincipal).mockResolvedValue(null);

    const event = makeEvent('/api/test');
    await principalMiddleware(event);

    expect(event.context.principal).toBeUndefined();
  });

  it('swallows errors from resolvePrincipal without throwing', async () => {
    vi.mocked(getRequestURL).mockReturnValue(new URL('http://localhost/api/test'));
    vi.mocked(resolvePrincipal).mockRejectedValue(new Error('db failure'));

    const event = makeEvent('/api/test');
    await expect(principalMiddleware(event)).resolves.toBeUndefined();
    expect(event.context.principal).toBeUndefined();
  });

  it('skips /api/setup/ routes', async () => {
    vi.mocked(getRequestURL).mockReturnValue(new URL('http://localhost/api/setup/step1'));

    const event = makeEvent('/api/setup/step1');
    await principalMiddleware(event);

    expect(resolvePrincipal).not.toHaveBeenCalled();
  });

  it('skips /setup/ page routes', async () => {
    vi.mocked(getRequestURL).mockReturnValue(new URL('http://localhost/setup/1'));

    const event = makeEvent('/setup/1');
    await principalMiddleware(event);

    expect(resolvePrincipal).not.toHaveBeenCalled();
  });

  it('runs for non-API page routes (SSR)', async () => {
    const mockPrincipal = { kind: 'admin', user: { id: 1 } };
    vi.mocked(getRequestURL).mockReturnValue(new URL('http://localhost/'));
    vi.mocked(resolvePrincipal).mockResolvedValue(mockPrincipal as any);

    const event = makeEvent('/');
    await principalMiddleware(event);

    expect(resolvePrincipal).toHaveBeenCalledWith(event);
    expect(event.context.principal).toBe(mockPrincipal);
  });

  it('does not re-resolve when principal is already cached', async () => {
    const cached = { kind: 'user', user: { id: 2 } };
    vi.mocked(getRequestURL).mockReturnValue(new URL('http://localhost/api/test'));

    const event = makeEvent('/api/test', cached);
    await principalMiddleware(event);

    expect(resolvePrincipal).not.toHaveBeenCalled();
    expect(event.context.principal).toBe(cached);
  });
});
