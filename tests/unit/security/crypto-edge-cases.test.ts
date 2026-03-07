/**
 * Cryptographic Edge Case Tests — MAINNET CRITICAL
 *
 * Tests pairing crypto for:
 * - Key reuse detection
 * - IV reuse (nonce reuse) in AES-GCM = catastrophic
 * - Large payload encryption
 * - Concurrent encryption safety
 * - Key derivation with extreme inputs
 * - WebSocket relay message authentication
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

describe('CRITICAL — AES-GCM Nonce (IV) Uniqueness', () => {
  let sharedKey: CryptoKey;

  it('setup shared key', async () => {
    const a = await generateKeyPair();
    const b = await generateKeyPair();
    sharedKey = await deriveSharedKey(a.privateKey, b.publicKey);
  });

  it('100 encryptions produce 100 unique IVs', async () => {
    const ivs = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const { iv } = await encrypt(sharedKey, { i });
      ivs.add(iv);
    }
    expect(ivs.size).toBe(100);
    // IV reuse in AES-GCM is catastrophic — leaks key material
  });

  it('IVs are exactly 12 bytes (96 bits) for AES-GCM', async () => {
    const { iv } = await encrypt(sharedKey, { test: true });
    const ivBytes = Buffer.from(iv, 'base64');
    expect(ivBytes.length).toBe(12);
  });

  it('encrypting same plaintext twice produces different ciphertext', async () => {
    const data = { type: 'intent_needed', ts: 123 };
    const e1 = await encrypt(sharedKey, data);
    const e2 = await encrypt(sharedKey, data);
    expect(e1.data).not.toBe(e2.data);
    expect(e1.iv).not.toBe(e2.iv);
  });
});

describe('CRITICAL — Key Pair Uniqueness', () => {
  it('100 key pairs produce unique public keys', async () => {
    const pubKeys = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const kp = await generateKeyPair();
      const raw = await subtle.exportKey('raw', kp.publicKey);
      pubKeys.add(arrayBufToBase64(raw));
    }
    expect(pubKeys.size).toBe(100);
  });

  it('ECDH P-256 public key is 65 bytes (uncompressed)', async () => {
    const kp = await generateKeyPair();
    const raw = await subtle.exportKey('raw', kp.publicKey);
    expect(new Uint8Array(raw).length).toBe(65);
    // Uncompressed format: 0x04 prefix + 32 byte X + 32 byte Y
    expect(new Uint8Array(raw)[0]).toBe(0x04);
  });
});

describe('CRITICAL — Shared Secret Derivation', () => {
  it('ECDH is commutative: deriveKey(A.priv, B.pub) == deriveKey(B.priv, A.pub)', async () => {
    const a = await generateKeyPair();
    const b = await generateKeyPair();

    // Both sides derive same shared secret
    const keyAB = await deriveSharedKey(a.privateKey, b.publicKey);
    const keyBA = await deriveSharedKey(b.privateKey, a.publicKey);

    // Encrypt with one, decrypt with other
    const msg = { test: 'commutative' };
    const encrypted = await encrypt(keyAB, msg);
    const decrypted = await decrypt(keyBA, encrypted);
    expect(decrypted).toEqual(msg);
  });

  it('HKDF with intentguard-pairing-v1 salt is deterministic', async () => {
    const a = await generateKeyPair();
    const b = await generateKeyPair();

    // Derive twice with same inputs
    const key1 = await deriveSharedKey(a.privateKey, b.publicKey);
    const key2 = await deriveSharedKey(a.privateKey, b.publicKey);

    // Both should decrypt each other's messages
    const msg = { deterministic: true };
    const e1 = await encrypt(key1, msg);
    const d2 = await decrypt(key2, e1);
    expect(d2).toEqual(msg);
  });
});

describe('CRITICAL — Large Payload Encryption', () => {
  let sharedKey: CryptoKey;

  it('setup', async () => {
    const a = await generateKeyPair();
    const b = await generateKeyPair();
    sharedKey = await deriveSharedKey(a.privateKey, b.publicKey);
  });

  it('encrypts and decrypts 1MB payload', async () => {
    const largeData = { payload: 'x'.repeat(1_000_000) };
    const encrypted = await encrypt(sharedKey, largeData);
    const decrypted = await decrypt(sharedKey, encrypted);
    expect(decrypted.payload.length).toBe(1_000_000);
  });

  it('encrypts and decrypts deeply nested JSON', async () => {
    let nested: any = { value: 'deep' };
    for (let i = 0; i < 50; i++) {
      nested = { level: i, child: nested };
    }
    const encrypted = await encrypt(sharedKey, nested);
    const decrypted = await decrypt(sharedKey, encrypted);
    expect(decrypted.level).toBe(49);
  });

  it('handles special characters in payload', async () => {
    const data = {
      emoji: '\u{1F680}\u{1F525}',
      chinese: '你好世界',
      arabic: 'مرحبا',
      nullByte: 'before\0after',
      newlines: 'line1\nline2\r\nline3',
    };
    const encrypted = await encrypt(sharedKey, data);
    const decrypted = await decrypt(sharedKey, encrypted);
    expect(decrypted).toEqual(data);
  });
});

describe('CRITICAL — Concurrent Encryption Safety', () => {
  it('parallel encryptions produce unique IVs', async () => {
    const a = await generateKeyPair();
    const b = await generateKeyPair();
    const key = await deriveSharedKey(a.privateKey, b.publicKey);

    // Fire 50 encryptions in parallel
    const results = await Promise.all(
      Array.from({ length: 50 }, (_, i) => encrypt(key, { parallel: i })),
    );

    const ivs = results.map(r => r.iv);
    expect(new Set(ivs).size).toBe(50);
  });

  it('parallel encrypt/decrypt roundtrips all succeed', async () => {
    const a = await generateKeyPair();
    const b = await generateKeyPair();
    const key = await deriveSharedKey(a.privateKey, b.publicKey);

    const messages = Array.from({ length: 20 }, (_, i) => ({ id: i, data: `msg-${i}` }));
    const encrypted = await Promise.all(messages.map(m => encrypt(key, m)));
    const decrypted = await Promise.all(encrypted.map(e => decrypt(key, e)));

    for (let i = 0; i < messages.length; i++) {
      expect(decrypted[i]).toEqual(messages[i]);
    }
  });
});

describe('CRITICAL — Relay Message Authentication', () => {
  it('attacker on relay cannot read messages without shared key', async () => {
    const ext = await generateKeyPair();
    const mobile = await generateKeyPair();
    const attacker = await generateKeyPair();

    const sharedKey = await deriveSharedKey(ext.privateKey, mobile.publicKey);
    const attackerKey = await deriveSharedKey(attacker.privateKey, mobile.publicKey);

    const encrypted = await encrypt(sharedKey, { type: 'intent_needed', amount: '100 SOL' });

    // Attacker intercepts the relay message and tries to decrypt
    await expect(decrypt(attackerKey, encrypted)).rejects.toThrow();
  });

  it('attacker cannot forge messages without shared key', async () => {
    const ext = await generateKeyPair();
    const mobile = await generateKeyPair();
    const attacker = await generateKeyPair();

    const realKey = await deriveSharedKey(ext.privateKey, mobile.publicKey);
    const attackerKey = await deriveSharedKey(attacker.privateKey, ext.publicKey);

    // Attacker forges a message
    const forged = await encrypt(attackerKey, { type: 'intent_committed', forged: true });

    // Mobile tries to decrypt with real shared key — fails
    await expect(decrypt(realKey, forged)).rejects.toThrow();
  });

  it('attacker cannot replay encrypted messages across sessions', async () => {
    // Session 1
    const ext1 = await generateKeyPair();
    const mobile1 = await generateKeyPair();
    const key1 = await deriveSharedKey(ext1.privateKey, mobile1.publicKey);
    const msg1 = await encrypt(key1, { type: 'intent_needed' });

    // Session 2 (new key pairs)
    const ext2 = await generateKeyPair();
    const mobile2 = await generateKeyPair();
    const key2 = await deriveSharedKey(ext2.privateKey, mobile2.publicKey);

    // Replayed message from session 1 fails in session 2
    await expect(decrypt(key2, msg1)).rejects.toThrow();
  });

  it('bit-flip in any position of relay message is detected', async () => {
    const ext = await generateKeyPair();
    const mobile = await generateKeyPair();
    const key = await deriveSharedKey(ext.privateKey, mobile.publicKey);

    const encrypted = await encrypt(key, { sensitive: true });
    const ctBytes = Buffer.from(encrypted.data, 'base64');

    // Flip every byte in first 20 positions
    for (let i = 0; i < Math.min(ctBytes.length, 20); i++) {
      const tampered = Buffer.from(ctBytes);
      tampered[i] ^= 0x01;
      await expect(
        decrypt(key, { ...encrypted, data: tampered.toString('base64') }),
      ).rejects.toThrow();
    }
  });
});

describe('CRITICAL — Key Export/Import Integrity', () => {
  it('exported public key can be reimported and used for key exchange', async () => {
    const ext = await generateKeyPair();
    const mobile = await generateKeyPair();

    // Export ext's public key (simulates QR code transfer)
    const extPubRaw = await subtle.exportKey('raw', ext.publicKey);
    const extPubB64 = arrayBufToBase64(extPubRaw);

    // Mobile imports ext's public key
    const importedExtPub = await subtle.importKey(
      'raw', base64ToArrayBuf(extPubB64),
      { name: 'ECDH', namedCurve: 'P-256' }, true, [],
    );

    // Both derive shared key
    const keyExt = await deriveSharedKey(ext.privateKey, mobile.publicKey);
    const keyMobile = await deriveSharedKey(mobile.privateKey, importedExtPub);

    // Should be able to communicate
    const msg = { imported: true };
    const encrypted = await encrypt(keyExt, msg);
    const decrypted = await decrypt(keyMobile, encrypted);
    expect(decrypted).toEqual(msg);
  });

  it('corrupted public key import fails', async () => {
    const kp = await generateKeyPair();
    const raw = await subtle.exportKey('raw', kp.publicKey);
    const corrupted = new Uint8Array(raw);
    corrupted[0] = 0x05; // Invalid prefix (should be 0x04 for uncompressed)

    await expect(
      subtle.importKey('raw', corrupted, { name: 'ECDH', namedCurve: 'P-256' }, true, []),
    ).rejects.toThrow();
  });

  it('truncated public key import fails', async () => {
    const kp = await generateKeyPair();
    const raw = await subtle.exportKey('raw', kp.publicKey);
    const truncated = new Uint8Array(raw).slice(0, 32); // Only half the key

    await expect(
      subtle.importKey('raw', truncated, { name: 'ECDH', namedCurve: 'P-256' }, true, []),
    ).rejects.toThrow();
  });

  it('wrong curve key cannot be used for derivation', async () => {
    // Generate P-256 key
    const p256 = await generateKeyPair();
    // Generate P-384 key
    const p384 = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-384' }, true, ['deriveBits']);

    // Try to derive with mismatched curves
    await expect(
      subtle.deriveBits({ name: 'ECDH', public: p384.publicKey }, p256.privateKey, 256),
    ).rejects.toThrow();
  });
});
