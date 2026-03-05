/**
 * IntentGuard Devnet Demo — Live proof of commit → verify → close flow.
 *
 * Uses the deployer wallet to run on devnet. Outputs explorer links.
 * Run: npx ts-node scripts/devnet-demo.ts
 */

import {
  Connection,
  Keypair,
  Transaction,
  sendAndConfirmTransaction,
  PublicKey,
  SystemProgram,
} from '@solana/web3.js';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// ─── Constants ────────────────────────────────────────────────
const PROGRAM_ID = new PublicKey('4etWfDJNHhjYdv7fuGe236GDPguwUXVk9WhbEpQsPix7');
const RPC_URL = 'https://api.devnet.solana.com';
const EXPLORER = 'https://explorer.solana.com';

// Anchor discriminators
const DISC_COMMIT = Buffer.from([175, 152, 13, 10, 40, 234, 201, 8]);
const DISC_VERIFY = Buffer.from([240, 198, 213, 223, 94, 7, 247, 247]);

// ─── PDA helpers ──────────────────────────────────────────────
function findIntentPda(user: PublicKey, appId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('intent'), user.toBuffer(), appId.toBuffer()],
    PROGRAM_ID,
  );
}

function findConfigPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('config')],
    PROGRAM_ID,
  );
}

// ─── Hash helper ──────────────────────────────────────────────
function computeHash(buffers: Buffer[]): number[] {
  const h = createHash('sha256');
  for (const b of buffers) h.update(b);
  return Array.from(h.digest());
}

// ─── Load deployer keypair ────────────────────────────────────
function loadKeypair(): Keypair {
  const keyPath = path.join(os.homedir(), '.config', 'solana', 'id.json');
  const raw = JSON.parse(fs.readFileSync(keyPath, 'utf-8'));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

async function main() {
  const connection = new Connection(RPC_URL, 'confirmed');
  const deployer = loadKeypair();

  // Create a temp user for the demo
  const user = Keypair.generate();
  console.log('Demo user:', user.publicKey.toBase58());

  // Fund the user
  console.log('Funding user from deployer...');
  const fundTx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: deployer.publicKey,
      toPubkey: user.publicKey,
      lamports: 50_000_000, // 0.05 SOL
    }),
  );
  await sendAndConfirmTransaction(connection, fundTx, [deployer]);
  console.log('Funded 0.05 SOL');

  // ─── Intent Parameters ────────────────────────────────────
  const targetApp = new PublicKey('JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4');
  const amountBuf = Buffer.alloc(8);
  amountBuf.writeBigUInt64LE(BigInt(1_000_000_000));

  const hash = computeHash([
    targetApp.toBuffer(),
    user.publicKey.toBuffer(),
    Buffer.from('swap'),
    amountBuf,
  ]);

  console.log('\nIntent hash:', Buffer.from(hash).toString('hex').slice(0, 32) + '...');

  // ─── Step 1: COMMIT ───────────────────────────────────────
  console.log('\n=== STEP 1: Commit Intent (trusted device) ===');

  const [intentPda] = findIntentPda(user.publicKey, targetApp);
  const [configPda] = findConfigPda();

  const commitData = Buffer.alloc(8 + 32 + 32 + 8);
  DISC_COMMIT.copy(commitData, 0);
  targetApp.toBuffer().copy(commitData, 8);
  Buffer.from(hash).copy(commitData, 40);
  commitData.writeBigInt64LE(BigInt(300), 72); // 5 min TTL

  const commitIx = {
    keys: [
      { pubkey: intentPda, isSigner: false, isWritable: true },
      { pubkey: configPda, isSigner: false, isWritable: true },
      { pubkey: user.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data: commitData,
  };

  const commitTx = new Transaction().add(commitIx);
  const commitSig = await sendAndConfirmTransaction(connection, commitTx, [user]);
  console.log('TX:', `${EXPLORER}/tx/${commitSig}?cluster=devnet`);

  // Check PDA exists
  const pdaInfo = await connection.getAccountInfo(intentPda);
  console.log('IntentCommit PDA created:', pdaInfo !== null);
  console.log('PDA:', `${EXPLORER}/account/${intentPda.toBase58()}?cluster=devnet`);

  // ─── Step 2: VERIFY ───────────────────────────────────────
  console.log('\n=== STEP 2: Verify Intent (browser/dApp) ===');

  const verifyData = Buffer.alloc(8 + 32);
  DISC_VERIFY.copy(verifyData, 0);
  Buffer.from(hash).copy(verifyData, 8);

  const verifyIx = {
    keys: [
      { pubkey: intentPda, isSigner: false, isWritable: true },
      { pubkey: configPda, isSigner: false, isWritable: true },
      { pubkey: user.publicKey, isSigner: true, isWritable: true },
    ],
    programId: PROGRAM_ID,
    data: verifyData,
  };

  const verifyTx = new Transaction().add(verifyIx);
  const verifySig = await sendAndConfirmTransaction(connection, verifyTx, [user]);
  console.log('TX:', `${EXPLORER}/tx/${verifySig}?cluster=devnet`);

  // Confirm PDA closed
  const afterInfo = await connection.getAccountInfo(intentPda);
  console.log('PDA closed (rent refunded):', afterInfo === null);

  // ─── Summary ──────────────────────────────────────────────
  console.log('\n╔══════════════════════════════════════════════╗');
  console.log('║     IntentGuard Devnet Demo — SUCCESS        ║');
  console.log('╠══════════════════════════════════════════════╣');
  console.log(`║ Program:  ${PROGRAM_ID.toBase58().slice(0, 20)}...`);
  console.log(`║ User:     ${user.publicKey.toBase58().slice(0, 20)}...`);
  console.log(`║ Commit:   ${commitSig.slice(0, 30)}...`);
  console.log(`║ Verify:   ${verifySig.slice(0, 30)}...`);
  console.log('║ PDA:      created → verified → closed ✓      ║');
  console.log('╚══════════════════════════════════════════════╝');
}

main().catch(console.error);
