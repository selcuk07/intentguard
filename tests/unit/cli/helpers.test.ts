import { describe, it, expect, vi } from 'vitest';
import { PublicKey, Keypair } from '@solana/web3.js';
import {
  findConfigPda,
  findIntentPda,
  computeHash,
  computeActionHash,
  shortKey,
  formatTimestamp,
  getRpcUrl,
  PROGRAM_ID,
} from '../../../cli/src/helpers';

describe('CLI — helpers', () => {
  describe('PROGRAM_ID', () => {
    it('is a valid PublicKey', () => {
      expect(PROGRAM_ID.toBase58()).toBeTruthy();
      expect(typeof PROGRAM_ID.toBase58()).toBe('string');
    });

    it('matches expected devnet program', () => {
      expect(PROGRAM_ID.toBase58()).toBe('4etWfDJNHhjYdv7fuGe236GDPguwUXVk9WhbEpQsPix7');
    });
  });

  describe('findConfigPda', () => {
    it('returns [PublicKey, number]', () => {
      const [pda, bump] = findConfigPda();
      expect(pda.toBase58()).toBeTruthy();
      expect(typeof bump).toBe('number');
    });

    it('is deterministic', () => {
      expect(findConfigPda()[0].toBase58()).toBe(findConfigPda()[0].toBase58());
    });
  });

  describe('findIntentPda', () => {
    const user = Keypair.generate().publicKey;
    const appId = Keypair.generate().publicKey;

    it('returns deterministic PDA', () => {
      const [a] = findIntentPda(user, appId);
      const [b] = findIntentPda(user, appId);
      expect(a.toBase58()).toBe(b.toBase58());
    });

    it('different users get different PDAs', () => {
      const [a] = findIntentPda(user, appId);
      const [b] = findIntentPda(Keypair.generate().publicKey, appId);
      expect(a.toBase58()).not.toBe(b.toBase58());
    });
  });

  describe('computeHash', () => {
    it('returns 32-byte array', () => {
      const hash = computeHash([Buffer.from('test')]);
      expect(hash).toHaveLength(32);
    });

    it('is deterministic', () => {
      const a = computeHash([Buffer.from('x')]);
      const b = computeHash([Buffer.from('x')]);
      expect(a).toEqual(b);
    });

    it('different inputs give different hashes', () => {
      const a = computeHash([Buffer.from('a')]);
      const b = computeHash([Buffer.from('b')]);
      expect(a).not.toEqual(b);
    });
  });

  describe('computeActionHash', () => {
    const appId = Keypair.generate().publicKey;
    const user = Keypair.generate().publicKey;

    it('returns 32-byte array', () => {
      const hash = computeActionHash(appId, user, 'swap', { amount: '100' });
      expect(hash).toHaveLength(32);
    });

    it('is deterministic', () => {
      const a = computeActionHash(appId, user, 'swap', { amount: '100' });
      const b = computeActionHash(appId, user, 'swap', { amount: '100' });
      expect(a).toEqual(b);
    });

    it('different actions produce different hashes', () => {
      const a = computeActionHash(appId, user, 'swap', { amount: '100' });
      const b = computeActionHash(appId, user, 'transfer', { amount: '100' });
      expect(a).not.toEqual(b);
    });

    it('different params produce different hashes', () => {
      const a = computeActionHash(appId, user, 'swap', { amount: '100' });
      const b = computeActionHash(appId, user, 'swap', { amount: '200' });
      expect(a).not.toEqual(b);
    });

    it('param key order does not matter (sorted)', () => {
      const a = computeActionHash(appId, user, 'swap', { amount: '100', mint: 'USDC' });
      const b = computeActionHash(appId, user, 'swap', { mint: 'USDC', amount: '100' });
      expect(a).toEqual(b);
    });
  });

  describe('shortKey', () => {
    it('formats as first4...last4', () => {
      const pk = Keypair.generate().publicKey;
      const short = shortKey(pk);
      const base58 = pk.toBase58();
      expect(short).toBe(`${base58.slice(0, 4)}...${base58.slice(-4)}`);
    });
  });

  describe('formatTimestamp', () => {
    it('formats Unix timestamp to ISO string', () => {
      const ts = 1700000000; // 2023-11-14
      const result = formatTimestamp(ts);
      expect(result).toContain('2023');
      expect(result).toContain('UTC');
    });

    it('removes milliseconds', () => {
      const result = formatTimestamp(1700000000);
      expect(result).not.toContain('.000');
    });
  });

  describe('getRpcUrl', () => {
    it('defaults to devnet', () => {
      const url = getRpcUrl();
      expect(url).toContain('devnet');
    });

    it('returns devnet URL for "devnet"', () => {
      expect(getRpcUrl('devnet')).toContain('devnet');
    });

    it('returns mainnet URL for "mainnet-beta"', () => {
      expect(getRpcUrl('mainnet-beta')).toContain('mainnet-beta');
    });

    it('returns mainnet URL for "mainnet"', () => {
      expect(getRpcUrl('mainnet')).toContain('mainnet-beta');
    });

    it('returns localhost for "localnet"', () => {
      expect(getRpcUrl('localnet')).toBe('http://localhost:8899');
    });

    it('returns localhost for "localhost"', () => {
      expect(getRpcUrl('localhost')).toBe('http://localhost:8899');
    });

    it('treats unknown string as custom RPC URL', () => {
      expect(getRpcUrl('https://my-rpc.com')).toBe('https://my-rpc.com');
    });
  });
});
