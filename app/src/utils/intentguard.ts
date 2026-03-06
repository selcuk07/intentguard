import { PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import { Buffer } from 'buffer';
import { INTENT_GUARD_PROGRAM_ID } from './constants';

export function findConfigPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('config')],
    INTENT_GUARD_PROGRAM_ID,
  );
}

export function findIntentPda(user: PublicKey, appId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('intent'), user.toBuffer(), appId.toBuffer()],
    INTENT_GUARD_PROGRAM_ID,
  );
}

export async function computeIntentHash(
  appId: PublicKey,
  user: PublicKey,
  action: string,
  params: Record<string, string>,
): Promise<Buffer> {
  const sorted = JSON.stringify(params, Object.keys(params).sort());
  const data = Buffer.concat([
    appId.toBuffer(),
    user.toBuffer(),
    Buffer.from(action),
    Buffer.from(sorted),
  ]);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Buffer.from(hashBuffer);
}

/**
 * Build the commit_intent instruction manually (no Anchor dependency).
 * This keeps the mobile app lightweight.
 */
export function buildCommitInstruction(
  user: PublicKey,
  appId: PublicKey,
  intentHash: Buffer,
  ttl: number,
): TransactionInstruction {
  const [intentPda] = findIntentPda(user, appId);
  const [configPda] = findConfigPda();

  // Anchor discriminator for commit_intent
  const discriminator = Buffer.from([175, 152, 13, 10, 40, 234, 201, 8]);

  // Serialize args: app_id (32) + intent_hash (32) + ttl (i64 LE)
  const ttlBuf = Buffer.alloc(8);
  ttlBuf.writeBigInt64LE(BigInt(ttl));

  const data = Buffer.concat([
    discriminator,
    appId.toBuffer(),
    intentHash,
    ttlBuf,
  ]);

  return new TransactionInstruction({
    programId: INTENT_GUARD_PROGRAM_ID,
    keys: [
      { pubkey: intentPda, isSigner: false, isWritable: true },
      { pubkey: configPda, isSigner: false, isWritable: true },
      { pubkey: user, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

/**
 * Build a revoke_intent instruction to close an existing PDA.
 */
export function buildRevokeInstruction(
  user: PublicKey,
  appId: PublicKey,
): TransactionInstruction {
  const [intentPda] = findIntentPda(user, appId);

  // Anchor discriminator for revoke_intent
  const discriminator = Buffer.from([42, 248, 79, 132, 107, 96, 193, 153]);

  const data = Buffer.concat([discriminator, appId.toBuffer()]);

  return new TransactionInstruction({
    programId: INTENT_GUARD_PROGRAM_ID,
    keys: [
      { pubkey: intentPda, isSigner: false, isWritable: true },
      { pubkey: user, isSigner: true, isWritable: true },
    ],
    data,
  });
}

export interface QrIntentPayload {
  protocol: 'intentguard';
  version: number;
  app: string;
  action: string;
  params: Record<string, string>;
  display?: {
    title: string;
    description: string;
  };
}

export function parseQrPayload(data: string): QrIntentPayload | null {
  try {
    const parsed = JSON.parse(data);
    if (parsed.protocol !== 'intentguard') return null;
    if (!parsed.app || !parsed.action || !parsed.params) return null;
    return parsed as QrIntentPayload;
  } catch {
    return null;
  }
}
