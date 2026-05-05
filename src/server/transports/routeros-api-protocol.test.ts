import { describe, it, expect } from 'vitest';
import { RouterOsApiProtocol } from './routeros-api-protocol';

describe('RouterOsApiProtocol', () => {
  it('encodes and decodes lengths correctly', () => {
    const protocol = new RouterOsApiProtocol('localhost', 8728, false);
    const anyProtocol = protocol as any;

    const testCases = [
      0, 0x7f, 0x80, 0x3fff, 0x4000, 0x1fffff, 0x200000, 0x0fffffff, 0x10000000,
    ];

    for (const len of testCases) {
      const encoded = anyProtocol.encodeLength(len);
      const { length, bytesRead } = anyProtocol.decodeLength(encoded);
      expect(length).toBe(len);
      expect(bytesRead).toBe(encoded.length);
    }
  });

  it('decodes 2-byte length', () => {
    const protocol = new RouterOsApiProtocol('localhost', 8728, false);
    const anyProtocol = protocol as any;
    const buf = Buffer.from([0x80 | 0x30, 0x39]); // 0x3039 = 12345
    const { length, bytesRead } = anyProtocol.decodeLength(buf);
    expect(length).toBe(12345);
    expect(bytesRead).toBe(2);
  });

  it('decodes 5-byte length', () => {
    const protocol = new RouterOsApiProtocol('localhost', 8728, false);
    const anyProtocol = protocol as any;
    const buf = Buffer.alloc(5);
    buf[0] = 0xf0;
    buf.writeUInt32BE(12345678, 1);
    const { length, bytesRead } = anyProtocol.decodeLength(buf);
    expect(length).toBe(12345678);
    expect(bytesRead).toBe(5);
  });
});
