import { createHash, createPublicKey } from 'node:crypto';
import {
  connect,
  type ConnectionOptions,
  type PeerCertificate,
} from 'node:tls';

const REJECT_UNAUTHORIZED_FOR_FINGERPRINT_FETCH = false;

export class TlsPinError extends Error {
  constructor(
    public readonly expected: string,
    public readonly actual: string
  ) {
    super(`TLS Pin Mismatch! Expected: ${expected}, Actual: ${actual}`);
    this.name = 'TlsPinError';
  }
}

export function getSpkiFingerprint(certRaw: Buffer): string {
  const pubKey = createPublicKey(certRaw);
  const spki = pubKey.export({ type: 'spki', format: 'der' });
  return createHash('sha256').update(spki).digest('hex');
}

export function getLeafFingerprint(certRaw: Buffer): string {
  return createHash('sha256').update(certRaw).digest('hex');
}

export function checkServerIdentity(
  hostname: string,
  cert: PeerCertificate,
  pinnedFingerprint: string | undefined
): Error | undefined {
  if (!pinnedFingerprint) {
    return undefined; // No pin, allow (Trust On First Use or Disabled)
  }

  // Support both Leaf and SPKI pinning by checking both
  const actualLeaf = getLeafFingerprint(cert.raw);
  const actualSpki = getSpkiFingerprint(cert.raw);

  const cleanPinned = pinnedFingerprint.replace(/:/g, '').toLowerCase();

  if (actualLeaf === cleanPinned || actualSpki === cleanPinned) {
    return undefined;
  }

  return new TlsPinError(cleanPinned, actualSpki); // Default to reporting SPKI mismatch
}

export async function getServerFingerprint(
  host: string,
  port: number,
  options?: ConnectionOptions
): Promise<{
  leaf: string;
  spki: string;
  subject: PeerCertificate['subject'];
  validTo: string;
}> {
  return new Promise((resolve, reject) => {
    const socket = connect(
      {
        host,
        port,
        // This endpoint intentionally retrieves the presented certificate for SPKI/leaf pin setup.
        rejectUnauthorized: REJECT_UNAUTHORIZED_FOR_FINGERPRINT_FETCH,
        ...options,
      },
      () => {
        const cert = socket.getPeerCertificate();
        if (!cert || !cert.raw) {
          socket.destroy();
          reject(new Error('No certificate received'));
          return;
        }

        const leaf = getLeafFingerprint(cert.raw);
        const spki = getSpkiFingerprint(cert.raw);

        resolve({
          leaf,
          spki,
          subject: cert.subject,
          validTo: cert.valid_to,
        });
        socket.destroy();
      }
    );

    socket.on('error', (err) => {
      reject(err);
    });

    socket.setTimeout(10000, () => {
      socket.destroy();
      reject(new Error('Timeout fetching certificate'));
    });
  });
}
