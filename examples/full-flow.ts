/**
 * Full IntentGuard flow example — demonstrates both sides:
 *
 *   1. TRUSTED DEVICE: Commit intent hash
 *   2. BROWSER: Verify intent + execute action
 *
 * In production, step 1 happens on mobile and step 2 in the browser.
 * This script simulates both for demonstration.
 */

import {
  Connection,
  Keypair,
  Transaction,
  sendAndConfirmTransaction,
  PublicKey,
} from '@solana/web3.js';
import {
  computeIntentHash,
  createCommitIntentInstruction,
  createVerifyIntentInstruction,
  findIntentCommitPda,
  getIntentCommit,
  INTENT_GUARD_PROGRAM_ID,
} from 'intentguard-sdk';

const RPC_URL = 'https://api.devnet.solana.com';

async function main() {
  const connection = new Connection(RPC_URL, 'confirmed');

  // In production: mobile keypair ≠ browser keypair (that's the point!)
  // For demo: we use the same keypair to simulate both devices
  const user = Keypair.generate();

  // Airdrop some SOL for fees
  console.log('Airdropping SOL to', user.publicKey.toBase58());
  const sig = await connection.requestAirdrop(user.publicKey, 1e9);
  await connection.confirmTransaction(sig);

  // ─── Define Intent Parameters ───────────────────────────────
  const targetApp = new PublicKey('JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4'); // Jupiter
  const action = 'swap';
  const inputMint = new PublicKey('So11111111111111111111111111111111111111112');  // SOL
  const outputMint = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'); // USDC
  const amount = BigInt(1_000_000_000); // 1 SOL

  // ─── Step 1: COMMIT (trusted device) ────────────────────────
  console.log('\n--- Step 1: Commit intent from trusted device ---');

  const hash = computeIntentHash([
    targetApp.toBuffer(),
    user.publicKey.toBuffer(),
    inputMint.toBuffer(),
    outputMint.toBuffer(),
    Buffer.from(new BigUint64Array([amount]).buffer),
  ]);

  console.log('Intent hash:', Buffer.from(hash).toString('hex').slice(0, 16) + '...');

  const commitIx = createCommitIntentInstruction(
    user.publicKey,
    targetApp,
    hash,
    300, // 5 minute TTL
  );

  const commitTx = new Transaction().add(commitIx);
  const commitSig = await sendAndConfirmTransaction(connection, commitTx, [user]);
  console.log('Commit TX:', commitSig);

  // ─── Step 2: CHECK (browser polls for commit) ───────────────
  console.log('\n--- Step 2: Browser detects commit on-chain ---');

  const exists = await getIntentCommit(
    connection,
    user.publicKey,
    targetApp,
    INTENT_GUARD_PROGRAM_ID,
  );
  console.log('IntentCommit PDA exists:', exists);

  const [pda] = findIntentCommitPda(user.publicKey, targetApp);
  console.log('PDA address:', pda.toBase58());

  // ─── Step 3: VERIFY + EXECUTE (browser) ─────────────────────
  console.log('\n--- Step 3: Verify intent + execute action ---');

  const verifyIx = createVerifyIntentInstruction(
    user.publicKey,
    targetApp,
    hash,
  );

  // In production: add your swap/transfer instruction here too
  // const tx = new Transaction().add(verifyIx).add(swapIx);
  const verifyTx = new Transaction().add(verifyIx);
  const verifySig = await sendAndConfirmTransaction(connection, verifyTx, [user]);
  console.log('Verify TX:', verifySig);

  // ─── Confirm PDA is closed ──────────────────────────────────
  const afterVerify = await getIntentCommit(
    connection,
    user.publicKey,
    targetApp,
    INTENT_GUARD_PROGRAM_ID,
  );
  console.log('\nPDA exists after verify:', afterVerify, '(should be false — closed)');

  console.log('\n✓ Full flow complete! Intent committed, verified, and PDA closed.');
}

main().catch(console.error);
