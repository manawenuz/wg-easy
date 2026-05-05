import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as crypto from 'node:crypto';
import { getLeafFingerprint, getSpkiFingerprint, checkServerIdentity, TlsPinError } from './tls-pin';

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof crypto>();
  return {
    ...actual,
    createPublicKey: vi.fn(),
  };
});

describe('tls-pin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calculates leaf fingerprint correctly', () => {
    const data = Buffer.from('test');
    // Using actual hash for 'test'
    expect(getLeafFingerprint(data)).toBe('9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08');
  });

  it('calculates spki fingerprint correctly', () => {
    const mockSpki = Buffer.from('mock-spki');
    const mockPubKey = {
      export: vi.fn().mockReturnValue(mockSpki),
    };
    vi.mocked(crypto.createPublicKey).mockReturnValue(mockPubKey as any);

    const certRaw = Buffer.from('mock-cert');
    const expectedHash = crypto.createHash('sha256').update(mockSpki).digest('hex');

    expect(getSpkiFingerprint(certRaw)).toBe(expectedHash);
    expect(crypto.createPublicKey).toHaveBeenCalledWith(certRaw);
  });

  it('checkServerIdentity accepts matching leaf fingerprint', () => {
    const certRaw = Buffer.from('test');
    const leafHash = '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08';
    const cert = { raw: certRaw } as any;

    // We need to mock createPublicKey because checkServerIdentity calls getSpkiFingerprint
    vi.mocked(crypto.createPublicKey).mockReturnValue({
      export: vi.fn().mockReturnValue(Buffer.from('other')),
    } as any);

    expect(checkServerIdentity('host', cert, leafHash)).toBeUndefined();
    
    // Test with colons and uppercase
    const formattedPin = leafHash.match(/.{2}/g)?.join(':').toUpperCase();
    expect(checkServerIdentity('host', cert, formattedPin)).toBeUndefined();
  });

  it('checkServerIdentity rejects mismatching fingerprint', () => {
    const certRaw = Buffer.from('test');
    const cert = { raw: certRaw } as any;

    const err = checkServerIdentity('host', cert, 'wrong');
    expect(err).toBeInstanceOf(TlsPinError);
  });
});
