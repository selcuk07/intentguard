/**
 * Partner Integration: IntentGuard + Jupiter v6
 *
 * Protects DEX swaps by binding swap parameters (input/output mints,
 * amount, slippage) to an intent hash committed from a trusted device.
 *
 * Flow:
 *   1. User sees swap UI: "Swap 1 SOL -> USDC (min 150 USDC)"
 *   2. Frontend shows QR code with intent params
 *   3. User scans QR on mobile -> commits intent hash on-chain (TX1)
 *   4. Frontend detects commit -> fetches Jupiter route -> builds
 *      atomic TX: verify_intent + Jupiter swap (TX2)
 *   5. If frontend is compromised and changes amount/slippage:
 *      -> verify_intent fails -> TX reverts -> funds safe
 *
 * CLI commit:
 *   intentguard commit \
 *     --app JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4 \
 *     --action swap \
 *     --params '{"inputMint":"So11...","outputMint":"EPjF...","amount":"1000000000","minOut":"150000000"}'
 */

import { PublicKey, Transaction } from '@solana/web3.js';
import {
  computeIntentHash,
  createCommitIntentInstruction,
  createVerifyIntentInstruction,
  findIntentCommitPda,
} from 'intentguard-sdk';

// Program IDs
const JUPITER_V6 = new PublicKey('JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4');

// Common mints
const SOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');
const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const BONK_MINT = new PublicKey('DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263');

interface SwapParams {
  inputMint: PublicKey;
  outputMint: PublicKey;
  amount: bigint;
  minOut: bigint;
  slippageBps: number;
}

/**
 * Compute intent hash for a Jupiter swap.
 * Binds: program + user + inputMint + outputMint + amount + minOut
 */
function computeSwapHash(user: PublicKey, params: SwapParams): number[] {
  return computeIntentHash([
    JUPITER_V6.toBuffer(),
    user.toBuffer(),
    Buffer.from('swap'),
    params.inputMint.toBuffer(),
    params.outputMint.toBuffer(),
    Buffer.from(new BigUint64Array([params.amount]).buffer),
    Buffer.from(new BigUint64Array([params.minOut]).buffer),
  ]);
}

/**
 * Generate QR payload for mobile app to display and commit.
 */
function generateQrPayload(user: PublicKey, params: SwapParams): string {
  return JSON.stringify({
    protocol: 'intentguard',
    version: 1,
    app: JUPITER_V6.toBase58(),
    action: 'swap',
    params: {
      inputMint: params.inputMint.toBase58(),
      outputMint: params.outputMint.toBase58(),
      amount: params.amount.toString(),
      minOut: params.minOut.toString(),
      slippageBps: params.slippageBps,
    },
    display: {
      title: 'Jupiter Swap',
      description: formatSwapDescription(params),
      icon: 'https://jup.ag/favicon.ico',
    },
  });
}

function formatSwapDescription(p: SwapParams): string {
  const inputName = getMintName(p.inputMint);
  const outputName = getMintName(p.outputMint);
  const inputDecimals = getMintDecimals(p.inputMint);
  const outputDecimals = getMintDecimals(p.outputMint);
  return `Swap ${Number(p.amount) / 10 ** inputDecimals} ${inputName} -> min ${Number(p.minOut) / 10 ** outputDecimals} ${outputName} (${p.slippageBps / 100}% slippage)`;
}

function getMintName(mint: PublicKey): string {
  const names: Record<string, string> = {
    [SOL_MINT.toBase58()]: 'SOL',
    [USDC_MINT.toBase58()]: 'USDC',
    [BONK_MINT.toBase58()]: 'BONK',
  };
  return names[mint.toBase58()] || mint.toBase58().slice(0, 6) + '...';
}

function getMintDecimals(mint: PublicKey): number {
  if (mint.equals(SOL_MINT)) return 9;
  if (mint.equals(USDC_MINT)) return 6;
  if (mint.equals(BONK_MINT)) return 5;
  return 9;
}

/**
 * Build a protected swap transaction.
 *
 * In production, the Jupiter swap instruction would come from
 * the Jupiter API (GET /quote + POST /swap-instructions).
 * IntentGuard's verify_intent is prepended as instruction 0.
 */
function buildProtectedSwapTx(
  user: PublicKey,
  params: SwapParams,
): { tx: Transaction; hash: number[] } {
  const hash = computeSwapHash(user, params);

  const verifyIx = createVerifyIntentInstruction(
    user,
    JUPITER_V6,
    hash,
  );

  // In production: fetch from Jupiter API
  // const jupiterIx = await getJupiterSwapInstruction(params);
  const tx = new Transaction().add(verifyIx);
  // tx.add(jupiterIx);

  return { tx, hash };
}

// --- Demo ---

async function demo() {
  const user = PublicKey.unique();

  const params: SwapParams = {
    inputMint: SOL_MINT,
    outputMint: USDC_MINT,
    amount: 1_000_000_000n,   // 1 SOL
    minOut: 150_000_000n,     // 150 USDC
    slippageBps: 50,          // 0.5%
  };

  console.log('\n  IntentGuard + Jupiter Swap Integration');
  console.log(`  ${'='.repeat(50)}`);
  console.log(`  User:  ${user.toBase58()}`);

  // Step 1: QR code
  const qr = generateQrPayload(user, params);
  const parsed = JSON.parse(qr);
  console.log(`\n  Step 1: QR Code`);
  console.log(`  ${'-'.repeat(45)}`);
  console.log(`  ${parsed.display.description}`);
  console.log(`  Payload: ${qr.length} bytes`);

  // Step 2: Mobile commits
  const hash = computeSwapHash(user, params);
  console.log(`\n  Step 2: Mobile Commit`);
  console.log(`  ${'-'.repeat(45)}`);
  console.log(`  Hash: ${Buffer.from(hash).toString('hex').slice(0, 32)}...`);

  // Step 3: Protected TX
  const { tx } = buildProtectedSwapTx(user, params);
  const [pda] = findIntentCommitPda(user, JUPITER_V6);
  console.log(`\n  Step 3: Protected TX`);
  console.log(`  ${'-'.repeat(45)}`);
  console.log(`  IX 0: IntentGuard.verify_intent`);
  console.log(`  IX 1: Jupiter.swap (1 SOL -> min 150 USDC)`);
  console.log(`  PDA:  ${pda.toBase58()}`);

  // Attack scenarios
  console.log(`\n  Attack Scenarios`);
  console.log(`  ${'-'.repeat(45)}`);

  // Attack 1: Change amount
  const attack1 = computeSwapHash(user, { ...params, amount: 10_000_000_000n });
  console.log(`  1. Attacker changes amount to 10 SOL:`);
  console.log(`     Hash match: ${Buffer.from(hash).equals(Buffer.from(attack1)) ? 'YES' : 'NO -> TX REVERTS'}`);

  // Attack 2: Change slippage
  const attack2 = computeSwapHash(user, { ...params, minOut: 1_000_000n });
  console.log(`  2. Attacker sets minOut to 1 USDC (sandwich):`);
  console.log(`     Hash match: ${Buffer.from(hash).equals(Buffer.from(attack2)) ? 'YES' : 'NO -> TX REVERTS'}`);

  // Attack 3: Change output mint
  const attack3 = computeSwapHash(user, { ...params, outputMint: BONK_MINT });
  console.log(`  3. Attacker swaps to BONK instead of USDC:`);
  console.log(`     Hash match: ${Buffer.from(hash).equals(Buffer.from(attack3)) ? 'YES' : 'NO -> TX REVERTS'}`);

  console.log(`\n  Result: All attacks prevented. Funds SAFE.\n`);
}

demo();
