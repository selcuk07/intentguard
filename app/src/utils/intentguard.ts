import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js';
import { Buffer } from 'buffer';
import { createHash } from 'crypto';
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

export function computeIntentHash(
  appId: PublicKey,
  user: PublicKey,
  action: string,
  params: Record<string, string>,
): Buffer {
  const sorted = JSON.stringify(params, Object.keys(params).sort());
  const hash = createHash('sha256');
  hash.update(appId.toBuffer());
  hash.update(user.toBuffer());
  hash.update(Buffer.from(action));
  hash.update(Buffer.from(sorted));
  return hash.digest();
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
