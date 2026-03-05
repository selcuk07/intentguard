/**
 * Example: IntentGuard-protected SOL transfer
 *
 * This demonstrates the full 2FA flow:
 *   1. User commits intent from CLI/mobile (TX1)
 *   2. dApp verifies intent + executes transfer (TX2)
 *
 * Usage:
 *   # Step 1: Commit from CLI (trusted device)
 *   intentguard commit \
 *     --app 11111111111111111111111111111111 \
 *     --action transfer \
 *     --params '{"to":"<RECIPIENT>","lamports":"1000000000"}' \
 *     --cluster devnet
 *
 *   # Step 2: Run this script (simulates browser/dApp)
 *   npx ts-node examples/protected-transfer.ts \
 *     --to <RECIPIENT> \
 *     --amount 1
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// IntentGuard program ID
const INTENT_GUARD_ID = new PublicKey('4etWfDJNHhjYdv7fuGe236GDPguwUXVk9WhbEpQsPix7');

// System program is the "app" for native SOL transfers
const APP_ID = SystemProgram.programId;

function loadKeypair(): Keypair {
  const kpPath = process.env.KEYPAIR || path.join(os.homedir(), '.config', 'solana', 'id.json');
  const raw = JSON.parse(fs.readFileSync(kpPath, 'utf-8'));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function computeIntentHash(appId: PublicKey, user: PublicKey, action: string, params: Record<string, string>): Buffer {
  const sorted = JSON.stringify(params, Object.keys(params).sort());
  const hash = createHash('sha256');
  hash.update(appId.toBuffer());
  hash.update(user.toBuffer());
  hash.update(Buffer.from(action));
  hash.update(Buffer.from(sorted));
  return hash.digest();
}

function findIntentPda(user: PublicKey, appId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('intent'), user.toBuffer(), appId.toBuffer()],
    INTENT_GUARD_ID,
  );
}

function findConfigPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from('config')], INTENT_GUARD_ID);
}

async function main() {
  // Parse args
  const args = process.argv.slice(2);
  const toIdx = args.indexOf('--to');
  const amountIdx = args.indexOf('--amount');

  if (toIdx === -1 || amountIdx === -1) {
    console.error('Usage: npx ts-node examples/protected-transfer.ts --to <PUBKEY> --amount <SOL>');
    process.exit(1);
  }

  const recipient = new PublicKey(args[toIdx + 1]);
  const amountSol = parseFloat(args[amountIdx + 1]);
  const lamports = Math.round(amountSol * LAMPORTS_PER_SOL);

  const cluster = process.env.CLUSTER || 'devnet';
  const rpcUrl = cluster === 'localnet' ? 'http://localhost:8899' : `https://api.${cluster}.solana.com`;

  const connection = new Connection(rpcUrl, 'confirmed');
  const user = loadKeypair();
  const wallet = new anchor.Wallet(user);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: 'confirmed' });

  // Load IntentGuard program
  const idl = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'target', 'idl', 'intent_guard.json'), 'utf-8'),
  );
  const program = new anchor.Program(idl, provider);

  console.log(`\n  IntentGuard Protected Transfer`);
  console.log(`  ${'─'.repeat(45)}`);
  console.log(`  From:    ${user.publicKey.toBase58()}`);
  console.log(`  To:      ${recipient.toBase58()}`);
  console.log(`  Amount:  ${amountSol} SOL (${lamports} lamports)`);
  console.log();

  // Step 1: Check if intent commit exists on-chain
  const [intentPda] = findIntentPda(user.publicKey, APP_ID);
  const intentAccount = await connection.getAccountInfo(intentPda);

  if (!intentAccount) {
    console.log('  No IntentCommit found on-chain.');
    console.log('  Commit your intent first from a trusted device:\n');
    console.log(`  intentguard commit \\`);
    console.log(`    --app ${APP_ID.toBase58()} \\`);
    console.log(`    --action transfer \\`);
    console.log(`    --params '{"lamports":"${lamports}","to":"${recipient.toBase58()}"}' \\`);
    console.log(`    --cluster ${cluster}\n`);
    process.exit(1);
  }

  console.log('  IntentCommit found on-chain. Verifying...');

  // Step 2: Compute expected hash (must match what CLI committed)
  const intentHash = computeIntentHash(APP_ID, user.publicKey, 'transfer', {
    lamports: lamports.toString(),
    to: recipient.toBase58(),
  });

  // Step 3: Build transaction with verify_intent + transfer
  const [configPda] = findConfigPda();

  const verifyIx = await program.methods
    .verifyIntent(Array.from(intentHash))
    .accounts({
      intentCommit: intentPda,
      config: configPda,
      user: user.publicKey,
    })
    .instruction();

  const transferIx = SystemProgram.transfer({
    fromPubkey: user.publicKey,
    toPubkey: recipient,
    lamports,
  });

  // Atomic: verify intent + transfer in same TX
  const tx = new Transaction().add(verifyIx).add(transferIx);

  console.log('  Sending atomic TX: verify_intent + transfer...');

  const sig = await sendAndConfirmTransaction(connection, tx, [user]);

  console.log(`\n  Transfer complete!`);
  console.log(`  TX: ${sig}`);
  console.log(`  IntentGuard verified your intent before executing.\n`);
}

main().catch((err) => {
  console.error(`\n  Error: ${err.message}\n`);
  process.exit(1);
});
