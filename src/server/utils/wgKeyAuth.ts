import crypto from 'node:crypto';
import nacl from 'tweetnacl';

export interface Challenge {
  id: string;
  nonce: Uint8Array;
  publicKey: string;
  serverSecretKey: Uint8Array;
  serverPublicKey: Uint8Array;
  createdAt: number;
  used: boolean;
}

const challenges = new Map<string, Challenge>();
const CHALLENGE_TTL_MS = 60_000;

function cleanExpiredChallenges() {
  const now = Date.now();
  for (const [id, ch] of challenges) {
    if (now - ch.createdAt > CHALLENGE_TTL_MS) {
      challenges.delete(id);
    }
  }
}

export function createChallenge(publicKey: string): {
  challengeId: string;
  nonce: string;
  serverPublicKey: string;
} {
  cleanExpiredChallenges();

  const nonce = nacl.randomBytes(32);
  const serverKeypair = nacl.box.keyPair();
  const challengeId = crypto.randomUUID();

  challenges.set(challengeId, {
    id: challengeId,
    nonce,
    publicKey,
    serverSecretKey: serverKeypair.secretKey,
    serverPublicKey: serverKeypair.publicKey,
    createdAt: Date.now(),
    used: false,
  });

  return {
    challengeId,
    nonce: Buffer.from(nonce).toString('base64'),
    serverPublicKey: Buffer.from(serverKeypair.publicKey).toString('base64'),
  };
}

export function verifyChallenge(
  challengeId: string,
  signatureBase64: string
): string | null {
  cleanExpiredChallenges();

  const challenge = challenges.get(challengeId);
  if (!challenge) return null;
  if (challenge.used) return null;
  if (Date.now() - challenge.createdAt > CHALLENGE_TTL_MS) return null;

  challenge.used = true;

  const clientPublicKey = Buffer.from(challenge.publicKey, 'base64');
  if (clientPublicKey.length !== 32) return null;

  const sharedSecret = nacl.scalarMult(
    challenge.serverSecretKey,
    new Uint8Array(clientPublicKey)
  );

  const nonce = challenge.nonce;
  const message = new Uint8Array(nonce.length + sharedSecret.length);
  message.set(nonce);
  message.set(sharedSecret, nonce.length);

  const expectedSignature = crypto
    .createHash('sha512')
    .update(Buffer.from(message))
    .digest();
  const providedSignature = Buffer.from(signatureBase64, 'base64');

  if (providedSignature.length !== expectedSignature.length) return null;
  if (!crypto.timingSafeEqual(providedSignature, expectedSignature))
    return null;

  return challenge.publicKey;
}

export function getChallengePublicKey(challengeId: string): string | null {
  cleanExpiredChallenges();
  return challenges.get(challengeId)?.publicKey ?? null;
}

// Rate limiting per IP
const ipAttempts = new Map<string, number[]>();
const MAX_ATTEMPTS_PER_IP = 10;
const RATE_LIMIT_WINDOW_MS = 60_000;

export function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const attempts = ipAttempts.get(ip) || [];
  const recent = attempts.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  ipAttempts.set(ip, recent);
  return recent.length >= MAX_ATTEMPTS_PER_IP;
}

export function recordAttempt(ip: string): void {
  const attempts = ipAttempts.get(ip) || [];
  attempts.push(Date.now());
  ipAttempts.set(ip, attempts);
}

export function resetRateLimiter(): void {
  ipAttempts.clear();
}
