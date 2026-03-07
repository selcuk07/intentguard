/**
 * IntentGuard — Fee Administration Script
 *
 * Manage protocol fees: set fee, check revenue, withdraw earnings.
 *
 * Usage:
 *   npx tsx scripts/fee-admin.ts <command> [args]
 *
 * Commands:
 *   status                     Show current fee config and revenue stats
 *   set-fee <lamports>         Set verify fee (0 = free, max 100_000_000)
 *   withdraw <lamports>        Withdraw accumulated fees to admin wallet
 *   withdraw-all               Withdraw all available fees
 *   simulate <daily-verifies>  Project monthly/yearly revenue at current fee
 *   history                    Show fee collection stats
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ─── Config ───────────────────────────────────────────────────

const PROGRAM_ID = new PublicKey('4etWfDJNHhjYdv7fuGe236GDPguwUXVk9WhbEpQsPix7');
const RPC_URL = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
const MAX_FEE = 100_000_000; // 0.1 SOL

// Anchor discriminators
const DISC_UPDATE_FEE = Buffer.from([232, 253, 195, 247, 148, 212, 73, 222]);
const DISC_WITHDRAW_FEES = Buffer.from([198, 212, 171, 109, 144, 215, 174, 89]);

// ─── Helpers ──────────────────────────────────────────────────

function loadKeypair(): Keypair {
  const kpPath = process.env.KEYPAIR || path.join(os.homedir(), '.config', 'solana', 'id.json');
  const raw = JSON.parse(fs.readFileSync(kpPath, 'utf-8'));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function findConfigPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from('config')], PROGRAM_ID);
}

function lamportsToSol(lamports: number): string {
  return (lamports / LAMPORTS_PER_SOL).toFixed(9);
}

function formatUsd(sol: number, solPrice: number): string {
  return `$${(sol * solPrice).toFixed(2)}`;
}

interface GuardConfig {
  admin: PublicKey;
  isPaused: boolean;
  totalCommits: number;
  totalVerifies: number;
  minBalance: number;
  verifyFee: number;
  totalFeesCollected: number;
  bump: number;
}

async function fetchConfig(connection: Connection): Promise<GuardConfig & { lamports: number; rentExempt: number }> {
  const [configPda] = findConfigPda();
  const info = await connection.getAccountInfo(configPda);
  if (!info) throw new Error('GuardConfig not found — run initialize first');

  const data = info.data;
  const view = new DataView(data.buffer, data.byteOffset);

  // Decode: discriminator(8) + admin(32) + is_paused(1) + total_commits(8) + total_verifies(8) + min_balance(8) + verify_fee(8) + total_fees_collected(8) + bump(1)
  const admin = new PublicKey(data.slice(8, 40));
  const isPaused = data[40] === 1;
  const totalCommits = Number(view.getBigUint64(41, true));
  const totalVerifies = Number(view.getBigUint64(49, true));
  const minBalance = Number(view.getBigUint64(57, true));

  // New fields (may be 0 if not migrated)
  let verifyFee = 0;
  let totalFeesCollected = 0;
  let bump = data[65];

  if (data.length >= 82) {
    verifyFee = Number(view.getBigUint64(65, true));
    totalFeesCollected = Number(view.getBigUint64(73, true));
    bump = data[81];
  }

  const rent = await connection.getMinimumBalanceForRentExemption(data.length);

  return {
    admin,
    isPaused,
    totalCommits,
    totalVerifies,
    minBalance,
    verifyFee,
    totalFeesCollected,
    bump,
    lamports: info.lamports,
    rentExempt: rent,
  };
}

// ─── Commands ─────────────────────────────────────────────────

async function cmdStatus() {
  const connection = new Connection(RPC_URL, 'confirmed');
  const config = await fetchConfig(connection);
  const available = config.lamports - config.rentExempt;
  const verifyRate = config.totalCommits > 0
    ? ((config.totalVerifies / config.totalCommits) * 100).toFixed(1)
    : '0.0';

  console.log(`
  IntentGuard Fee Status
  ${'═'.repeat(50)}

  Protocol
  ├─ Status:          ${config.isPaused ? 'PAUSED' : 'Active'}
  ├─ Admin:           ${config.admin.toBase58().slice(0, 20)}...
  ├─ Total commits:   ${config.totalCommits.toLocaleString()}
  ├─ Total verifies:  ${config.totalVerifies.toLocaleString()}
  └─ Verify rate:     ${verifyRate}%

  Fee Configuration
  ├─ Verify fee:      ${config.verifyFee.toLocaleString()} lamports (${lamportsToSol(config.verifyFee)} SOL)
  ├─ Fee per verify:  ${config.verifyFee === 0 ? 'FREE' : lamportsToSol(config.verifyFee) + ' SOL'}
  └─ Max allowed:     ${MAX_FEE.toLocaleString()} lamports (${lamportsToSol(MAX_FEE)} SOL)

  Revenue
  ├─ Fees collected:  ${config.totalFeesCollected.toLocaleString()} lamports (${lamportsToSol(config.totalFeesCollected)} SOL)
  ├─ PDA balance:     ${config.lamports.toLocaleString()} lamports (${lamportsToSol(config.lamports)} SOL)
  ├─ Rent-exempt:     ${config.rentExempt.toLocaleString()} lamports
  └─ Withdrawable:    ${Math.max(0, available).toLocaleString()} lamports (${lamportsToSol(Math.max(0, available))} SOL)
  `);
}

async function cmdSetFee(feeStr: string) {
  const fee = parseInt(feeStr, 10);
  if (isNaN(fee) || fee < 0) {
    console.error('  Error: fee must be a non-negative number (lamports)');
    process.exit(1);
  }
  if (fee > MAX_FEE) {
    console.error(`  Error: fee exceeds maximum (${MAX_FEE} lamports = ${lamportsToSol(MAX_FEE)} SOL)`);
    process.exit(1);
  }

  const connection = new Connection(RPC_URL, 'confirmed');
  const admin = loadKeypair();
  const [configPda] = findConfigPda();

  const data = Buffer.alloc(16);
  DISC_UPDATE_FEE.copy(data, 0);
  data.writeBigUInt64LE(BigInt(fee), 8);

  const tx = new Transaction().add({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: configPda, isSigner: false, isWritable: true },
      { pubkey: admin.publicKey, isSigner: true, isWritable: true },
    ],
    data,
  });

  console.log(`\n  Setting verify fee to ${fee.toLocaleString()} lamports (${lamportsToSol(fee)} SOL)...`);

  const sig = await sendAndConfirmTransaction(connection, tx, [admin]);
  console.log(`  Done! TX: ${sig}`);
  console.log(`  Fee is now: ${fee === 0 ? 'FREE' : lamportsToSol(fee) + ' SOL per verify'}\n`);
}

async function cmdWithdraw(amountStr: string | 'all') {
  const connection = new Connection(RPC_URL, 'confirmed');
  const admin = loadKeypair();
  const [configPda] = findConfigPda();
  const config = await fetchConfig(connection);
  const available = config.lamports - config.rentExempt;

  let amount: number;
  if (amountStr === 'all') {
    amount = Math.max(0, available);
  } else {
    amount = parseInt(amountStr, 10);
  }

  if (isNaN(amount) || amount <= 0) {
    console.error('  Error: nothing to withdraw');
    process.exit(1);
  }
  if (amount > available) {
    console.error(`  Error: requested ${amount} but only ${available} available`);
    process.exit(1);
  }

  const data = Buffer.alloc(16);
  DISC_WITHDRAW_FEES.copy(data, 0);
  data.writeBigUInt64LE(BigInt(amount), 8);

  const tx = new Transaction().add({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: configPda, isSigner: false, isWritable: true },
      { pubkey: admin.publicKey, isSigner: true, isWritable: true },
    ],
    data,
  });

  console.log(`\n  Withdrawing ${amount.toLocaleString()} lamports (${lamportsToSol(amount)} SOL)...`);

  const sig = await sendAndConfirmTransaction(connection, tx, [admin]);
  console.log(`  Done! TX: ${sig}`);
  console.log(`  Withdrawn: ${lamportsToSol(amount)} SOL to ${admin.publicKey.toBase58().slice(0, 20)}...\n`);
}

async function cmdSimulate(dailyVerifiesStr: string) {
  const dailyVerifies = parseInt(dailyVerifiesStr, 10);
  if (isNaN(dailyVerifies) || dailyVerifies <= 0) {
    console.error('  Error: daily-verifies must be a positive number');
    process.exit(1);
  }

  const connection = new Connection(RPC_URL, 'confirmed');
  const config = await fetchConfig(connection);

  if (config.verifyFee === 0) {
    console.log('\n  Fee is currently 0 (free). Set a fee first with: set-fee <lamports>\n');
    process.exit(0);
  }

  const feeSol = config.verifyFee / LAMPORTS_PER_SOL;
  const daily = dailyVerifies * feeSol;
  const weekly = daily * 7;
  const monthly = daily * 30;
  const yearly = daily * 365;

  // SOL price estimates
  const prices = [20, 50, 100, 200];

  console.log(`
  IntentGuard Revenue Projection
  ${'═'.repeat(55)}

  Fee:              ${config.verifyFee.toLocaleString()} lamports (${feeSol} SOL)
  Daily verifies:   ${dailyVerifies.toLocaleString()}

  Revenue (SOL)
  ├─ Daily:         ${daily.toFixed(4)} SOL
  ├─ Weekly:        ${weekly.toFixed(4)} SOL
  ├─ Monthly:       ${monthly.toFixed(4)} SOL
  └─ Yearly:        ${yearly.toFixed(4)} SOL

  Revenue (USD at various SOL prices)
  ┌─────────────┬──────────┬──────────┬───────────┬────────────┐
  │ SOL Price   │ Daily    │ Monthly  │ Yearly    │ Yearly+10x │
  ├─────────────┼──────────┼──────────┼───────────┼────────────┤`);

  for (const p of prices) {
    const d = formatUsd(daily, p).padStart(8);
    const m = formatUsd(monthly, p).padStart(8);
    const y = formatUsd(yearly, p).padStart(9);
    const y10 = formatUsd(yearly * 10, p).padStart(10);
    console.log(`  │ $${p.toString().padStart(3)}/SOL    │ ${d} │ ${m} │ ${y} │ ${y10} │`);
  }

  console.log(`  └─────────────┴──────────┴──────────┴───────────┴────────────┘

  Fee tier suggestions
  ├─ Micro:   1,000 lamports  (0.000001 SOL) — High volume, low friction
  ├─ Low:     100,000 lamports (0.0001 SOL)  — Standard dApp usage
  ├─ Medium:  1,000,000 lamports (0.001 SOL) — Premium verification
  └─ High:    10,000,000 lamports (0.01 SOL) — Enterprise / high-value TX
  `);
}

async function cmdHistory() {
  const connection = new Connection(RPC_URL, 'confirmed');
  const config = await fetchConfig(connection);

  const avgFeePerVerify = config.totalVerifies > 0
    ? config.totalFeesCollected / config.totalVerifies
    : 0;

  console.log(`
  IntentGuard Fee History
  ${'═'.repeat(50)}

  Lifetime Stats
  ├─ Total verifies:       ${config.totalVerifies.toLocaleString()}
  ├─ Total fees collected:  ${config.totalFeesCollected.toLocaleString()} lamports (${lamportsToSol(config.totalFeesCollected)} SOL)
  ├─ Avg fee per verify:   ${avgFeePerVerify.toFixed(0)} lamports
  └─ Current fee rate:     ${config.verifyFee.toLocaleString()} lamports

  Fee Vault
  ├─ PDA balance:          ${config.lamports.toLocaleString()} lamports (${lamportsToSol(config.lamports)} SOL)
  ├─ Rent reserved:        ${config.rentExempt.toLocaleString()} lamports
  ├─ Available to withdraw: ${Math.max(0, config.lamports - config.rentExempt).toLocaleString()} lamports
  └─ Already withdrawn:    ${Math.max(0, config.totalFeesCollected - (config.lamports - config.rentExempt)).toLocaleString()} lamports (est.)
  `);
}

// ─── Main ─────────────────────────────────────────────────────

const [, , command, ...args] = process.argv;

switch (command) {
  case 'status':
    cmdStatus();
    break;
  case 'set-fee':
    if (!args[0]) {
      console.error('  Usage: set-fee <lamports>');
      console.error('  Examples: set-fee 0          (free)');
      console.error('            set-fee 1000000    (0.001 SOL)');
      console.error('            set-fee 10000000   (0.01 SOL)');
      process.exit(1);
    }
    cmdSetFee(args[0]);
    break;
  case 'withdraw':
    cmdWithdraw(args[0] || '0');
    break;
  case 'withdraw-all':
    cmdWithdraw('all');
    break;
  case 'simulate':
    if (!args[0]) {
      console.error('  Usage: simulate <daily-verifies>');
      console.error('  Example: simulate 1000');
      process.exit(1);
    }
    cmdSimulate(args[0]);
    break;
  case 'history':
    cmdHistory();
    break;
  default:
    console.log(`
  IntentGuard Fee Administration
  ${'═'.repeat(45)}

  Commands:
    status                     Show fee config and revenue
    set-fee <lamports>         Set verify fee (0=free, max 0.1 SOL)
    withdraw <lamports>        Withdraw fees to admin wallet
    withdraw-all               Withdraw all available fees
    simulate <daily-verifies>  Project revenue at current fee
    history                    Show fee collection stats

  Environment:
    RPC_URL    Solana RPC endpoint (default: mainnet-beta)
    KEYPAIR    Path to admin keypair (default: ~/.config/solana/id.json)

  Examples:
    npx tsx scripts/fee-admin.ts status
    npx tsx scripts/fee-admin.ts set-fee 1000000
    npx tsx scripts/fee-admin.ts simulate 500
    npx tsx scripts/fee-admin.ts withdraw-all
    `);
}
