import { describe, it, expect } from 'vitest';
import { PublicKey, Keypair } from '@solana/web3.js';
import { findConfigPda, findIntentCommitPda } from '../../../packages/sdk/src/pdas';
import { INTENT_GUARD_PROGRAM_ID } from '../../../packages/sdk/src/constants';

describe('SDK — PDAs', () => {
  describe('findConfigPda', () => {
    it('returns a valid PublicKey and bump', () => {
      const [pda, bump] = findConfigPda();
      expect(pda.toBase58()).toBeTruthy();
      expect(typeof pda.toBase58()).toBe('string');
      expect(bump).toBeGreaterThanOrEqual(0);
      expect(bump).toBeLessThanOrEqual(255);
    });

    it('is deterministic', () => {
      const [pda1] = findConfigPda();
      const [pda2] = findConfigPda();
      expect(pda1.toBase58()).toEqual(pda2.toBase58());
    });

    it('accepts custom programId', () => {
      const customId = Keypair.generate().publicKey;
      const [pdaDefault] = findConfigPda();
      const [pdaCustom] = findConfigPda(customId);
      expect(pdaDefault.toBase58()).not.toEqual(pdaCustom.toBase58());
    });

    it('derives from "config" seed', () => {
      const [expected] = PublicKey.findProgramAddressSync(
        [Buffer.from('config')],
        INTENT_GUARD_PROGRAM_ID,
      );
      const [actual] = findConfigPda();
      expect(actual.toBase58()).toEqual(expected.toBase58());
    });
  });

  describe('findIntentCommitPda', () => {
    const user = Keypair.generate().publicKey;
    const appId = Keypair.generate().publicKey;

    it('returns a valid PublicKey and bump', () => {
      const [pda, bump] = findIntentCommitPda(user, appId);
      expect(pda.toBase58()).toBeTruthy();
      expect(typeof pda.toBase58()).toBe('string');
      expect(bump).toBeGreaterThanOrEqual(0);
      expect(bump).toBeLessThanOrEqual(255);
    });

    it('is deterministic for same user+appId', () => {
      const [pda1] = findIntentCommitPda(user, appId);
      const [pda2] = findIntentCommitPda(user, appId);
      expect(pda1.toBase58()).toEqual(pda2.toBase58());
    });

    it('different user produces different PDA', () => {
      const otherUser = Keypair.generate().publicKey;
      const [pda1] = findIntentCommitPda(user, appId);
      const [pda2] = findIntentCommitPda(otherUser, appId);
      expect(pda1.toBase58()).not.toEqual(pda2.toBase58());
    });

    it('different appId produces different PDA', () => {
      const otherApp = Keypair.generate().publicKey;
      const [pda1] = findIntentCommitPda(user, appId);
      const [pda2] = findIntentCommitPda(user, otherApp);
      expect(pda1.toBase58()).not.toEqual(pda2.toBase58());
    });

    it('matches manual derivation with seeds [intent, user, appId]', () => {
      const [expected] = PublicKey.findProgramAddressSync(
        [Buffer.from('intent'), user.toBuffer(), appId.toBuffer()],
        INTENT_GUARD_PROGRAM_ID,
      );
      const [actual] = findIntentCommitPda(user, appId);
      expect(actual.toBase58()).toEqual(expected.toBase58());
    });

    it('per-user per-app isolation: user1+app1 !== user1+app2 !== user2+app1', () => {
      const u1 = Keypair.generate().publicKey;
      const u2 = Keypair.generate().publicKey;
      const a1 = Keypair.generate().publicKey;
      const a2 = Keypair.generate().publicKey;

      const [p1] = findIntentCommitPda(u1, a1);
      const [p2] = findIntentCommitPda(u1, a2);
      const [p3] = findIntentCommitPda(u2, a1);

      const addresses = [p1.toBase58(), p2.toBase58(), p3.toBase58()];
      expect(new Set(addresses).size).toBe(3);
    });
  });
});
