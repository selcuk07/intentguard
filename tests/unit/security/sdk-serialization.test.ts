/**
 * SDK Serialization Security Tests
 *
 * Instruction data'nin dogru serialize edildigini dogrular.
 * Yanlis serialization mainnet'te fon kaybina neden olabilir.
 */
import { describe, it, expect } from 'vitest';
import { Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import {
  createCommitIntentInstruction,
  createVerifyIntentInstruction,
  createRevokeIntentInstruction,
  createPauseProtocolInstruction,
  createUnpauseProtocolInstruction,
  createTransferAdminInstruction,
  createUpdateFeeInstruction,
  createWithdrawFeesInstruction,
} from '../../../packages/sdk/src/instructions';
import { INTENT_GUARD_PROGRAM_ID } from '../../../packages/sdk/src/constants';

describe('SECURITY — SDK Serialization', () => {
  const user = Keypair.generate().publicKey;
  const appId = Keypair.generate().publicKey;

  describe('Discriminator Integrity', () => {
    // These must NEVER change or mainnet txs will fail
    it('commit discriminator is [175,152,13,10,40,234,201,8]', () => {
      const ix = createCommitIntentInstruction(user, appId, new Array(32).fill(0), 300);
      const disc = Array.from(ix.data.slice(0, 8));
      expect(disc).toEqual([175, 152, 13, 10, 40, 234, 201, 8]);
    });

    it('verify discriminator is [240,198,213,223,94,7,247,247]', () => {
      const ix = createVerifyIntentInstruction(user, appId, new Array(32).fill(0));
      const disc = Array.from(ix.data.slice(0, 8));
      expect(disc).toEqual([240, 198, 213, 223, 94, 7, 247, 247]);
    });

    it('revoke discriminator is [42,248,79,132,107,96,193,153]', () => {
      const ix = createRevokeIntentInstruction(user, appId);
      const disc = Array.from(ix.data.slice(0, 8));
      expect(disc).toEqual([42, 248, 79, 132, 107, 96, 193, 153]);
    });

    it('pause discriminator is [144,95,0,107,119,39,248,141]', () => {
      const ix = createPauseProtocolInstruction(user);
      const disc = Array.from(ix.data.slice(0, 8));
      expect(disc).toEqual([144, 95, 0, 107, 119, 39, 248, 141]);
    });

    it('unpause discriminator is [183,154,5,183,105,76,87,18]', () => {
      const ix = createUnpauseProtocolInstruction(user);
      const disc = Array.from(ix.data.slice(0, 8));
      expect(disc).toEqual([183, 154, 5, 183, 105, 76, 87, 18]);
    });

    it('transfer_admin discriminator is [42,242,66,106,228,10,111,156]', () => {
      const ix = createTransferAdminInstruction(user, Keypair.generate().publicKey);
      const disc = Array.from(ix.data.slice(0, 8));
      expect(disc).toEqual([42, 242, 66, 106, 228, 10, 111, 156]);
    });

    it('update_fee discriminator is [232,253,195,247,148,212,73,222]', () => {
      const ix = createUpdateFeeInstruction(user, 1000);
      const disc = Array.from(ix.data.slice(0, 8));
      expect(disc).toEqual([232, 253, 195, 247, 148, 212, 73, 222]);
    });

    it('withdraw_fees discriminator is [198,212,171,109,144,215,174,89]', () => {
      const ix = createWithdrawFeesInstruction(user, 1000);
      const disc = Array.from(ix.data.slice(0, 8));
      expect(disc).toEqual([198, 212, 171, 109, 144, 215, 174, 89]);
    });

    it('all discriminators are unique (including fee instructions)', () => {
      const admin = Keypair.generate().publicKey;
      const instructions = [
        createCommitIntentInstruction(user, appId, new Array(32).fill(0), 300),
        createVerifyIntentInstruction(user, appId, new Array(32).fill(0)),
        createRevokeIntentInstruction(user, appId),
        createPauseProtocolInstruction(admin),
        createUnpauseProtocolInstruction(admin),
        createTransferAdminInstruction(admin, user),
        createUpdateFeeInstruction(admin, 1000),
        createWithdrawFeesInstruction(admin, 1000),
      ];

      const discs = instructions.map((ix) => Array.from(ix.data.slice(0, 8)).join(','));
      expect(new Set(discs).size).toBe(discs.length);
    });
  });

  describe('Data Layout Correctness', () => {
    it('commit: appId at correct offset (8-40)', () => {
      const ix = createCommitIntentInstruction(user, appId, new Array(32).fill(0xaa), 300);
      const encoded = ix.data.slice(8, 40);
      expect(Buffer.from(encoded)).toEqual(appId.toBuffer());
    });

    it('commit: hash at correct offset (40-72)', () => {
      const hash = Array.from({ length: 32 }, (_, i) => i);
      const ix = createCommitIntentInstruction(user, appId, hash, 300);
      const encoded = Array.from(ix.data.slice(40, 72));
      expect(encoded).toEqual(hash);
    });

    it('commit: TTL at correct offset (72-80) as i64 LE', () => {
      const ix = createCommitIntentInstruction(user, appId, new Array(32).fill(0), 3600);
      const view = new DataView(ix.data.buffer, ix.data.byteOffset);
      expect(Number(view.getBigInt64(72, true))).toBe(3600);
    });

    it('commit: TTL=0 encodes as 0 (not 300 — program handles default)', () => {
      const ix = createCommitIntentInstruction(user, appId, new Array(32).fill(0), 0);
      const view = new DataView(ix.data.buffer, ix.data.byteOffset);
      expect(Number(view.getBigInt64(72, true))).toBe(0);
    });

    it('verify: hash at correct offset (8-40)', () => {
      const hash = Array.from({ length: 32 }, (_, i) => 255 - i);
      const ix = createVerifyIntentInstruction(user, appId, hash);
      expect(Array.from(ix.data.slice(8, 40))).toEqual(hash);
    });

    it('transfer_admin: new_admin at correct offset (8-40)', () => {
      const newAdmin = Keypair.generate().publicKey;
      const ix = createTransferAdminInstruction(user, newAdmin);
      expect(Buffer.from(ix.data.slice(8, 40))).toEqual(newAdmin.toBuffer());
    });

    it('update_fee: fee at correct offset (8-16) as u64 LE', () => {
      const ix = createUpdateFeeInstruction(user, 50_000_000);
      const view = new DataView(ix.data.buffer, ix.data.byteOffset);
      expect(Number(view.getBigUint64(8, true))).toBe(50_000_000);
    });

    it('withdraw_fees: amount at correct offset (8-16) as u64 LE', () => {
      const ix = createWithdrawFeesInstruction(user, 999_999);
      const view = new DataView(ix.data.buffer, ix.data.byteOffset);
      expect(Number(view.getBigUint64(8, true))).toBe(999_999);
    });
  });

  describe('Account Key Ordering (Critical for on-chain validation)', () => {
    it('commit: key order is [intentPda, config, user, system]', () => {
      const ix = createCommitIntentInstruction(user, appId, new Array(32).fill(0), 300);
      expect(ix.keys[0].isSigner).toBe(false); // intentPda
      expect(ix.keys[0].isWritable).toBe(true);
      expect(ix.keys[1].isSigner).toBe(false); // config
      expect(ix.keys[1].isWritable).toBe(true);
      expect(ix.keys[2].isSigner).toBe(true);  // user
      expect(ix.keys[2].isWritable).toBe(true);
      expect(ix.keys[3].pubkey.toBase58()).toBe(SystemProgram.programId.toBase58());
    });

    it('verify: key order is [intentPda, config, user, systemProgram]', () => {
      const ix = createVerifyIntentInstruction(user, appId, new Array(32).fill(0));
      expect(ix.keys).toHaveLength(4);
      expect(ix.keys[2].isSigner).toBe(true);
      expect(ix.keys[2].pubkey.toBase58()).toBe(user.toBase58());
      expect(ix.keys[3].pubkey.toBase58()).toBe(SystemProgram.programId.toBase58());
    });

    it('revoke: key order is [intentPda, user]', () => {
      const ix = createRevokeIntentInstruction(user, appId);
      expect(ix.keys).toHaveLength(2);
      expect(ix.keys[1].isSigner).toBe(true);
      expect(ix.keys[1].pubkey.toBase58()).toBe(user.toBase58());
    });
  });

  describe('Uint8Array Hash Input Support', () => {
    it('accepts Uint8Array for hash (not just number[])', () => {
      const hash = new Uint8Array(32).fill(0xbb);
      const ix = createCommitIntentInstruction(user, appId, hash, 300);
      expect(Array.from(ix.data.slice(40, 72))).toEqual(Array.from(hash));
    });

    it('commit and verify produce compatible hashes', () => {
      const hash = Array.from({ length: 32 }, (_, i) => i);
      const commitIx = createCommitIntentInstruction(user, appId, hash, 300);
      const verifyIx = createVerifyIntentInstruction(user, appId, hash);

      const commitHash = Array.from(commitIx.data.slice(40, 72));
      const verifyHash = Array.from(verifyIx.data.slice(8, 40));
      expect(commitHash).toEqual(verifyHash);
    });
  });

  describe('Program ID Consistency', () => {
    it('default programId matches INTENT_GUARD_PROGRAM_ID', () => {
      const ix = createCommitIntentInstruction(user, appId, new Array(32).fill(0), 300);
      expect(ix.programId.toBase58()).toBe(INTENT_GUARD_PROGRAM_ID.toBase58());
      expect(ix.programId.toBase58()).toBe('4etWfDJNHhjYdv7fuGe236GDPguwUXVk9WhbEpQsPix7');
    });
  });
});
