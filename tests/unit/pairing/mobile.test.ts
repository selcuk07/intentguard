import { describe, it, expect } from 'vitest';

// Test parsePairingQr logic from app/src/utils/pairing.ts

interface PairingQrData {
  protocol: 'intentguard-pair';
  version: number;
  channelId: string;
  publicKey: string;
  relay: string;
}

function parsePairingQr(data: string): PairingQrData | null {
  try {
    const parsed = JSON.parse(data);
    if (parsed.protocol !== 'intentguard-pair') return null;
    if (!parsed.channelId || !parsed.publicKey || !parsed.relay) return null;

    // Validate relay URL scheme
    const relay = String(parsed.relay);
    if (!/^https?:\/\//i.test(relay)) return null;

    // Validate channelId length
    if (typeof parsed.channelId !== 'string' || parsed.channelId.length > 64) return null;

    // Validate publicKey length
    if (typeof parsed.publicKey !== 'string' || parsed.publicKey.length > 128) return null;

    return parsed as PairingQrData;
  } catch {
    return null;
  }
}

describe('Mobile pairing — parsePairingQr', () => {
  it('parses valid QR data', () => {
    const data = JSON.stringify({
      protocol: 'intentguard-pair',
      version: 1,
      channelId: 'abc123',
      publicKey: 'BAAAA==',
      relay: 'http://localhost:3000',
    });

    const result = parsePairingQr(data);
    expect(result).not.toBeNull();
    expect(result!.protocol).toBe('intentguard-pair');
    expect(result!.channelId).toBe('abc123');
    expect(result!.publicKey).toBe('BAAAA==');
    expect(result!.relay).toBe('http://localhost:3000');
  });

  it('returns null for wrong protocol', () => {
    const data = JSON.stringify({
      protocol: 'intentguard',
      version: 1,
      channelId: 'abc',
      publicKey: 'key',
      relay: 'http://localhost:3000',
    });
    expect(parsePairingQr(data)).toBeNull();
  });

  it('returns null for missing channelId', () => {
    const data = JSON.stringify({
      protocol: 'intentguard-pair',
      version: 1,
      publicKey: 'key',
      relay: 'http://localhost:3000',
    });
    expect(parsePairingQr(data)).toBeNull();
  });

  it('returns null for missing publicKey', () => {
    const data = JSON.stringify({
      protocol: 'intentguard-pair',
      version: 1,
      channelId: 'abc',
      relay: 'http://localhost:3000',
    });
    expect(parsePairingQr(data)).toBeNull();
  });

  it('returns null for missing relay', () => {
    const data = JSON.stringify({
      protocol: 'intentguard-pair',
      version: 1,
      channelId: 'abc',
      publicKey: 'key',
    });
    expect(parsePairingQr(data)).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    expect(parsePairingQr('not json')).toBeNull();
    expect(parsePairingQr('')).toBeNull();
    expect(parsePairingQr('{')).toBeNull();
  });

  it('returns null for non-object JSON', () => {
    expect(parsePairingQr('"string"')).toBeNull();
    expect(parsePairingQr('42')).toBeNull();
    expect(parsePairingQr('null')).toBeNull();
  });

  it('ignores extra fields', () => {
    const data = JSON.stringify({
      protocol: 'intentguard-pair',
      version: 1,
      channelId: 'abc',
      publicKey: 'key',
      relay: 'http://localhost:3000',
      extraField: 'ignored',
    });
    const result = parsePairingQr(data);
    expect(result).not.toBeNull();
    expect(result!.channelId).toBe('abc');
  });
});
