import {
  PublicKey,
  TransactionInstruction,
  SystemProgram,
} from '@solana/web3.js';
import { INTENT_GUARD_PROGRAM_ID } from './constants';
import { findIntentCommitPda, findConfigPda } from './pdas';

function validateHash(intentHash: number[] | Uint8Array): void {
  if (intentHash.length !== 32) {
    throw new Error(
      `intentHash must be exactly 32 bytes, got ${intentHash.length}. ` +
      `Use computeIntentHash() to produce a valid SHA-256 hash.`
    );
  }
}

// Anchor discriminators (SHA-256 of "global:<instruction_name>" first 8 bytes)
const DISCRIMINATOR_COMMIT = Buffer.from([175, 152, 13, 10, 40, 234, 201, 8]);
const DISCRIMINATOR_VERIFY = Buffer.from([240, 198, 213, 223, 94, 7, 247, 247]);
const DISCRIMINATOR_REVOKE = Buffer.from([42, 248, 79, 132, 107, 96, 193, 153]);
const DISCRIMINATOR_PAUSE = Buffer.from([144, 95, 0, 107, 119, 39, 248, 141]);
const DISCRIMINATOR_UNPAUSE = Buffer.from([183, 154, 5, 183, 105, 76, 87, 18]);
const DISCRIMINATOR_TRANSFER_ADMIN = Buffer.from([42, 242, 66, 106, 228, 10, 111, 156]);
// New fee-related discriminators (SHA-256 of "global:<name>" first 8 bytes)
// These will be filled after anchor build generates the IDL
const DISCRIMINATOR_UPDATE_FEE = Buffer.from([232, 253, 195, 247, 148, 212, 73, 222]);
const DISCRIMINATOR_WITHDRAW_FEES = Buffer.from([198, 212, 171, 109, 144, 215, 174, 89]);

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
  validateHash(intentHash);
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
  validateHash(intentHash);
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
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
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

/**
 * Build a pause_protocol instruction (admin only).
 *
 * @param admin - The admin wallet (signer)
 * @param programId - IntentGuard program ID (default: devnet)
 */
export function createPauseProtocolInstruction(
  admin: PublicKey,
  programId: PublicKey = INTENT_GUARD_PROGRAM_ID,
): TransactionInstruction {
  const [configPda] = findConfigPda(programId);
  const data = Buffer.from(DISCRIMINATOR_PAUSE);

  return new TransactionInstruction({
    keys: [
      { pubkey: configPda, isSigner: false, isWritable: true },
      { pubkey: admin, isSigner: true, isWritable: true },
    ],
    programId,
    data,
  });
}

/**
 * Build an unpause_protocol instruction (admin only).
 *
 * @param admin - The admin wallet (signer)
 * @param programId - IntentGuard program ID (default: devnet)
 */
export function createUnpauseProtocolInstruction(
  admin: PublicKey,
  programId: PublicKey = INTENT_GUARD_PROGRAM_ID,
): TransactionInstruction {
  const [configPda] = findConfigPda(programId);
  const data = Buffer.from(DISCRIMINATOR_UNPAUSE);

  return new TransactionInstruction({
    keys: [
      { pubkey: configPda, isSigner: false, isWritable: true },
      { pubkey: admin, isSigner: true, isWritable: true },
    ],
    programId,
    data,
  });
}

/**
 * Build a transfer_admin instruction (admin only).
 *
 * @param admin - The current admin wallet (signer)
 * @param newAdmin - The new admin public key
 * @param programId - IntentGuard program ID (default: devnet)
 */
export function createTransferAdminInstruction(
  admin: PublicKey,
  newAdmin: PublicKey,
  programId: PublicKey = INTENT_GUARD_PROGRAM_ID,
): TransactionInstruction {
  const [configPda] = findConfigPda(programId);

  // Serialize: discriminator(8) + new_admin(32)
  const data = Buffer.alloc(8 + 32);
  DISCRIMINATOR_TRANSFER_ADMIN.copy(data, 0);
  newAdmin.toBuffer().copy(data, 8);

  return new TransactionInstruction({
    keys: [
      { pubkey: configPda, isSigner: false, isWritable: true },
      { pubkey: admin, isSigner: true, isWritable: true },
    ],
    programId,
    data,
  });
}

/**
 * Build an update_fee instruction (admin only).
 *
 * Sets the protocol fee charged per verify_intent call.
 * Fee is in lamports. Set to 0 for free usage.
 * Maximum: 0.1 SOL (100_000_000 lamports).
 *
 * @param admin - The admin wallet (signer)
 * @param newFee - New fee in lamports (0 = free, max 100_000_000)
 * @param programId - IntentGuard program ID (default: devnet)
 */
export function createUpdateFeeInstruction(
  admin: PublicKey,
  newFee: bigint | number,
  programId: PublicKey = INTENT_GUARD_PROGRAM_ID,
): TransactionInstruction {
  const [configPda] = findConfigPda(programId);

  // Serialize: discriminator(8) + new_fee(8)
  const data = Buffer.alloc(8 + 8);
  DISCRIMINATOR_UPDATE_FEE.copy(data, 0);
  data.writeBigUInt64LE(BigInt(newFee), 8);

  return new TransactionInstruction({
    keys: [
      { pubkey: configPda, isSigner: false, isWritable: true },
      { pubkey: admin, isSigner: true, isWritable: true },
    ],
    programId,
    data,
  });
}

/**
 * Build a withdraw_fees instruction (admin only).
 *
 * Withdraws accumulated protocol fees from the config PDA to the admin wallet.
 * Can only withdraw excess lamports above the PDA's rent-exempt minimum.
 *
 * @param admin - The admin wallet (signer, receives funds)
 * @param amount - Amount in lamports to withdraw
 * @param programId - IntentGuard program ID (default: devnet)
 */
export function createWithdrawFeesInstruction(
  admin: PublicKey,
  amount: bigint | number,
  programId: PublicKey = INTENT_GUARD_PROGRAM_ID,
): TransactionInstruction {
  const [configPda] = findConfigPda(programId);

  // Serialize: discriminator(8) + amount(8)
  const data = Buffer.alloc(8 + 8);
  DISCRIMINATOR_WITHDRAW_FEES.copy(data, 0);
  data.writeBigUInt64LE(BigInt(amount), 8);

  return new TransactionInstruction({
    keys: [
      { pubkey: configPda, isSigner: false, isWritable: true },
      { pubkey: admin, isSigner: true, isWritable: true },
    ],
    programId,
    data,
  });
}
