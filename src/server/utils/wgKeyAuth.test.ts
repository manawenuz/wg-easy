import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import nacl from 'tweetnacl';
import crypto from 'node:crypto';
import {
  createChallenge,
  verifyChallenge,
  isRateLimited,
  recordAttempt,
} from './wgKeyAuth';

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

describe('wgKeyAuth', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('verifies a valid signature', () => {
    const clientKeypair = nacl.box.keyPair();
    const publicKeyBase64 = Buffer.from(clientKeypair.publicKey).toString(
      'base64'
    );

    const { challengeId, nonce, serverPublicKey } =
      createChallenge(publicKeyBase64);
    const signature = computeSignature(
      clientKeypair.secretKey,
      serverPublicKey,
      nonce
    );

    const result = verifyChallenge(challengeId, signature);
    expect(result).toBe(publicKeyBase64!);
  });

  it('rejects tampered signature', () => {
    const clientKeypair = nacl.box.keyPair();
    const publicKeyBase64 = Buffer.from(clientKeypair.publicKey).toString(
      'base64'
    );

    const { challengeId, nonce, serverPublicKey } =
      createChallenge(publicKeyBase64);
    const signature = computeSignature(
      clientKeypair.secretKey,
      serverPublicKey,
      nonce
    );

    // Tamper with signature
    const tampered = Buffer.from(signature, 'base64');
    tampered[0]! ^= 0xff;

    const result = verifyChallenge(challengeId, tampered.toString('base64'));
    expect(result).toBeNull();
  });

  it('rejects tampered nonce (wrong nonce produces different signature)', () => {
    const clientKeypair = nacl.box.keyPair();
    const publicKeyBase64 = Buffer.from(clientKeypair.publicKey).toString(
      'base64'
    );

    const { challengeId, serverPublicKey } = createChallenge(publicKeyBase64);

    // Compute signature with a different nonce
    const wrongNonce = Buffer.from(nacl.randomBytes(32)).toString('base64');
    const wrongSignature = computeSignature(
      clientKeypair.secretKey,
      serverPublicKey,
      wrongNonce
    );

    const result = verifyChallenge(challengeId, wrongSignature);
    expect(result).toBeNull();
  });

  it('marks challenge single-use', () => {
    const clientKeypair = nacl.box.keyPair();
    const publicKeyBase64 = Buffer.from(clientKeypair.publicKey).toString(
      'base64'
    );

    const { challengeId, nonce, serverPublicKey } =
      createChallenge(publicKeyBase64);
    const signature = computeSignature(
      clientKeypair.secretKey,
      serverPublicKey,
      nonce
    );

    const first = verifyChallenge(challengeId, signature);
    expect(first).toBe(publicKeyBase64);

    const second = verifyChallenge(challengeId, signature);
    expect(second).toBeNull();
  });

  it('expires challenge after 60s', () => {
    const clientKeypair = nacl.box.keyPair();
    const publicKeyBase64 = Buffer.from(clientKeypair.publicKey).toString(
      'base64'
    );

    const { challengeId, nonce, serverPublicKey } =
      createChallenge(publicKeyBase64);

    // Advance time by 61 seconds
    vi.advanceTimersByTime(61_000);

    const signature = computeSignature(
      clientKeypair.secretKey,
      serverPublicKey,
      nonce
    );
    const result = verifyChallenge(challengeId, signature);
    expect(result).toBeNull();
  });

  it('rate limits after 10 attempts', () => {
    const ip = '192.168.1.1';
    expect(isRateLimited(ip)).toBe(false);

    for (let i = 0; i < 10; i++) {
      recordAttempt(ip);
    }

    expect(isRateLimited(ip)).toBe(true);
  });
});
