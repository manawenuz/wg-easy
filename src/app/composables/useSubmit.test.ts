import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('ofetch', () => ({
  FetchError: class FetchError extends Error {
    statusCode?: number;
    data?: { message?: string };
    constructor(message: string) {
      super(message);
    }
  },
}));

import { FetchError } from 'ofetch';
import { useSubmit } from './useSubmit';

describe('useSubmit', () => {
  const showToast = vi.fn();
  const revert = vi.fn(async () => {});

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('useToast', () => ({ showToast }));
  });

  function createFetchError(statusCode: number, message?: string, dataMessage?: string): Error {
    const err = new FetchError(message ?? 'HTTP error');
    (err as Error & { statusCode?: number }).statusCode = statusCode;
    (err as Error & { data?: { message?: string } }).data = { message: dataMessage };
    return err;
  }

  it('shows success toast and calls revert(true, data) on success', async () => {
    vi.stubGlobal('$fetch', vi.fn(async () => ({ ok: true })));

    const submit = useSubmit('/api/session', { method: 'post' }, { revert });
    await submit({ username: 'admin', password: 'admin' });

    expect(revert).toHaveBeenCalledWith(true, { ok: true });
    expect(showToast).toHaveBeenCalledWith({ type: 'success', message: undefined });
  });

  it('does not show success toast when noSuccessToast is true', async () => {
    vi.stubGlobal('$fetch', vi.fn(async () => ({ ok: true })));

    const submit = useSubmit('/api/session', { method: 'post' }, { revert, noSuccessToast: true });
    await submit({ username: 'admin', password: 'admin' });

    expect(revert).toHaveBeenCalledWith(true, { ok: true });
    expect(showToast).not.toHaveBeenCalled();
  });

  it('shows session-expired toast on 401', async () => {
    vi.stubGlobal('$fetch', vi.fn(async () => {
      throw createFetchError(401);
    }));

    const submit = useSubmit('/api/session', { method: 'post' }, { revert });
    await submit({ username: 'admin', password: 'wrong' });

    expect(showToast).toHaveBeenCalledWith({
      type: 'error',
      message: 'Your session has expired. Please log in again.',
    });
    expect(revert).toHaveBeenCalledWith(false, undefined);
  });

  it('shows permission-denied toast on 403', async () => {
    vi.stubGlobal('$fetch', vi.fn(async () => {
      throw createFetchError(403, 'Forbidden');
    }));

    const submit = useSubmit('/api/session', { method: 'post' }, { revert });
    await submit({ username: 'admin', password: 'wrong' });

    expect(showToast).toHaveBeenCalledWith({
      type: 'error',
      message: 'You do not have permission to perform this action.',
    });
    expect(revert).toHaveBeenCalledWith(false, undefined);
  });

  it('shows not-found toast on 404', async () => {
    vi.stubGlobal('$fetch', vi.fn(async () => {
      throw createFetchError(404, 'Not Found');
    }));

    const submit = useSubmit('/api/session', { method: 'post' }, { revert });
    await submit({ username: 'admin', password: 'wrong' });

    expect(showToast).toHaveBeenCalledWith({
      type: 'error',
      message: 'The requested resource was not found.',
    });
    expect(revert).toHaveBeenCalledWith(false, undefined);
  });

  it('shows rate-limit toast on 429', async () => {
    vi.stubGlobal('$fetch', vi.fn(async () => {
      throw createFetchError(429, 'Too Many Requests');
    }));

    const submit = useSubmit('/api/session', { method: 'post' }, { revert });
    await submit({ username: 'admin', password: 'wrong' });

    expect(showToast).toHaveBeenCalledWith({
      type: 'error',
      message: 'Too many requests. Please wait a moment.',
    });
    expect(revert).toHaveBeenCalledWith(false, undefined);
  });

  it('shows server-error toast on 500', async () => {
    vi.stubGlobal('$fetch', vi.fn(async () => {
      throw createFetchError(500, 'Internal Server Error');
    }));

    const submit = useSubmit('/api/session', { method: 'post' }, { revert });
    await submit({ username: 'admin', password: 'wrong' });

    expect(showToast).toHaveBeenCalledWith({
      type: 'error',
      message: 'A server error occurred. Please try again later.',
    });
    expect(revert).toHaveBeenCalledWith(false, undefined);
  });

  it('shows custom data message when available', async () => {
    vi.stubGlobal('$fetch', vi.fn(async () => {
      throw createFetchError(401, 'Unauthorized', 'Custom auth error');
    }));

    const submit = useSubmit('/api/session', { method: 'post' }, { revert });
    await submit({ username: 'admin', password: 'wrong' });

    expect(showToast).toHaveBeenCalledWith({
      type: 'error',
      message: 'Custom auth error',
    });
    expect(revert).toHaveBeenCalledWith(false, undefined);
  });

  it('shows generic error message for non-FetchError Error', async () => {
    vi.stubGlobal('$fetch', vi.fn(async () => {
      throw new Error('Network failure');
    }));

    const submit = useSubmit('/api/session', { method: 'post' }, { revert });
    await submit({ username: 'admin', password: 'wrong' });

    expect(showToast).toHaveBeenCalledWith({
      type: 'error',
      message: 'Network failure',
    });
    expect(revert).toHaveBeenCalledWith(false, undefined);
  });

  it('logs unknown errors to console.error', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('$fetch', vi.fn(async () => {
      throw 'string-error';
    }));

    const submit = useSubmit('/api/session', { method: 'post' }, { revert });
    await submit({ username: 'admin', password: 'wrong' });

    expect(consoleError).toHaveBeenCalledWith('string-error');
    expect(revert).toHaveBeenCalledWith(false, undefined);
    consoleError.mockRestore();
  });
});
