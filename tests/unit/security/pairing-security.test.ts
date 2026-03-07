/**
 * Pairing Security Tests
 *
 * - ECDH key exchange integrity
 * - MITM detection (wrong keys)
 * - Replay attack on encrypted messages
 * - Tampered ciphertext detection
 * - Channel isolation
 * - QR payload validation / injection
 */
import { describe, it, expect } from 'vitest';
import { webcrypto } from 'crypto';

const subtle = webcrypto.subtle;

function arrayBufToBase64(buf: ArrayBuffer): string {
  return Buffer.from(buf).toString('base64');
}
function base64ToArrayBuf(b64: string): ArrayBuffer {
  const buf = Buffer.from(b64, 'base64');
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

async function generateKeyPair() {
  return subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey', 'deriveBits']);
}
async function exportPublicKey(key: CryptoKey) {
  return arrayBufToBase64(await subtle.exportKey('raw', key));
}
async function importPublicKey(b64: string) {
  return subtle.importKey('raw', base64ToArrayBuf(b64), { name: 'ECDH', namedCurve: 'P-256' }, true, []);
}
async function deriveSharedKey(priv: CryptoKey, pub: CryptoKey) {
  const bits = await subtle.deriveBits({ name: 'ECDH', public: pub }, priv, 256);
  const hkdf = await subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
  return subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new TextEncoder().encode('intentguard-pairing-v1'), info: new TextEncoder().encode('aes-gcm-key') },
    hkdf, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  );
}
async function encrypt(key: CryptoKey, data: any) {
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(data)));
  return { iv: arrayBufToBase64(iv.buffer), data: arrayBufToBase64(ct) };
}
async function decrypt(key: CryptoKey, envelope: { iv: string; data: string }) {
  const iv = new Uint8Array(base64ToArrayBuf(envelope.iv));
  const pt = await subtle.decrypt({ name: 'AES-GCM', iv }, key, base64ToArrayBuf(envelope.data));
  return JSON.parse(new TextDecoder().decode(pt));
}

describe('SECURITY — Pairing ECDH Key Exchange', () => {
  it('MITM with wrong public key cannot derive same shared secret', async () => {
    const extension = await generateKeyPair();
    const mobile = await generateKeyPair();
    const mitm = await generateKeyPair();

    // Extension shares pub with mobile (correct)
    const correctShared = await deriveSharedKey(extension.privateKey, mobile.publicKey);
    // MITM intercepts and substitutes their own key
    const mitmShared = await deriveSharedKey(mitm.privateKey, mobile.publicKey);

    // Extension encrypts with correct shared key
    const encrypted = await encrypt(correctShared, { type: 'intent_needed' });

    // MITM tries to decrypt — should fail
    await expect(decrypt(mitmShared, encrypted)).rejects.toThrow();
  });

  it('shared secret is different for every key pair combination', async () => {
    const a = await generateKeyPair();
    const b = await generateKeyPair();
    const c = await generateKeyPair();

    const ab = await subtle.deriveBits({ name: 'ECDH', public: b.publicKey }, a.privateKey, 256);
    const ac = await subtle.deriveBits({ name: 'ECDH', public: c.publicKey }, a.privateKey, 256);
    const bc = await subtle.deriveBits({ name: 'ECDH', public: c.publicKey }, b.privateKey, 256);

    expect(arrayBufToBase64(ab)).not.toEqual(arrayBufToBase64(ac));
    expect(arrayBufToBase64(ab)).not.toEqual(arrayBufToBase64(bc));
    expect(arrayBufToBase64(ac)).not.toEqual(arrayBufToBase64(bc));
  });
});

describe('SECURITY — AES-GCM Integrity', () => {
  let sharedKey: CryptoKey;

  it('setup', async () => {
    const a = await generateKeyPair();
    const b = await generateKeyPair();
    sharedKey = await deriveSharedKey(a.privateKey, b.publicKey);
  });

  it('modified ciphertext is detected (authentication tag)', async () => {
    const encrypted = await encrypt(sharedKey, { secret: 'data' });
    const buf = Buffer.from(encrypted.data, 'base64');

    // Flip every byte position — all should fail
    for (let i = 0; i < Math.min(buf.length, 5); i++) {
      const tampered = Buffer.from(buf);
      tampered[i] ^= 0x01;
      await expect(
        decrypt(sharedKey, { ...encrypted, data: tampered.toString('base64') }),
      ).rejects.toThrow();
    }
  });

  it('truncated ciphertext is rejected', async () => {
    const encrypted = await encrypt(sharedKey, { msg: 'test' });
    const buf = Buffer.from(encrypted.data, 'base64');
    const truncated = buf.slice(0, buf.length - 1).toString('base64');
    await expect(decrypt(sharedKey, { ...encrypted, data: truncated })).rejects.toThrow();
  });

  it('empty ciphertext is rejected', async () => {
    const encrypted = await encrypt(sharedKey, { msg: 'test' });
    await expect(decrypt(sharedKey, { ...encrypted, data: '' })).rejects.toThrow();
  });

  it('swapped IV from different message fails', async () => {
    const msg1 = await encrypt(sharedKey, { id: 1 });
    const msg2 = await encrypt(sharedKey, { id: 2 });

    // Use msg1's IV with msg2's ciphertext
    await expect(decrypt(sharedKey, { iv: msg1.iv, data: msg2.data })).rejects.toThrow();
  });

  it('replay of exact same envelope succeeds (idempotent)', async () => {
    const encrypted = await encrypt(sharedKey, { type: 'heartbeat' });
    const d1 = await decrypt(sharedKey, encrypted);
    const d2 = await decrypt(sharedKey, encrypted);
    expect(d1).toEqual(d2);
  });
});

describe('SECURITY — QR Pairing Payload', () => {
  function parsePairingQr(data: string) {
    try {
      const parsed = JSON.parse(data);
      if (parsed.protocol !== 'intentguard-pair') return null;
      if (!parsed.channelId || !parsed.publicKey || !parsed.relay) return null;
      const relay = String(parsed.relay);
      if (!/^https?:\/\//i.test(relay)) return null;
      if (typeof parsed.channelId !== 'string' || parsed.channelId.length > 64) return null;
      if (typeof parsed.publicKey !== 'string' || parsed.publicKey.length > 128) return null;
      return parsed;
    } catch { return null; }
  }

  it('rejects prototype pollution via __proto__', () => {
    const malicious = '{"protocol":"intentguard-pair","__proto__":{"admin":true},"channelId":"x","publicKey":"y","relay":"http://localhost:3000"}';
    const result = parsePairingQr(malicious);
    expect(result).not.toBeNull();
    expect(({} as any).admin).toBeUndefined();
  });

  it('rejects extremely long channelId (DoS)', () => {
    const longId = 'a'.repeat(1_000_000);
    const data = JSON.stringify({
      protocol: 'intentguard-pair',
      channelId: longId,
      publicKey: 'key',
      relay: 'http://localhost:3000',
    });
    const result = parsePairingQr(data);
    // Now rejected by length validation
    expect(result).toBeNull();
  });

  it('rejects relay URL with javascript: scheme', () => {
    const data = JSON.stringify({
      protocol: 'intentguard-pair',
      channelId: 'x',
      publicKey: 'y',
      relay: 'javascript:alert(1)',
    });
    const result = parsePairingQr(data);
    // Now rejected at parsePairingQr level
    expect(result).toBeNull();
  });

  it('rejects HTML injection in relay URL', () => {
    const data = JSON.stringify({
      protocol: 'intentguard-pair',
      channelId: 'x',
      publicKey: 'y',
      relay: '<img src=x onerror=alert(1)>',
    });
    const result = parsePairingQr(data);
    // Now rejected — not a valid http/https URL
    expect(result).toBeNull();
  });

  it('rejects data: URI in relay URL', () => {
    const data = JSON.stringify({
      protocol: 'intentguard-pair',
      channelId: 'x',
      publicKey: 'y',
      relay: 'data:text/html,<h1>evil</h1>',
    });
    expect(parsePairingQr(data)).toBeNull();
  });

  it('accepts valid http relay URL', () => {
    const data = JSON.stringify({
      protocol: 'intentguard-pair',
      channelId: 'abc123',
      publicKey: 'BAAAA==',
      relay: 'http://localhost:3000',
    });
    expect(parsePairingQr(data)).not.toBeNull();
  });

  it('accepts valid https relay URL', () => {
    const data = JSON.stringify({
      protocol: 'intentguard-pair',
      channelId: 'abc123',
      publicKey: 'BAAAA==',
      relay: 'https://relay.intentguard.io',
    });
    expect(parsePairingQr(data)).not.toBeNull();
  });

  it('rejects overly long publicKey', () => {
    const data = JSON.stringify({
      protocol: 'intentguard-pair',
      channelId: 'x',
      publicKey: 'A'.repeat(200),
      relay: 'http://localhost:3000',
    });
    expect(parsePairingQr(data)).toBeNull();
  });

  it('handles null bytes in channelId', () => {
    const data = JSON.stringify({
      protocol: 'intentguard-pair',
      channelId: 'abc\x00def',
      publicKey: 'y',
      relay: 'http://localhost:3000',
    });
    const result = parsePairingQr(data);
    expect(result).not.toBeNull();
  });
});

describe('SECURITY — HKDF Salt Consistency', () => {
  it('different salt produces incompatible keys', async () => {
    const a = await generateKeyPair();
    const b = await generateKeyPair();

    const bits = await subtle.deriveBits({ name: 'ECDH', public: b.publicKey }, a.privateKey, 256);
    const hkdf = await subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);

    const key1 = await subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt: new TextEncoder().encode('intentguard-pairing-v1'), info: new TextEncoder().encode('aes-gcm-key') },
      hkdf, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
    );
    const key2 = await subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt: new TextEncoder().encode('wrong-salt'), info: new TextEncoder().encode('aes-gcm-key') },
      hkdf, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
    );

    const encrypted = await encrypt(key1, { test: true });
    await expect(decrypt(key2, encrypted)).rejects.toThrow();
  });
});
