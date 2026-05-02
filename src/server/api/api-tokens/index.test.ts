import { describe, it, expect, vi, beforeEach } from 'vitest';
import { hashPassword, isPasswordValid } from '../../utils/password';

describe('api token service integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('hashes and verifies a token with argon2', async () => {
    const token = 'wgep_testtoken123';
    const hash = await hashPassword(token);

    expect(await isPasswordValid(token, hash)).toBe(true);
    expect(await isPasswordValid('wrong', hash)).toBe(false);
  });

  it('generates a token with the wgep_ prefix', () => {
    const { randomBytes } = require('node:crypto');
    const token = `wgep_${randomBytes(32).toString('base64url')}`;
    expect(token).toMatch(/^wgep_[A-Za-z0-9_-]+$/);
    expect(token.length).toBeGreaterThan(10);
  });
});
