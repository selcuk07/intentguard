import { describe, it, expect } from 'vitest';
import { createHash } from 'crypto';
import { PublicKey } from '@solana/web3.js';
import { computeIntentHash, getIntentCommit } from '../../../packages/sdk/src/client';

describe('SDK — client', () => {
  describe('computeIntentHash', () => {
    it('returns a 32-byte array', () => {
      const hash = computeIntentHash([Buffer.from('test')]);
      expect(hash).toHaveLength(32);
      expect(hash.every((b) => b >= 0 && b <= 255)).toBe(true);
    });

    it('matches manual SHA-256 with length-prefix', () => {
      const input = Buffer.from('hello-intentguard');
      const hash = computeIntentHash([input]);
      // computeIntentHash uses length-prefixed encoding: [len:u32le][data] per buffer
      const lenBuf = Buffer.alloc(4);
      lenBuf.writeUInt32LE(input.length, 0);
      const expected = createHash('sha256').update(lenBuf).update(input).digest();
      expect(hash).toEqual(Array.from(expected));
    });

    it('length-prefixes multiple buffers to prevent concatenation ambiguity', () => {
      const a = Buffer.from('foo');
      const b = Buffer.from('bar');
      const hash = computeIntentHash([a, b]);

      const lenA = Buffer.alloc(4);
      lenA.writeUInt32LE(a.length, 0);
      const lenB = Buffer.alloc(4);
      lenB.writeUInt32LE(b.length, 0);
      const expected = createHash('sha256').update(lenA).update(a).update(lenB).update(b).digest();
      expect(hash).toEqual(Array.from(expected));

      // Verify that different splits produce different hashes
      const ab = Buffer.from('foobar');
      const hashSingle = computeIntentHash([ab]);
      expect(hash).not.toEqual(hashSingle);
    });

    it('different inputs produce different hashes', () => {
      const h1 = computeIntentHash([Buffer.from('input1')]);
      const h2 = computeIntentHash([Buffer.from('input2')]);
      expect(h1).not.toEqual(h2);
    });

    it('same input produces same hash (deterministic)', () => {
      const input = [Buffer.from('deterministic')];
      const h1 = computeIntentHash(input);
      const h2 = computeIntentHash(input);
      expect(h1).toEqual(h2);
    });

    it('handles empty buffer with length-prefix', () => {
      const hash = computeIntentHash([Buffer.alloc(0)]);
      const lenBuf = Buffer.alloc(4);
      lenBuf.writeUInt32LE(0, 0);
      const expected = createHash('sha256').update(lenBuf).digest();
      expect(hash).toEqual(Array.from(expected));
    });

    it('handles pubkey buffers', () => {
      const pk = PublicKey.default;
      const hash = computeIntentHash([pk.toBuffer()]);
      expect(hash).toHaveLength(32);
    });
  });

  describe('getIntentCommit', () => {
    it('returns false when account does not exist', async () => {
      const mockConnection = {
        getAccountInfo: async () => null,
      };
      const result = await getIntentCommit(
        mockConnection,
        PublicKey.default,
        PublicKey.default,
        new PublicKey('4etWfDJNHhjYdv7fuGe236GDPguwUXVk9WhbEpQsPix7'),
      );
      expect(result).toBe(false);
    });

    it('returns true when account exists', async () => {
      const mockConnection = {
        getAccountInfo: async () => ({ data: Buffer.alloc(121) }),
      };
      const result = await getIntentCommit(
        mockConnection,
        PublicKey.default,
        PublicKey.default,
        new PublicKey('4etWfDJNHhjYdv7fuGe236GDPguwUXVk9WhbEpQsPix7'),
      );
      expect(result).toBe(true);
    });
  });
});
