import { createHash } from 'crypto';
import { PublicKey } from '@solana/web3.js';

/**
 * Compute an intent hash using SHA-256.
 *
 * The hash input is app-defined — pass whatever parameters the target
 * dApp needs to bind. The only requirement is that both the commit side
 * (mobile/CLI) and the verify side (browser/dApp) use the same inputs.
 *
 * @example
 * // For a swap intent:
 * const hash = computeIntentHash([
 *   jupiterProgramId.toBuffer(),
 *   userWallet.toBuffer(),
 *   inputMint.toBuffer(),
 *   outputMint.toBuffer(),
 *   amountIn.toArrayLike(Buffer, 'le', 8),
 *   minAmountOut.toArrayLike(Buffer, 'le', 8),
 * ]);
 */
export function computeIntentHash(buffers: Buffer[]): number[] {
  const hash = createHash('sha256');
  // Length-prefix each buffer to prevent concatenation ambiguity
  const lenBuf = Buffer.alloc(4);
  for (const buf of buffers) {
    lenBuf.writeUInt32LE(buf.length, 0);
    hash.update(lenBuf);
    hash.update(buf);
  }
  return Array.from(hash.digest());
}

/**
 * Check if an IntentCommit PDA exists on-chain.
 * Returns the account info if it exists, null otherwise.
 */
export async function getIntentCommit(
  connection: { getAccountInfo: (key: PublicKey) => Promise<unknown> },
  user: PublicKey,
  appId: PublicKey,
  programId: PublicKey,
): Promise<boolean> {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('intent'), user.toBuffer(), appId.toBuffer()],
    programId,
  );
  const info = await connection.getAccountInfo(pda);
  return info !== null;
}
