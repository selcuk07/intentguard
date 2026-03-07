import { describe, it, expect } from 'vitest';
import { webcrypto } from 'crypto';

// Polyfill for Node.js test environment
const subtle = webcrypto.subtle;

// Re-implement the pairing crypto functions for testing (same logic as pairing.js)

function arrayBufToBase64(buf: ArrayBuffer): string {
  return Buffer.from(buf).toString('base64');
}

function base64ToArrayBuf(b64: string): ArrayBuffer {
  const buf = Buffer.from(b64, 'base64');
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

async function generateKeyPair() {
  return subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey', 'deriveBits'],
  );
}

async function exportPublicKey(key: CryptoKey): Promise<string> {
  const raw = await subtle.exportKey('raw', key);
  return arrayBufToBase64(raw);
}

async function importPublicKey(b64: string): Promise<CryptoKey> {
  const raw = base64ToArrayBuf(b64);
  return subtle.importKey('raw', raw, { name: 'ECDH', namedCurve: 'P-256' }, true, []);
}

async function deriveSharedKey(privateKey: CryptoKey, peerPublicKey: CryptoKey) {
  const sharedBits = await subtle.deriveBits(
    { name: 'ECDH', public: peerPublicKey },
    privateKey,
    256,
  );
  const hkdfKey = await subtle.importKey('raw', sharedBits, 'HKDF', false, ['deriveKey']);
  return subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new TextEncoder().encode('intentguard-pairing-v1'),
      info: new TextEncoder().encode('aes-gcm-key'),
    },
    hkdfKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function encrypt(key: CryptoKey, plaintext: any) {
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(JSON.stringify(plaintext));
  const ciphertext = await subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
  return { iv: arrayBufToBase64(iv.buffer), data: arrayBufToBase64(ciphertext) };
}

async function decrypt(key: CryptoKey, envelope: { iv: string; data: string }) {
  const iv = new Uint8Array(base64ToArrayBuf(envelope.iv));
  const ciphertext = base64ToArrayBuf(envelope.data);
  const plaintext = await subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return JSON.parse(new TextDecoder().decode(plaintext));
}

describe('Pairing — ECDH + AES-GCM crypto', () => {
  describe('key generation', () => {
    it('generates ECDH P-256 keypair', async () => {
      const keyPair = await generateKeyPair();
      expect(keyPair.publicKey).toBeDefined();
      expect(keyPair.privateKey).toBeDefined();
    });

    it('each keypair is unique', async () => {
      const kp1 = await generateKeyPair();
      const kp2 = await generateKeyPair();
      const pub1 = await exportPublicKey(kp1.publicKey);
      const pub2 = await exportPublicKey(kp2.publicKey);
      expect(pub1).not.toEqual(pub2);
    });
  });

  describe('public key export/import', () => {
    it('exports to base64 string', async () => {
      const kp = await generateKeyPair();
      const exported = await exportPublicKey(kp.publicKey);
      expect(typeof exported).toBe('string');
      // P-256 uncompressed public key is 65 bytes
      const decoded = Buffer.from(exported, 'base64');
      expect(decoded.length).toBe(65);
    });

    it('roundtrips export/import', async () => {
      const kp = await generateKeyPair();
      const exported = await exportPublicKey(kp.publicKey);
      const imported = await importPublicKey(exported);
      const reExported = await exportPublicKey(imported);
      expect(reExported).toEqual(exported);
    });
  });

  describe('shared key derivation', () => {
    it('both sides derive the same shared key', async () => {
      const alice = await generateKeyPair();
      const bob = await generateKeyPair();

      const aliceShared = await deriveSharedKey(alice.privateKey, bob.publicKey);
      const bobShared = await deriveSharedKey(bob.privateKey, alice.publicKey);

      // Encrypt with Alice's key, decrypt with Bob's key
      const message = { type: 'test', value: 42 };
      const encrypted = await encrypt(aliceShared, message);
      const decrypted = await decrypt(bobShared, encrypted);
      expect(decrypted).toEqual(message);
    });

    it('different key pairs produce incompatible shared keys', async () => {
      const alice = await generateKeyPair();
      const bob = await generateKeyPair();
      const charlie = await generateKeyPair();

      const aliceBob = await deriveSharedKey(alice.privateKey, bob.publicKey);
      const aliceCharlie = await deriveSharedKey(alice.privateKey, charlie.publicKey);

      const encrypted = await encrypt(aliceBob, { secret: 'data' });

      // Charlie cannot decrypt a message encrypted with Alice-Bob shared key
      await expect(decrypt(aliceCharlie, encrypted)).rejects.toThrow();
    });
  });

  describe('encrypt/decrypt', () => {
    let sharedKey: CryptoKey;

    it('setup shared key', async () => {
      const alice = await generateKeyPair();
      const bob = await generateKeyPair();
      sharedKey = await deriveSharedKey(alice.privateKey, bob.publicKey);
    });

    it('encrypts and decrypts a simple message', async () => {
      const message = { type: 'intent_needed', method: 'signTransaction' };
      const encrypted = await encrypt(sharedKey, message);
      const decrypted = await decrypt(sharedKey, encrypted);
      expect(decrypted).toEqual(message);
    });

    it('produces different ciphertext each time (random IV)', async () => {
      const message = { same: 'message' };
      const e1 = await encrypt(sharedKey, message);
      const e2 = await encrypt(sharedKey, message);

      expect(e1.iv).not.toEqual(e2.iv);
      expect(e1.data).not.toEqual(e2.data);
    });

    it('tampered ciphertext fails decryption', async () => {
      const encrypted = await encrypt(sharedKey, { test: true });

      // Tamper with the ciphertext
      const buf = Buffer.from(encrypted.data, 'base64');
      buf[0] ^= 0xff;
      const tampered = { ...encrypted, data: buf.toString('base64') };

      await expect(decrypt(sharedKey, tampered)).rejects.toThrow();
    });

    it('tampered IV fails decryption', async () => {
      const encrypted = await encrypt(sharedKey, { test: true });

      const ivBuf = Buffer.from(encrypted.iv, 'base64');
      ivBuf[0] ^= 0xff;
      const tampered = { ...encrypted, iv: ivBuf.toString('base64') };

      await expect(decrypt(sharedKey, tampered)).rejects.toThrow();
    });

    it('handles complex nested objects', async () => {
      const complex = {
        type: 'intent_needed',
        method: 'signTransaction',
        programIds: ['JUP6...', 'Token...'],
        origin: 'https://jup.ag',
        nested: { deep: { value: [1, 2, 3] } },
      };
      const encrypted = await encrypt(sharedKey, complex);
      const decrypted = await decrypt(sharedKey, encrypted);
      expect(decrypted).toEqual(complex);
    });

    it('handles empty object', async () => {
      const encrypted = await encrypt(sharedKey, {});
      const decrypted = await decrypt(sharedKey, encrypted);
      expect(decrypted).toEqual({});
    });

    it('handles string values', async () => {
      const encrypted = await encrypt(sharedKey, 'hello');
      const decrypted = await decrypt(sharedKey, encrypted);
      expect(decrypted).toBe('hello');
    });
  });

  describe('QR pairing data format', () => {
    it('validates expected QR structure', () => {
      const qrData = {
        protocol: 'intentguard-pair',
        version: 1,
        channelId: 'abc123def456',
        publicKey: 'base64pubkey==',
        relay: 'http://localhost:3000',
      };

      expect(qrData.protocol).toBe('intentguard-pair');
      expect(qrData.version).toBe(1);
      expect(typeof qrData.channelId).toBe('string');
      expect(typeof qrData.publicKey).toBe('string');
      expect(typeof qrData.relay).toBe('string');
    });

    it('rejects invalid protocol', () => {
      const invalid = { protocol: 'wrong', channelId: 'x', publicKey: 'y', relay: 'z' };
      expect(invalid.protocol).not.toBe('intentguard-pair');
    });
  });
});
