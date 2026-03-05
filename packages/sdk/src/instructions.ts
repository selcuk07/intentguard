import {
  PublicKey,
  TransactionInstruction,
  SystemProgram,
  SYSVAR_CLOCK_PUBKEY,
} from '@solana/web3.js';
import { INTENT_GUARD_PROGRAM_ID } from './constants';
import { findIntentCommitPda, findConfigPda } from './pdas';

// Anchor discriminators (SHA-256 of "global:<instruction_name>" first 8 bytes)
const DISCRIMINATOR_COMMIT = Buffer.from([175, 152, 13, 10, 40, 234, 201, 8]);
const DISCRIMINATOR_VERIFY = Buffer.from([240, 198, 213, 223, 94, 7, 247, 247]);
const DISCRIMINATOR_REVOKE = Buffer.from([42, 248, 79, 132, 107, 96, 193, 153]);

/**
 * Build a commit_intent instruction without Anchor dependency.
 *
 * @param user - The wallet committing the intent (signer)
 * @param appId - Target app/program public key
 * @param intentHash - 32-byte SHA-256 hash of intent parameters
 * @param ttl - Time to live in seconds (30–3600)
 * @param programId - IntentGuard program ID (default: devnet)
 */
export function createCommitIntentInstruction(
  user: PublicKey,
  appId: PublicKey,
  intentHash: number[] | Uint8Array,
  ttl: number,
  programId: PublicKey = INTENT_GUARD_PROGRAM_ID,
): TransactionInstruction {
  const [intentPda] = findIntentCommitPda(user, appId, programId);
  const [configPda] = findConfigPda(programId);

  // Serialize: discriminator(8) + app_id(32) + intent_hash(32) + ttl(8)
  const data = Buffer.alloc(8 + 32 + 32 + 8);
  DISCRIMINATOR_COMMIT.copy(data, 0);
  appId.toBuffer().copy(data, 8);
  Buffer.from(intentHash).copy(data, 40);
  data.writeBigInt64LE(BigInt(ttl), 72);

  return new TransactionInstruction({
    keys: [
      { pubkey: intentPda, isSigner: false, isWritable: true },
      { pubkey: configPda, isSigner: false, isWritable: true },
      { pubkey: user, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId,
    data,
  });
}

/**
 * Build a verify_intent instruction without Anchor dependency.
 *
 * @param user - The wallet that committed the intent (signer)
 * @param appId - Target app/program public key (must match commit)
 * @param intentHash - 32-byte hash to verify against
 * @param programId - IntentGuard program ID (default: devnet)
 */
export function createVerifyIntentInstruction(
  user: PublicKey,
  appId: PublicKey,
  intentHash: number[] | Uint8Array,
  programId: PublicKey = INTENT_GUARD_PROGRAM_ID,
): TransactionInstruction {
  const [intentPda] = findIntentCommitPda(user, appId, programId);
  const [configPda] = findConfigPda(programId);

  // Serialize: discriminator(8) + intent_hash(32)
  const data = Buffer.alloc(8 + 32);
  DISCRIMINATOR_VERIFY.copy(data, 0);
  Buffer.from(intentHash).copy(data, 8);

  return new TransactionInstruction({
    keys: [
      { pubkey: intentPda, isSigner: false, isWritable: true },
      { pubkey: configPda, isSigner: false, isWritable: true },
      { pubkey: user, isSigner: true, isWritable: true },
    ],
    programId,
    data,
  });
}

/**
 * Build a revoke_intent instruction without Anchor dependency.
 *
 * @param user - The wallet that committed the intent (signer)
 * @param appId - Target app/program public key
 * @param programId - IntentGuard program ID (default: devnet)
 */
export function createRevokeIntentInstruction(
  user: PublicKey,
  appId: PublicKey,
  programId: PublicKey = INTENT_GUARD_PROGRAM_ID,
): TransactionInstruction {
  const [intentPda] = findIntentCommitPda(user, appId, programId);

  // Serialize: discriminator(8) + app_id(32)
  const data = Buffer.alloc(8 + 32);
  DISCRIMINATOR_REVOKE.copy(data, 0);
  appId.toBuffer().copy(data, 8);

  return new TransactionInstruction({
    keys: [
      { pubkey: intentPda, isSigner: false, isWritable: true },
      { pubkey: user, isSigner: true, isWritable: true },
    ],
    programId,
    data,
  });
}
