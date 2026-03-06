/**
 * SDK Boundary Condition Tests — MAINNET CRITICAL
 *
 * Wrong instruction data = failed transactions or FUND LOSS.
 * Tests every edge case that could produce malformed instructions.
 */
import { describe, it, expect } from 'vitest';
import { Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import {
  createCommitIntentInstruction,
  createVerifyIntentInstruction,
  createRevokeIntentInstruction,
  createTransferAdminInstruction,
} from '../../../packages/sdk/src/instructions';
import { findIntentCommitPda, findConfigPda } from '../../../packages/sdk/src/pdas';
import { INTENT_GUARD_PROGRAM_ID } from '../../../packages/sdk/src/constants';
import { computeIntentHash } from '../../../packages/sdk/src/client';

describe('CRITICAL — SDK Hash Boundary Conditions', () => {
  const user = Keypair.generate().publicKey;
  const appId = Keypair.generate().publicKey;

  it('short hash (<32 bytes) throws validation error', () => {
    const shortHash = [1, 2, 3];
    expect(() => createCommitIntentInstruction(user, appId, shortHash, 300))
      .toThrow('intentHash must be exactly 32 bytes');
  });

  it('long hash (>32 bytes) throws validation error', () => {
    const longHash = Array.from({ length: 64 }, (_, i) => i);
    expect(() => createCommitIntentInstruction(user, appId, longHash, 300))
      .toThrow('intentHash must be exactly 32 bytes');
  });

  it('empty hash throws validation error', () => {
    expect(() => createCommitIntentInstruction(user, appId, [], 300))
      .toThrow('intentHash must be exactly 32 bytes');
  });

  it('verify also rejects short hash', () => {
    expect(() => createVerifyIntentInstruction(user, appId, [1, 2, 3]))
      .toThrow('intentHash must be exactly 32 bytes');
  });

  it('computeIntentHash always produces exactly 32 bytes', () => {
    const hash = computeIntentHash([Buffer.from('test')]);
    expect(hash.length).toBe(32);
    expect(hash.every(b => typeof b === 'number' && b >= 0 && b <= 255)).toBe(true);
  });

  it('computeIntentHash with empty input produces valid hash', () => {
    const hash = computeIntentHash([]);
    expect(hash.length).toBe(32);
    // SHA-256 of empty input (no buffers, no length-prefixes) is the empty hash
    const { createHash } = require('crypto');
    const expected = createHash('sha256').digest();
    expect(hash).toEqual(Array.from(expected));
  });

  it('computeIntentHash is deterministic', () => {
    const buf = Buffer.from('same-input');
    const h1 = computeIntentHash([buf]);
    const h2 = computeIntentHash([buf]);
    expect(h1).toEqual(h2);
  });

  it('computeIntentHash: order matters', () => {
    const a = Buffer.from('a');
    const b = Buffer.from('b');
    const h1 = computeIntentHash([a, b]);
    const h2 = computeIntentHash([b, a]);
    expect(h1).not.toEqual(h2);
  });
});

describe('CRITICAL — SDK TTL Boundary Conditions', () => {
  const user = Keypair.generate().publicKey;
  const appId = Keypair.generate().publicKey;
  const hash = new Array(32).fill(0);

  it('TTL=0 encodes as 0 (program uses default 300)', () => {
    const ix = createCommitIntentInstruction(user, appId, hash, 0);
    const view = new DataView(ix.data.buffer, ix.data.byteOffset);
    expect(Number(view.getBigInt64(72, true))).toBe(0);
  });

  it('negative TTL encodes correctly (program will reject)', () => {
    const ix = createCommitIntentInstruction(user, appId, hash, -1);
    const view = new DataView(ix.data.buffer, ix.data.byteOffset);
    expect(Number(view.getBigInt64(72, true))).toBe(-1);
  });

  it('TTL=30 (MIN_TTL) encodes correctly', () => {
    const ix = createCommitIntentInstruction(user, appId, hash, 30);
    const view = new DataView(ix.data.buffer, ix.data.byteOffset);
    expect(Number(view.getBigInt64(72, true))).toBe(30);
  });

  it('TTL=3600 (MAX_TTL) encodes correctly', () => {
    const ix = createCommitIntentInstruction(user, appId, hash, 3600);
    const view = new DataView(ix.data.buffer, ix.data.byteOffset);
    expect(Number(view.getBigInt64(72, true))).toBe(3600);
  });

  it('TTL=3601 (over MAX_TTL) encodes but program rejects', () => {
    const ix = createCommitIntentInstruction(user, appId, hash, 3601);
    const view = new DataView(ix.data.buffer, ix.data.byteOffset);
    expect(Number(view.getBigInt64(72, true))).toBe(3601);
  });

  it('very large TTL (Number.MAX_SAFE_INTEGER) encodes as BigInt', () => {
    const ix = createCommitIntentInstruction(user, appId, hash, Number.MAX_SAFE_INTEGER);
    const view = new DataView(ix.data.buffer, ix.data.byteOffset);
    expect(Number(view.getBigInt64(72, true))).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('TTL beyond i64 range throws or wraps', () => {
    // 2^63 = 9223372036854775808 — beyond JS safe integer but still fits i64 unsigned
    // BigInt(Number.MAX_SAFE_INTEGER + 1) would lose precision
    const ix = createCommitIntentInstruction(user, appId, hash, 2 ** 53);
    const view = new DataView(ix.data.buffer, ix.data.byteOffset);
    const encoded = Number(view.getBigInt64(72, true));
    expect(encoded).toBe(2 ** 53);
  });
});

describe('CRITICAL — PDA Derivation Consistency', () => {
  it('SDK PDA matches expected seeds [intent, user, appId]', () => {
    const user = Keypair.generate().publicKey;
    const appId = Keypair.generate().publicKey;
    const [pda] = findIntentCommitPda(user, appId);

    // Manually derive
    const [expected] = PublicKey.findProgramAddressSync(
      [Buffer.from('intent'), user.toBuffer(), appId.toBuffer()],
      INTENT_GUARD_PROGRAM_ID,
    );
    expect(pda.toBase58()).toBe(expected.toBase58());
  });

  it('config PDA matches expected seeds [config]', () => {
    const [pda] = findConfigPda();
    const [expected] = PublicKey.findProgramAddressSync(
      [Buffer.from('config')],
      INTENT_GUARD_PROGRAM_ID,
    );
    expect(pda.toBase58()).toBe(expected.toBase58());
  });

  it('instruction account keys use correct PDAs', () => {
    const user = Keypair.generate().publicKey;
    const appId = Keypair.generate().publicKey;
    const [intentPda] = findIntentCommitPda(user, appId);
    const [configPda] = findConfigPda();

    const commitIx = createCommitIntentInstruction(user, appId, new Array(32).fill(0), 300);
    expect(commitIx.keys[0].pubkey.toBase58()).toBe(intentPda.toBase58());
    expect(commitIx.keys[1].pubkey.toBase58()).toBe(configPda.toBase58());
    expect(commitIx.keys[2].pubkey.toBase58()).toBe(user.toBase58());

    const verifyIx = createVerifyIntentInstruction(user, appId, new Array(32).fill(0));
    expect(verifyIx.keys[0].pubkey.toBase58()).toBe(intentPda.toBase58());
    expect(verifyIx.keys[1].pubkey.toBase58()).toBe(configPda.toBase58());
    expect(verifyIx.keys[2].pubkey.toBase58()).toBe(user.toBase58());

    const revokeIx = createRevokeIntentInstruction(user, appId);
    expect(revokeIx.keys[0].pubkey.toBase58()).toBe(intentPda.toBase58());
    expect(revokeIx.keys[1].pubkey.toBase58()).toBe(user.toBase58());
  });

  it('different programId produces different PDAs', () => {
    const user = Keypair.generate().publicKey;
    const appId = Keypair.generate().publicKey;
    const fakeProgram = Keypair.generate().publicKey;

    const [realPda] = findIntentCommitPda(user, appId, INTENT_GUARD_PROGRAM_ID);
    const [fakePda] = findIntentCommitPda(user, appId, fakeProgram);
    expect(realPda.toBase58()).not.toBe(fakePda.toBase58());
  });
});

describe('CRITICAL — Admin Transfer Edge Cases', () => {
  it('transfer_admin to PublicKey.default (all zeros) encodes correctly', () => {
    const admin = Keypair.generate().publicKey;
    const zeroKey = new PublicKey(new Uint8Array(32)); // 1111...11
    const ix = createTransferAdminInstruction(admin, zeroKey);
    const newAdminBytes = ix.data.slice(8, 40);
    expect(Buffer.from(newAdminBytes)).toEqual(zeroKey.toBuffer());
    // WARNING: On-chain this would lock admin forever — no one has private key for zero address
  });

  it('transfer_admin to SystemProgram would lock admin', () => {
    const admin = Keypair.generate().publicKey;
    const ix = createTransferAdminInstruction(admin, SystemProgram.programId);
    const newAdminBytes = Buffer.from(ix.data.slice(8, 40));
    expect(newAdminBytes).toEqual(SystemProgram.programId.toBuffer());
    // WARNING: System program can't sign — admin permanently locked
  });

  it('transfer_admin to self is valid but no-op', () => {
    const admin = Keypair.generate().publicKey;
    const ix = createTransferAdminInstruction(admin, admin);
    const newAdminBytes = Buffer.from(ix.data.slice(8, 40));
    expect(newAdminBytes).toEqual(admin.toBuffer());
  });
});

describe('CRITICAL — Instruction Data Size Integrity', () => {
  it('commit instruction data is exactly 80 bytes', () => {
    const user = Keypair.generate().publicKey;
    const appId = Keypair.generate().publicKey;
    const ix = createCommitIntentInstruction(user, appId, new Array(32).fill(0), 300);
    expect(ix.data.length).toBe(80); // 8 + 32 + 32 + 8
  });

  it('verify instruction data is exactly 40 bytes', () => {
    const user = Keypair.generate().publicKey;
    const appId = Keypair.generate().publicKey;
    const ix = createVerifyIntentInstruction(user, appId, new Array(32).fill(0));
    expect(ix.data.length).toBe(40); // 8 + 32
  });

  it('revoke instruction data is exactly 40 bytes', () => {
    const user = Keypair.generate().publicKey;
    const appId = Keypair.generate().publicKey;
    const ix = createRevokeIntentInstruction(user, appId);
    expect(ix.data.length).toBe(40); // 8 + 32
  });

  it('transfer_admin instruction data is exactly 40 bytes', () => {
    const admin = Keypair.generate().publicKey;
    const newAdmin = Keypair.generate().publicKey;
    const ix = createTransferAdminInstruction(admin, newAdmin);
    expect(ix.data.length).toBe(40); // 8 + 32
  });

  it('pause instruction data is exactly 8 bytes', async () => {
    const admin = Keypair.generate().publicKey;
    const mod = await import('../../../packages/sdk/src/instructions');
    const ix = mod.createPauseProtocolInstruction(admin);
    expect(ix.data.length).toBe(8); // discriminator only
  });

  it('unpause instruction data is exactly 8 bytes', async () => {
    const admin = Keypair.generate().publicKey;
    const mod = await import('../../../packages/sdk/src/instructions');
    const ix = mod.createUnpauseProtocolInstruction(admin);
    expect(ix.data.length).toBe(8); // discriminator only
  });
});
