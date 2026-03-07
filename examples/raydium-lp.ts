/**
 * Partner Integration: IntentGuard + Raydium
 *
 * Protects liquidity pool operations (add/remove liquidity) by binding
 * pool parameters to an intent hash committed from a trusted device.
 *
 * Supported actions:
 *   - add_liquidity: Deposit token pair into a Raydium pool
 *   - remove_liquidity: Withdraw token pair from a Raydium pool
 *
 * Flow:
 *   1. User sees LP UI: "Add 10 SOL + 1500 USDC to SOL/USDC pool"
 *   2. Frontend shows QR code with LP params
 *   3. User scans QR on mobile -> commits intent hash on-chain (TX1)
 *   4. Frontend detects commit -> builds atomic TX:
 *      verify_intent + Raydium add_liquidity (TX2)
 *   5. If frontend is compromised and changes pool/amounts:
 *      -> verify_intent fails -> TX reverts -> funds safe
 *
 * CLI commit:
 *   intentguard commit \
 *     --app 675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8 \
 *     --action add_liquidity \
 *     --params '{"pool":"...","tokenA":"So11...","tokenB":"EPjF...","amountA":"10000000000","amountB":"1500000000","minLpOut":"500000"}'
 */

import { PublicKey, Transaction } from '@solana/web3.js';
import {
  computeIntentHash,
  createVerifyIntentInstruction,
  findIntentCommitPda,
} from 'intentguard-sdk';

// Raydium AMM v4
const RAYDIUM_AMM_V4 = new PublicKey('675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8');
// Raydium CLMM (Concentrated Liquidity)
const RAYDIUM_CLMM = new PublicKey('CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK');

// Common mints
const SOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');
const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const RAY_MINT = new PublicKey('4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R');

type LpAction = 'add_liquidity' | 'remove_liquidity';

interface LpParams {
  action: LpAction;
  pool: PublicKey;
  tokenA: PublicKey;
  tokenB: PublicKey;
  amountA: bigint;
  amountB: bigint;
  /** Minimum LP tokens to receive (add) or minimum tokens to receive (remove) */
  minOut: bigint;
}

/**
 * Compute intent hash for a Raydium LP operation.
 * Binds: program + user + action + pool + tokens + amounts + minOut
 */
function computeLpHash(user: PublicKey, params: LpParams): number[] {
  return computeIntentHash([
    RAYDIUM_AMM_V4.toBuffer(),
    user.toBuffer(),
    Buffer.from(params.action),
    params.pool.toBuffer(),
    params.tokenA.toBuffer(),
    params.tokenB.toBuffer(),
    Buffer.from(new BigUint64Array([params.amountA]).buffer),
    Buffer.from(new BigUint64Array([params.amountB]).buffer),
    Buffer.from(new BigUint64Array([params.minOut]).buffer),
  ]);
}

/**
 * Generate QR payload for mobile app.
 */
function generateQrPayload(user: PublicKey, params: LpParams): string {
  const tokenAName = getMintName(params.tokenA);
  const tokenBName = getMintName(params.tokenB);
  const tokenADecimals = getMintDecimals(params.tokenA);
  const tokenBDecimals = getMintDecimals(params.tokenB);

  const actionLabel = params.action === 'add_liquidity' ? 'Add Liquidity' : 'Remove Liquidity';
  const description = params.action === 'add_liquidity'
    ? `Add ${Number(params.amountA) / 10 ** tokenADecimals} ${tokenAName} + ${Number(params.amountB) / 10 ** tokenBDecimals} ${tokenBName}`
    : `Remove LP -> min ${Number(params.amountA) / 10 ** tokenADecimals} ${tokenAName} + ${Number(params.amountB) / 10 ** tokenBDecimals} ${tokenBName}`;

  return JSON.stringify({
    protocol: 'intentguard',
    version: 1,
    app: RAYDIUM_AMM_V4.toBase58(),
    action: params.action,
    params: {
      pool: params.pool.toBase58(),
      tokenA: params.tokenA.toBase58(),
      tokenB: params.tokenB.toBase58(),
      amountA: params.amountA.toString(),
      amountB: params.amountB.toString(),
      minOut: params.minOut.toString(),
    },
    display: {
      title: `Raydium ${actionLabel}`,
      description,
      icon: 'https://raydium.io/favicon.ico',
    },
  });
}

function getMintName(mint: PublicKey): string {
  const names: Record<string, string> = {
    [SOL_MINT.toBase58()]: 'SOL',
    [USDC_MINT.toBase58()]: 'USDC',
    [RAY_MINT.toBase58()]: 'RAY',
  };
  return names[mint.toBase58()] || mint.toBase58().slice(0, 6) + '...';
}

function getMintDecimals(mint: PublicKey): number {
  if (mint.equals(SOL_MINT)) return 9;
  if (mint.equals(USDC_MINT)) return 6;
  if (mint.equals(RAY_MINT)) return 6;
  return 9;
}

/**
 * Build a protected LP transaction.
 * verify_intent is prepended before the Raydium instruction.
 */
function buildProtectedLpTx(
  user: PublicKey,
  params: LpParams,
): { tx: Transaction; hash: number[] } {
  const hash = computeLpHash(user, params);

  const verifyIx = createVerifyIntentInstruction(
    user,
    RAYDIUM_AMM_V4,
    hash,
  );

  // In production: build Raydium add/remove liquidity instruction
  // const raydiumIx = buildRaydiumLpInstruction(params);
  const tx = new Transaction().add(verifyIx);
  // tx.add(raydiumIx);

  return { tx, hash };
}

// --- Demo ---

async function demo() {
  const user = PublicKey.unique();
  const fakePool = PublicKey.unique();

  console.log('\n  IntentGuard + Raydium LP Integration');
  console.log(`  ${'='.repeat(50)}`);

  // --- Add Liquidity Demo ---
  const addParams: LpParams = {
    action: 'add_liquidity',
    pool: fakePool,
    tokenA: SOL_MINT,
    tokenB: USDC_MINT,
    amountA: 10_000_000_000n,  // 10 SOL
    amountB: 1_500_000_000n,   // 1500 USDC
    minOut: 500_000n,          // min LP tokens
  };

  console.log(`\n  Scenario 1: Add Liquidity`);
  console.log(`  ${'-'.repeat(45)}`);

  const qr1 = generateQrPayload(user, addParams);
  const parsed1 = JSON.parse(qr1);
  console.log(`  ${parsed1.display.description}`);

  const addHash = computeLpHash(user, addParams);
  console.log(`  Hash: ${Buffer.from(addHash).toString('hex').slice(0, 32)}...`);

  const [pda1] = findIntentCommitPda(user, RAYDIUM_AMM_V4);
  console.log(`  PDA:  ${pda1.toBase58()}`);
  console.log(`  TX:   [verify_intent] + [raydium.add_liquidity]`);

  // --- Remove Liquidity Demo ---
  const removeParams: LpParams = {
    action: 'remove_liquidity',
    pool: fakePool,
    tokenA: SOL_MINT,
    tokenB: USDC_MINT,
    amountA: 5_000_000_000n,   // min 5 SOL back
    amountB: 750_000_000n,     // min 750 USDC back
    minOut: 250_000n,          // LP tokens to burn
  };

  console.log(`\n  Scenario 2: Remove Liquidity`);
  console.log(`  ${'-'.repeat(45)}`);

  const qr2 = generateQrPayload(user, removeParams);
  const parsed2 = JSON.parse(qr2);
  console.log(`  ${parsed2.display.description}`);

  const removeHash = computeLpHash(user, removeParams);
  console.log(`  Hash: ${Buffer.from(removeHash).toString('hex').slice(0, 32)}...`);

  // --- Attack Scenarios ---
  console.log(`\n  Attack Scenarios`);
  console.log(`  ${'-'.repeat(45)}`);

  // Attack 1: Drain to wrong pool
  const attack1 = computeLpHash(user, { ...addParams, pool: PublicKey.unique() });
  console.log(`  1. Attacker redirects to malicious pool:`);
  console.log(`     Hash match: ${Buffer.from(addHash).equals(Buffer.from(attack1)) ? 'YES' : 'NO -> TX REVERTS'}`);

  // Attack 2: Inflate amounts
  const attack2 = computeLpHash(user, { ...addParams, amountA: 100_000_000_000n });
  console.log(`  2. Attacker inflates SOL amount to 100:`);
  console.log(`     Hash match: ${Buffer.from(addHash).equals(Buffer.from(attack2)) ? 'YES' : 'NO -> TX REVERTS'}`);

  // Attack 3: Set minOut to 0 (rug the LP)
  const attack3 = computeLpHash(user, { ...addParams, minOut: 0n });
  console.log(`  3. Attacker sets minLpOut to 0 (unfair ratio):`);
  console.log(`     Hash match: ${Buffer.from(addHash).equals(Buffer.from(attack3)) ? 'YES' : 'NO -> TX REVERTS'}`);

  // Attack 4: Swap token pair
  const attack4 = computeLpHash(user, { ...addParams, tokenB: RAY_MINT });
  console.log(`  4. Attacker swaps USDC for RAY token:`);
  console.log(`     Hash match: ${Buffer.from(addHash).equals(Buffer.from(attack4)) ? 'YES' : 'NO -> TX REVERTS'}`);

  console.log(`\n  Result: All LP attacks prevented. Funds SAFE.\n`);
}

demo();
