import { PublicKey } from '@solana/web3.js';
import { INTENT_GUARD_PROGRAM_ID } from './constants';

export function findConfigPda(
  programId: PublicKey = INTENT_GUARD_PROGRAM_ID,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('config')],
    programId,
  );
}

export function findIntentCommitPda(
  user: PublicKey,
  appId: PublicKey,
  programId: PublicKey = INTENT_GUARD_PROGRAM_ID,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('intent'), user.toBuffer(), appId.toBuffer()],
    programId,
  );
}
