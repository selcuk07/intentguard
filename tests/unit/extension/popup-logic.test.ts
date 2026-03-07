import { describe, it, expect } from 'vitest';

// Test the pure logic functions from popup.js by reimplementing them here
// (popup.js is plain JS for browser, so we test the logic in isolation)

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58Decode(str: string): Uint8Array {
  const bytes = [0];
  for (const char of str) {
    const idx = BASE58_ALPHABET.indexOf(char);
    if (idx === -1) throw new Error('Invalid base58');
    let carry = idx;
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (const char of str) {
    if (char !== '1') break;
    bytes.push(0);
  }
  return new Uint8Array(bytes.reverse());
}

function base58Encode(bytes: Uint8Array): string {
  const digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) {
      carry += digits[i] << 8;
      digits[i] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let str = '';
  for (const byte of bytes) {
    if (byte !== 0) break;
    str += '1';
  }
  for (let i = digits.length - 1; i >= 0; i--) {
    str += BASE58_ALPHABET[digits[i]];
  }
  return str;
}

function decodeGuardConfig(base64Data: string) {
  const data = Uint8Array.from(atob(base64Data), (c) => c.charCodeAt(0));
  const view = new DataView(data.buffer);
  const totalCommits = Number(view.getBigUint64(41, true));
  const totalVerifies = Number(view.getBigUint64(49, true));
  const isPaused = data[40] === 1;

  let verifyFee = 0;
  let totalFeesCollected = 0;
  if (data.length >= 82) {
    verifyFee = Number(view.getBigUint64(65, true));
    totalFeesCollected = Number(view.getBigUint64(73, true));
  }
  return { totalCommits, totalVerifies, isPaused, verifyFee, totalFeesCollected };
}

function formatFee(lamports: number): string {
  if (lamports === 0) return 'Free';
  return (lamports / 1_000_000_000).toFixed(6) + ' SOL';
}

function decodeIntentCommit(base64Data: string) {
  const data = Uint8Array.from(atob(base64Data), (c) => c.charCodeAt(0));
  const view = new DataView(data.buffer);
  const committedAt = Number(view.getBigInt64(104, true));
  const expiresAt = Number(view.getBigInt64(112, true));
  const hashBytes = data.slice(72, 104);
  const hashHex = Array.from(hashBytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return { committedAt, expiresAt, hashHex };
}

function formatTimeRemaining(expiresAt: number) {
  const now = Math.floor(Date.now() / 1000);
  const diff = expiresAt - now;
  if (diff <= 0) return 'Expired';
  const min = Math.floor(diff / 60);
  const sec = diff % 60;
  return `${min}m ${sec}s remaining`;
}

describe('Extension — popup logic', () => {
  describe('base58Decode', () => {
    it('decodes a known value', () => {
      // "2" in base58 = single byte [1]
      const result = base58Decode('2');
      expect(result).toEqual(new Uint8Array([1]));
    });

    it('throws on invalid character', () => {
      expect(() => base58Decode('0OIl')).toThrow('Invalid base58');
    });

    it('roundtrips with base58Encode', () => {
      const original = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
      const encoded = base58Encode(original);
      const decoded = base58Decode(encoded);
      expect(decoded).toEqual(original);
    });
  });

  describe('base58Encode', () => {
    it('encodes single byte', () => {
      // byte [1] = "2" in base58
      expect(base58Encode(new Uint8Array([1]))).toBe('2');
    });

    it('preserves leading zeros as "1"s', () => {
      const result = base58Encode(new Uint8Array([0, 0, 1]));
      expect(result.startsWith('11')).toBe(true);
    });
  });

  describe('decodeGuardConfig', () => {
    it('decodes totalCommits and totalVerifies', () => {
      // Create a mock 57-byte (minimum) account data
      const data = new Uint8Array(57);
      const view = new DataView(data.buffer);
      // discriminator: bytes 0-7 (skip)
      // admin: bytes 8-39 (skip)
      // isPaused: byte 40
      data[40] = 0;
      // totalCommits: bytes 41-48 (u64 LE)
      view.setBigUint64(41, BigInt(42), true);
      // totalVerifies: bytes 49-56 (u64 LE)
      view.setBigUint64(49, BigInt(10), true);

      const base64 = btoa(String.fromCharCode(...data));
      const config = decodeGuardConfig(base64);

      expect(config.totalCommits).toBe(42);
      expect(config.totalVerifies).toBe(10);
      expect(config.isPaused).toBe(false);
    });

    it('detects paused state', () => {
      const data = new Uint8Array(57);
      data[40] = 1;
      const view = new DataView(data.buffer);
      view.setBigUint64(41, BigInt(0), true);
      view.setBigUint64(49, BigInt(0), true);

      const base64 = btoa(String.fromCharCode(...data));
      const config = decodeGuardConfig(base64);
      expect(config.isPaused).toBe(true);
    });

    it('decodes verify_fee and total_fees_collected (82-byte config)', () => {
      const data = new Uint8Array(82);
      const view = new DataView(data.buffer);
      data[40] = 0;
      view.setBigUint64(41, BigInt(100), true);  // totalCommits
      view.setBigUint64(49, BigInt(50), true);   // totalVerifies
      view.setBigUint64(57, BigInt(10_000_000), true); // minBalance
      view.setBigUint64(65, BigInt(5_000_000), true);  // verifyFee (0.005 SOL)
      view.setBigUint64(73, BigInt(250_000_000), true); // totalFeesCollected

      const base64 = btoa(String.fromCharCode(...data));
      const config = decodeGuardConfig(base64);

      expect(config.verifyFee).toBe(5_000_000);
      expect(config.totalFeesCollected).toBe(250_000_000);
    });

    it('defaults fee fields to 0 for old 57-byte config', () => {
      const data = new Uint8Array(57);
      const view = new DataView(data.buffer);
      view.setBigUint64(41, BigInt(10), true);
      view.setBigUint64(49, BigInt(5), true);

      const base64 = btoa(String.fromCharCode(...data));
      const config = decodeGuardConfig(base64);

      expect(config.verifyFee).toBe(0);
      expect(config.totalFeesCollected).toBe(0);
    });
  });

  describe('formatFee', () => {
    it('displays "Free" for zero fee', () => {
      expect(formatFee(0)).toBe('Free');
    });

    it('displays SOL amount for non-zero fee', () => {
      expect(formatFee(5_000_000)).toBe('0.005000 SOL');
    });

    it('displays max fee correctly', () => {
      expect(formatFee(100_000_000)).toBe('0.100000 SOL');
    });
  });

  describe('decodeIntentCommit', () => {
    it('decodes timestamps and hash', () => {
      const data = new Uint8Array(121);
      const view = new DataView(data.buffer);

      // intent_hash: bytes 72-103
      for (let i = 0; i < 32; i++) data[72 + i] = i;

      // committed_at: i64 at 104
      view.setBigInt64(104, BigInt(1700000000), true);
      // expires_at: i64 at 112
      view.setBigInt64(112, BigInt(1700000300), true);

      const base64 = btoa(String.fromCharCode(...data));
      const commit = decodeIntentCommit(base64);

      expect(commit.committedAt).toBe(1700000000);
      expect(commit.expiresAt).toBe(1700000300);
      expect(commit.hashHex).toHaveLength(64); // 32 bytes * 2 hex chars
      expect(commit.hashHex.startsWith('000102')).toBe(true);
    });
  });

  describe('formatTimeRemaining', () => {
    it('returns "Expired" for past timestamps', () => {
      expect(formatTimeRemaining(0)).toBe('Expired');
      expect(formatTimeRemaining(1000000000)).toBe('Expired');
    });

    it('returns correct format for future timestamps', () => {
      const future = Math.floor(Date.now() / 1000) + 125; // 2m 5s from now
      const result = formatTimeRemaining(future);
      expect(result).toMatch(/\d+m \d+s remaining/);
    });

    it('returns 0m Xs for less than a minute', () => {
      const future = Math.floor(Date.now() / 1000) + 30;
      const result = formatTimeRemaining(future);
      expect(result).toMatch(/0m \d+s remaining/);
    });
  });
});
