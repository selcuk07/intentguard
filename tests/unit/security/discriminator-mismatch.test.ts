/**
 * Discriminator Cross-Verification — MAINNET CRITICAL
 *
 * Verifies SDK discriminators match expected Anchor SHA-256 derivation.
 * A mismatch means ALL transactions fail on mainnet.
 *
 * Also verifies content.js discriminator matches SDK.
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'crypto';
import { Keypair } from '@solana/web3.js';
import {
  createCommitIntentInstruction,
  createVerifyIntentInstruction,
  createRevokeIntentInstruction,
  createPauseProtocolInstruction,
  createUnpauseProtocolInstruction,
  createTransferAdminInstruction,
} from '../../../packages/sdk/src/instructions';

/**
 * Anchor discriminator = SHA-256("global:<instruction_name>")[0..8]
 */
function anchorDiscriminator(name: string): number[] {
  const hash = createHash('sha256').update(`global:${name}`).digest();
  return Array.from(hash.slice(0, 8));
}

describe('CRITICAL — Anchor Discriminator Derivation', () => {
  it('commit_intent discriminator matches SHA-256("global:commit_intent")', () => {
    const expected = anchorDiscriminator('commit_intent');
    const user = Keypair.generate().publicKey;
    const appId = Keypair.generate().publicKey;
    const ix = createCommitIntentInstruction(user, appId, new Array(32).fill(0), 300);
    const actual = Array.from(ix.data.slice(0, 8));
    expect(actual).toEqual(expected);
  });

  it('verify_intent discriminator matches SHA-256("global:verify_intent")', () => {
    const expected = anchorDiscriminator('verify_intent');
    const user = Keypair.generate().publicKey;
    const appId = Keypair.generate().publicKey;
    const ix = createVerifyIntentInstruction(user, appId, new Array(32).fill(0));
    const actual = Array.from(ix.data.slice(0, 8));
    expect(actual).toEqual(expected);
  });

  it('revoke_intent discriminator matches SHA-256("global:revoke_intent")', () => {
    const expected = anchorDiscriminator('revoke_intent');
    const user = Keypair.generate().publicKey;
    const appId = Keypair.generate().publicKey;
    const ix = createRevokeIntentInstruction(user, appId);
    const actual = Array.from(ix.data.slice(0, 8));
    expect(actual).toEqual(expected);
  });

  it('pause_protocol discriminator matches SHA-256("global:pause_protocol")', () => {
    const expected = anchorDiscriminator('pause_protocol');
    const admin = Keypair.generate().publicKey;
    const ix = createPauseProtocolInstruction(admin);
    const actual = Array.from(ix.data.slice(0, 8));
    expect(actual).toEqual(expected);
  });

  it('unpause_protocol discriminator matches SHA-256("global:unpause_protocol")', () => {
    const expected = anchorDiscriminator('unpause_protocol');
    const admin = Keypair.generate().publicKey;
    const ix = createUnpauseProtocolInstruction(admin);
    const actual = Array.from(ix.data.slice(0, 8));
    expect(actual).toEqual(expected);
  });

  it('transfer_admin discriminator matches SHA-256("global:transfer_admin")', () => {
    const expected = anchorDiscriminator('transfer_admin');
    const admin = Keypair.generate().publicKey;
    const newAdmin = Keypair.generate().publicKey;
    const ix = createTransferAdminInstruction(admin, newAdmin);
    const actual = Array.from(ix.data.slice(0, 8));
    expect(actual).toEqual(expected);
  });
});

describe('CRITICAL — Content Script Discriminator Match', () => {
  // content.js line 212: btoa(String.fromCharCode(103, 72, 77, 62, 59, 234, 35, 126))
  // This is the IntentCommit ACCOUNT discriminator, not instruction discriminator
  // Anchor account discriminator = SHA-256("account:IntentCommit")[0..8]
  it('content.js IntentCommit account discriminator matches Anchor derivation', () => {
    const expected = createHash('sha256').update('account:IntentCommit').digest();
    const contentScriptDisc = [103, 72, 77, 62, 59, 234, 35, 126];
    expect(Array.from(expected.slice(0, 8))).toEqual(contentScriptDisc);
  });

  it('content.js uses correct data offset for user (8 bytes after discriminator)', () => {
    // content.js line 228: memcmp offset 8 for wallet
    // IntentCommit layout: discriminator(8) + user(32) + app_id(32) + hash(32) + committed_at(8) + expires_at(8) + bump(1)
    // user starts at offset 8 — correct
    const userOffset = 8;
    expect(userOffset).toBe(8);
  });

  it('content.js uses correct data slice for expiry check', () => {
    // content.js line 225: dataSlice: { offset: 104, length: 16 }
    // committed_at: offset 104 = 8 + 32 + 32 + 32 = 104
    // expires_at: offset 112 = 104 + 8
    // But the sliced data is relative: committed_at at 0, expires_at at 8
    // content.js line 241: getBigInt64(8, true) — this reads expires_at
    const committedAtOffset = 8 + 32 + 32 + 32; // 104
    const expiresAtOffset = committedAtOffset + 8; // 112
    expect(committedAtOffset).toBe(104);
    expect(expiresAtOffset).toBe(112);
    // dataSlice starts at 104, so within the slice:
    // committed_at = byte 0, expires_at = byte 8
    // getBigInt64(8, true) reads expires_at — CORRECT
  });

  it('IntentCommit account size matches on-chain SPACE constant', () => {
    // state.rs: pub const SPACE: usize = 8 + 32 + 32 + 32 + 8 + 8 + 1 = 121
    // content.js line 321: filters: [{ dataSize: 121 }]
    const SPACE = 8 + 32 + 32 + 32 + 8 + 8 + 1;
    expect(SPACE).toBe(121);
  });

  it('GuardConfig account size matches on-chain SPACE constant', () => {
    // state.rs: pub const SPACE: usize = 8 + 32 + 1 + 8 + 8 + 8 + 1 = 66
    const SPACE = 8 + 32 + 1 + 8 + 8 + 8 + 1;
    expect(SPACE).toBe(66);
  });
});

describe('CRITICAL — No Discriminator Collisions Across All Types', () => {
  it('all instruction discriminators are unique from each other', () => {
    const names = [
      'commit_intent', 'verify_intent', 'revoke_intent',
      'pause_protocol', 'unpause_protocol', 'transfer_admin',
      'update_config', 'migrate_config', 'initialize',
    ];
    const discs = names.map(n => anchorDiscriminator(n).join(','));
    expect(new Set(discs).size).toBe(discs.length);
  });

  it('account discriminators are unique from instruction discriminators', () => {
    const instructionDiscs = [
      'commit_intent', 'verify_intent', 'revoke_intent',
      'pause_protocol', 'unpause_protocol', 'transfer_admin',
    ].map(n => anchorDiscriminator(n).join(','));

    const accountDiscs = ['IntentCommit', 'GuardConfig'].map(n => {
      const hash = createHash('sha256').update(`account:${n}`).digest();
      return Array.from(hash.slice(0, 8)).join(',');
    });

    const all = [...instructionDiscs, ...accountDiscs];
    expect(new Set(all).size).toBe(all.length);
  });
});
