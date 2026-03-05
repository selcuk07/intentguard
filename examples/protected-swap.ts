/**
 * Example: IntentGuard-protected Jupiter Swap
 *
 * Shows how a DEX aggregator frontend would integrate IntentGuard.
 * The user commits swap parameters from mobile, then the browser
 * adds verify_intent as a pre-instruction before the actual swap.
 *
 * Flow:
 *   1. User sees swap UI: "Swap 1 SOL → USDC (min 150 USDC)"
 *   2. Frontend shows QR code with intent params
 *   3. User scans QR on mobile → commits intent hash (TX1)
 *   4. Frontend detects commit → builds swap TX with verify_intent (TX2)
 *   5. If frontend is compromised and changes amount/slippage:
 *      → verify_intent fails → TX reverts → funds safe
 *
 * CLI commit:
 *   intentguard commit \
 *     --app JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4 \
 *     --action swap \
 *     --params '{"inputMint":"So11...","outputMint":"EPjF...","amount":"1000000000","minOut":"150000000"}'
 */

import { PublicKey } from '@solana/web3.js';
import { createHash } from 'crypto';

// IntentGuard program
const INTENT_GUARD_ID = new PublicKey('4etWfDJNHhjYdv7fuGe236GDPguwUXVk9WhbEpQsPix7');

// Jupiter v6 program
const JUPITER_ID = new PublicKey('JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4');

// Common token mints
const SOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');
const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

/**
 * Frontend: Generate QR code data for mobile app
 */
function generateQrPayload(
  user: PublicKey,
  inputMint: PublicKey,
  outputMint: PublicKey,
  amountIn: bigint,
  minAmountOut: bigint,
): string {
  // Human-readable params for mobile display
  const params = {
    amount: amountIn.toString(),
    inputMint: inputMint.toBase58(),
    minOut: minAmountOut.toString(),
    outputMint: outputMint.toBase58(),
  };

  // QR deep link
  return JSON.stringify({
    protocol: 'intentguard',
    version: 1,
    app: JUPITER_ID.toBase58(),
    action: 'swap',
    params,
    display: {
      title: 'Jupiter Swap',
      description: `Swap ${Number(amountIn) / 1e9} SOL → min ${Number(minAmountOut) / 1e6} USDC`,
    },
  });
}

/**
 * Mobile app / CLI: Compute intent hash from params
 */
function computeSwapIntentHash(
  user: PublicKey,
  inputMint: PublicKey,
  outputMint: PublicKey,
  amountIn: bigint,
  minAmountOut: bigint,
): Buffer {
  const params = {
    amount: amountIn.toString(),
    inputMint: inputMint.toBase58(),
    minOut: minAmountOut.toString(),
    outputMint: outputMint.toBase58(),
  };
  const sorted = JSON.stringify(params, Object.keys(params).sort());

  const hash = createHash('sha256');
  hash.update(JUPITER_ID.toBuffer());
  hash.update(user.toBuffer());
  hash.update(Buffer.from('swap'));
  hash.update(Buffer.from(sorted));
  return hash.digest();
}

/**
 * Frontend: Build protected swap transaction
 *
 * In a real integration, this would:
 * 1. Get Jupiter route quote
 * 2. Build swap instruction from Jupiter API
 * 3. Prepend verify_intent instruction
 * 4. Send as atomic transaction
 */
async function buildProtectedSwapTx(
  user: PublicKey,
  inputMint: PublicKey,
  outputMint: PublicKey,
  amountIn: bigint,
  minAmountOut: bigint,
) {
  const intentHash = computeSwapIntentHash(user, inputMint, outputMint, amountIn, minAmountOut);

  const [intentPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('intent'), user.toBuffer(), JUPITER_ID.toBuffer()],
    INTENT_GUARD_ID,
  );

  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('config')],
    INTENT_GUARD_ID,
  );

  console.log('\n  Protected Swap Transaction Blueprint');
  console.log(`  ${'─'.repeat(50)}`);
  console.log(`  Instruction 1: IntentGuard.verify_intent`);
  console.log(`    Program:     ${INTENT_GUARD_ID.toBase58()}`);
  console.log(`    IntentPDA:   ${intentPda.toBase58()}`);
  console.log(`    Hash:        ${intentHash.toString('hex').slice(0, 32)}...`);
  console.log();
  console.log(`  Instruction 2: Jupiter.swap`);
  console.log(`    Program:     ${JUPITER_ID.toBase58()}`);
  console.log(`    Input:       ${Number(amountIn) / 1e9} SOL`);
  console.log(`    Min output:  ${Number(minAmountOut) / 1e6} USDC`);
  console.log();
  console.log(`  Security: If frontend changes amount/slippage after commit,`);
  console.log(`  verify_intent hash won't match → entire TX reverts.`);

  return { intentHash, intentPda, configPda };
}

// --- Demo ---

async function demo() {
  const fakeUser = PublicKey.unique();

  console.log('\n  IntentGuard + Jupiter Swap Demo');
  console.log(`  ${'='.repeat(50)}`);

  // 1. Frontend generates QR
  const qr = generateQrPayload(
    fakeUser,
    SOL_MINT,
    USDC_MINT,
    1_000_000_000n, // 1 SOL
    150_000_000n,   // min 150 USDC
  );

  console.log('\n  Step 1: Frontend generates QR code');
  console.log(`  ${'-'.repeat(45)}`);
  const parsed = JSON.parse(qr);
  console.log(`  App:     ${parsed.display.title}`);
  console.log(`  Action:  ${parsed.display.description}`);
  console.log(`  QR data: ${qr.length} bytes`);

  // 2. Mobile scans → commits hash
  console.log('\n  Step 2: Mobile commits intent (TX1)');
  console.log(`  ${'-'.repeat(45)}`);
  const hash = computeSwapIntentHash(
    fakeUser, SOL_MINT, USDC_MINT, 1_000_000_000n, 150_000_000n,
  );
  console.log(`  Hash:    ${hash.toString('hex').slice(0, 32)}...`);
  console.log(`  Status:  Committed on-chain from mobile`);

  // 3. Frontend builds protected TX
  console.log('\n  Step 3: Frontend builds protected swap (TX2)');
  console.log(`  ${'-'.repeat(45)}`);
  await buildProtectedSwapTx(
    fakeUser, SOL_MINT, USDC_MINT, 1_000_000_000n, 150_000_000n,
  );

  // 4. Attack scenario
  console.log('\n  Attack Scenario: Frontend compromised');
  console.log(`  ${'-'.repeat(45)}`);
  const attackHash = computeSwapIntentHash(
    fakeUser, SOL_MINT, USDC_MINT, 10_000_000_000n, 1_000_000n, // 10 SOL, min 1 USDC
  );
  console.log(`  Attacker changes: 1 SOL → 10 SOL, slippage 99%`);
  console.log(`  Original hash:  ${hash.toString('hex').slice(0, 16)}...`);
  console.log(`  Attack hash:    ${attackHash.toString('hex').slice(0, 16)}...`);
  console.log(`  Match:          ${hash.equals(attackHash) ? 'YES (vulnerable!)' : 'NO → TX REVERTS'}`);
  console.log(`\n  Result: User's funds are SAFE.\n`);
}

demo();
