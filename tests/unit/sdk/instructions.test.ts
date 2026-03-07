import { describe, it, expect } from 'vitest';
import { PublicKey, Keypair, SystemProgram } from '@solana/web3.js';
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
import { findIntentCommitPda, findConfigPda } from '../../../packages/sdk/src/pdas';

describe('SDK — instructions', () => {
  const user = Keypair.generate().publicKey;
  const appId = Keypair.generate().publicKey;
  const hash = Array.from({ length: 32 }, (_, i) => i);

  describe('createCommitIntentInstruction', () => {
    const ix = createCommitIntentInstruction(user, appId, hash, 300);

    it('uses correct programId', () => {
      expect(ix.programId.toBase58()).toBe(INTENT_GUARD_PROGRAM_ID.toBase58());
    });

    it('has 4 account keys', () => {
      expect(ix.keys).toHaveLength(4);
    });

    it('includes intentPda (writable, not signer)', () => {
      const [expectedPda] = findIntentCommitPda(user, appId);
      expect(ix.keys[0].pubkey.toBase58()).toBe(expectedPda.toBase58());
      expect(ix.keys[0].isWritable).toBe(true);
      expect(ix.keys[0].isSigner).toBe(false);
    });

    it('includes configPda (writable, not signer)', () => {
      const [expectedConfig] = findConfigPda();
      expect(ix.keys[1].pubkey.toBase58()).toBe(expectedConfig.toBase58());
      expect(ix.keys[1].isWritable).toBe(true);
      expect(ix.keys[1].isSigner).toBe(false);
    });

    it('includes user as signer', () => {
      expect(ix.keys[2].pubkey.toBase58()).toBe(user.toBase58());
      expect(ix.keys[2].isSigner).toBe(true);
      expect(ix.keys[2].isWritable).toBe(true);
    });

    it('includes system program', () => {
      expect(ix.keys[3].pubkey.toBase58()).toBe(SystemProgram.programId.toBase58());
    });

    it('has correct data length: 8 + 32 + 32 + 8 = 80', () => {
      expect(ix.data.length).toBe(80);
    });

    it('encodes TTL as little-endian i64', () => {
      const ttlBytes = ix.data.slice(72, 80);
      const view = new DataView(ttlBytes.buffer, ttlBytes.byteOffset, 8);
      expect(Number(view.getBigInt64(0, true))).toBe(300);
    });

    it('encodes intent hash in data', () => {
      const encodedHash = Array.from(ix.data.slice(40, 72));
      expect(encodedHash).toEqual(hash);
    });

    it('encodes appId in data', () => {
      const encodedApp = ix.data.slice(8, 40);
      expect(Buffer.from(encodedApp)).toEqual(appId.toBuffer());
    });
  });

  describe('createVerifyIntentInstruction', () => {
    const ix = createVerifyIntentInstruction(user, appId, hash);

    it('has 4 account keys (intentPda, config, user, systemProgram)', () => {
      expect(ix.keys).toHaveLength(4);
    });

    it('has correct data length: 8 + 32 = 40', () => {
      expect(ix.data.length).toBe(40);
    });

    it('encodes intent hash in data', () => {
      const encodedHash = Array.from(ix.data.slice(8, 40));
      expect(encodedHash).toEqual(hash);
    });

    it('user is signer', () => {
      expect(ix.keys[2].pubkey.toBase58()).toBe(user.toBase58());
      expect(ix.keys[2].isSigner).toBe(true);
    });
  });

  describe('createRevokeIntentInstruction', () => {
    const ix = createRevokeIntentInstruction(user, appId);

    it('has 2 account keys', () => {
      expect(ix.keys).toHaveLength(2);
    });

    it('has correct data length: 8 + 32 = 40', () => {
      expect(ix.data.length).toBe(40);
    });

    it('encodes appId in data', () => {
      const encodedApp = ix.data.slice(8, 40);
      expect(Buffer.from(encodedApp)).toEqual(appId.toBuffer());
    });
  });

  describe('createPauseProtocolInstruction', () => {
    const admin = Keypair.generate().publicKey;
    const ix = createPauseProtocolInstruction(admin);

    it('has 2 account keys', () => {
      expect(ix.keys).toHaveLength(2);
    });

    it('admin is signer', () => {
      expect(ix.keys[1].pubkey.toBase58()).toBe(admin.toBase58());
      expect(ix.keys[1].isSigner).toBe(true);
    });

    it('configPda is writable', () => {
      const [expectedConfig] = findConfigPda();
      expect(ix.keys[0].pubkey.toBase58()).toBe(expectedConfig.toBase58());
      expect(ix.keys[0].isWritable).toBe(true);
    });

    it('data is just 8-byte discriminator', () => {
      expect(ix.data.length).toBe(8);
    });
  });

  describe('createUnpauseProtocolInstruction', () => {
    const admin = Keypair.generate().publicKey;
    const ix = createUnpauseProtocolInstruction(admin);

    it('has 2 keys, 8-byte data', () => {
      expect(ix.keys).toHaveLength(2);
      expect(ix.data.length).toBe(8);
    });

    it('different discriminator from pause', () => {
      const pauseIx = createPauseProtocolInstruction(admin);
      expect(ix.data).not.toEqual(pauseIx.data);
    });
  });

  describe('createTransferAdminInstruction', () => {
    const admin = Keypair.generate().publicKey;
    const newAdmin = Keypair.generate().publicKey;
    const ix = createTransferAdminInstruction(admin, newAdmin);

    it('has 2 keys', () => {
      expect(ix.keys).toHaveLength(2);
    });

    it('has data length: 8 + 32 = 40', () => {
      expect(ix.data.length).toBe(40);
    });

    it('encodes new admin pubkey in data', () => {
      const encodedNewAdmin = ix.data.slice(8, 40);
      expect(Buffer.from(encodedNewAdmin)).toEqual(newAdmin.toBuffer());
    });
  });

  describe('createUpdateFeeInstruction', () => {
    const admin = Keypair.generate().publicKey;
    const ix = createUpdateFeeInstruction(admin, 50_000_000);

    it('has 2 account keys', () => {
      expect(ix.keys).toHaveLength(2);
    });

    it('admin is signer', () => {
      expect(ix.keys[1].pubkey.toBase58()).toBe(admin.toBase58());
      expect(ix.keys[1].isSigner).toBe(true);
    });

    it('configPda is writable', () => {
      const [expectedConfig] = findConfigPda();
      expect(ix.keys[0].pubkey.toBase58()).toBe(expectedConfig.toBase58());
      expect(ix.keys[0].isWritable).toBe(true);
    });

    it('has correct data length: 8 + 8 = 16', () => {
      expect(ix.data.length).toBe(16);
    });

    it('encodes fee as little-endian u64', () => {
      const view = new DataView(ix.data.buffer, ix.data.byteOffset);
      expect(Number(view.getBigUint64(8, true))).toBe(50_000_000);
    });

    it('encodes zero fee correctly', () => {
      const zeroIx = createUpdateFeeInstruction(admin, 0);
      const view = new DataView(zeroIx.data.buffer, zeroIx.data.byteOffset);
      expect(Number(view.getBigUint64(8, true))).toBe(0);
    });

    it('accepts bigint fee value', () => {
      const bigIx = createUpdateFeeInstruction(admin, BigInt(100_000_000));
      const view = new DataView(bigIx.data.buffer, bigIx.data.byteOffset);
      expect(Number(view.getBigUint64(8, true))).toBe(100_000_000);
    });
  });

  describe('createWithdrawFeesInstruction', () => {
    const admin = Keypair.generate().publicKey;
    const ix = createWithdrawFeesInstruction(admin, 1_000_000);

    it('has 2 account keys', () => {
      expect(ix.keys).toHaveLength(2);
    });

    it('admin is signer and writable (receives funds)', () => {
      expect(ix.keys[1].pubkey.toBase58()).toBe(admin.toBase58());
      expect(ix.keys[1].isSigner).toBe(true);
      expect(ix.keys[1].isWritable).toBe(true);
    });

    it('configPda is writable', () => {
      const [expectedConfig] = findConfigPda();
      expect(ix.keys[0].pubkey.toBase58()).toBe(expectedConfig.toBase58());
      expect(ix.keys[0].isWritable).toBe(true);
    });

    it('has correct data length: 8 + 8 = 16', () => {
      expect(ix.data.length).toBe(16);
    });

    it('encodes amount as little-endian u64', () => {
      const view = new DataView(ix.data.buffer, ix.data.byteOffset);
      expect(Number(view.getBigUint64(8, true))).toBe(1_000_000);
    });

    it('different discriminator from update_fee', () => {
      const feeIx = createUpdateFeeInstruction(admin, 1000);
      expect(Array.from(ix.data.slice(0, 8))).not.toEqual(Array.from(feeIx.data.slice(0, 8)));
    });
  });

  describe('custom programId', () => {
    const customId = Keypair.generate().publicKey;

    it('commit uses custom programId', () => {
      const ix = createCommitIntentInstruction(user, appId, hash, 300, customId);
      expect(ix.programId.toBase58()).toBe(customId.toBase58());
    });

    it('verify uses custom programId', () => {
      const ix = createVerifyIntentInstruction(user, appId, hash, customId);
      expect(ix.programId.toBase58()).toBe(customId.toBase58());
    });

    it('revoke uses custom programId', () => {
      const ix = createRevokeIntentInstruction(user, appId, customId);
      expect(ix.programId.toBase58()).toBe(customId.toBase58());
    });
  });
});
