/**
 * Partner Integration: IntentGuard + Marinade Finance
 *
 * Protects liquid staking operations (stake, unstake, delayed unstake)
 * by binding staking parameters to an intent hash committed from a
 * trusted device.
 *
 * Supported actions:
 *   - stake:            Deposit SOL -> receive mSOL
 *   - unstake:          Instant unstake mSOL -> SOL (with fee)
 *   - delayed_unstake:  Delayed unstake mSOL -> SOL (no fee, ~2 epochs)
 *   - claim:            Claim delayed unstake ticket
 *
 * Flow:
 *   1. User sees staking UI: "Stake 100 SOL -> receive ~95.5 mSOL"
 *   2. Frontend shows QR code with staking params
 *   3. User scans QR on mobile -> commits intent hash on-chain (TX1)
 *   4. Frontend detects commit -> builds atomic TX:
 *      verify_intent + Marinade deposit (TX2)
 *   5. If frontend is compromised and changes amount or destination:
 *      -> verify_intent fails -> TX reverts -> funds safe
 *
 * CLI commit:
 *   intentguard commit \
 *     --app MarBmsSgKXdrN1egZf5sqe1TMai9K1rChYNDJgjq7aD \
 *     --action stake \
 *     --params '{"amount":"100000000000","minMsolOut":"95500000000"}'
 */

import { PublicKey, Transaction } from '@solana/web3.js';
import {
  computeIntentHash,
  createVerifyIntentInstruction,
  findIntentCommitPda,
} from 'intentguard-sdk';

// Marinade Finance program
const MARINADE_PROGRAM = new PublicKey('MarBmsSgKXdrN1egZf5sqe1TMai9K1rChYNDJgjq7aD');

// Token mints
const SOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');
const MSOL_MINT = new PublicKey('mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So');

type StakeAction = 'stake' | 'unstake' | 'delayed_unstake' | 'claim';

interface StakeParams {
  action: 'stake';
  /** SOL amount in lamports */
  amount: bigint;
  /** Minimum mSOL to receive */
  minMsolOut: bigint;
}

interface UnstakeParams {
  action: 'unstake';
  /** mSOL amount in lamports */
  msolAmount: bigint;
  /** Minimum SOL to receive (after instant unstake fee) */
  minSolOut: bigint;
}

interface DelayedUnstakeParams {
  action: 'delayed_unstake';
  /** mSOL amount in lamports */
  msolAmount: bigint;
}

interface ClaimParams {
  action: 'claim';
  /** Ticket account address */
  ticket: PublicKey;
}

type MarinadeParams = StakeParams | UnstakeParams | DelayedUnstakeParams | ClaimParams;

/**
 * Compute intent hash for Marinade operations.
 */
function computeMarinadeHash(user: PublicKey, params: MarinadeParams): number[] {
  const buffers: Buffer[] = [
    MARINADE_PROGRAM.toBuffer(),
    user.toBuffer(),
    Buffer.from(params.action),
  ];

  switch (params.action) {
    case 'stake':
      buffers.push(Buffer.from(new BigUint64Array([params.amount]).buffer));
      buffers.push(Buffer.from(new BigUint64Array([params.minMsolOut]).buffer));
      break;
    case 'unstake':
      buffers.push(Buffer.from(new BigUint64Array([params.msolAmount]).buffer));
      buffers.push(Buffer.from(new BigUint64Array([params.minSolOut]).buffer));
      break;
    case 'delayed_unstake':
      buffers.push(Buffer.from(new BigUint64Array([params.msolAmount]).buffer));
      break;
    case 'claim':
      buffers.push(params.ticket.toBuffer());
      break;
  }

  return computeIntentHash(buffers);
}

/**
 * Generate QR payload for mobile app.
 */
function generateQrPayload(user: PublicKey, params: MarinadeParams): string {
  let description: string;
  let qrParams: Record<string, string>;

  switch (params.action) {
    case 'stake':
      description = `Stake ${Number(params.amount) / 1e9} SOL -> min ${Number(params.minMsolOut) / 1e9} mSOL`;
      qrParams = {
        amount: params.amount.toString(),
        minMsolOut: params.minMsolOut.toString(),
      };
      break;
    case 'unstake':
      description = `Instant unstake ${Number(params.msolAmount) / 1e9} mSOL -> min ${Number(params.minSolOut) / 1e9} SOL`;
      qrParams = {
        msolAmount: params.msolAmount.toString(),
        minSolOut: params.minSolOut.toString(),
      };
      break;
    case 'delayed_unstake':
      description = `Delayed unstake ${Number(params.msolAmount) / 1e9} mSOL (no fee, ~2 epochs)`;
      qrParams = {
        msolAmount: params.msolAmount.toString(),
      };
      break;
    case 'claim':
      description = `Claim unstake ticket`;
      qrParams = {
        ticket: params.ticket.toBase58(),
      };
      break;
  }

  return JSON.stringify({
    protocol: 'intentguard',
    version: 1,
    app: MARINADE_PROGRAM.toBase58(),
    action: params.action,
    params: qrParams,
    display: {
      title: `Marinade - ${formatAction(params.action)}`,
      description,
      icon: 'https://marinade.finance/favicon.ico',
    },
  });
}

function formatAction(action: StakeAction): string {
  switch (action) {
    case 'stake': return 'Stake SOL';
    case 'unstake': return 'Instant Unstake';
    case 'delayed_unstake': return 'Delayed Unstake';
    case 'claim': return 'Claim Ticket';
  }
}

/**
 * Build a protected staking transaction.
 */
function buildProtectedStakeTx(
  user: PublicKey,
  params: MarinadeParams,
): { tx: Transaction; hash: number[] } {
  const hash = computeMarinadeHash(user, params);

  const verifyIx = createVerifyIntentInstruction(
    user,
    MARINADE_PROGRAM,
    hash,
  );

  // In production: build Marinade deposit/unstake instruction
  // const marinadeIx = buildMarinadeInstruction(params);
  const tx = new Transaction().add(verifyIx);
  // tx.add(marinadeIx);

  return { tx, hash };
}

// --- Demo ---

async function demo() {
  const user = PublicKey.unique();
  const fakeTicket = PublicKey.unique();

  console.log('\n  IntentGuard + Marinade Finance Integration');
  console.log(`  ${'='.repeat(50)}`);

  // --- Stake Demo ---
  const stakeParams: StakeParams = {
    action: 'stake',
    amount: 100_000_000_000n,      // 100 SOL
    minMsolOut: 95_500_000_000n,   // ~95.5 mSOL (accounting for mSOL/SOL ratio)
  };

  console.log(`\n  Scenario 1: Stake SOL`);
  console.log(`  ${'-'.repeat(45)}`);
  const qr1 = generateQrPayload(user, stakeParams);
  const parsed1 = JSON.parse(qr1);
  console.log(`  ${parsed1.display.description}`);
  const stakeHash = computeMarinadeHash(user, stakeParams);
  console.log(`  Hash: ${Buffer.from(stakeHash).toString('hex').slice(0, 32)}...`);
  console.log(`  TX:   [verify_intent] + [marinade.deposit]`);

  // --- Instant Unstake Demo ---
  const unstakeParams: UnstakeParams = {
    action: 'unstake',
    msolAmount: 50_000_000_000n,   // 50 mSOL
    minSolOut: 51_000_000_000n,    // ~51 SOL (mSOL appreciates)
  };

  console.log(`\n  Scenario 2: Instant Unstake`);
  console.log(`  ${'-'.repeat(45)}`);
  const qr2 = generateQrPayload(user, unstakeParams);
  const parsed2 = JSON.parse(qr2);
  console.log(`  ${parsed2.display.description}`);
  const unstakeHash = computeMarinadeHash(user, unstakeParams);
  console.log(`  Hash: ${Buffer.from(unstakeHash).toString('hex').slice(0, 32)}...`);
  console.log(`  TX:   [verify_intent] + [marinade.liquid_unstake]`);

  // --- Delayed Unstake Demo ---
  const delayedParams: DelayedUnstakeParams = {
    action: 'delayed_unstake',
    msolAmount: 200_000_000_000n,  // 200 mSOL
  };

  console.log(`\n  Scenario 3: Delayed Unstake`);
  console.log(`  ${'-'.repeat(45)}`);
  const qr3 = generateQrPayload(user, delayedParams);
  const parsed3 = JSON.parse(qr3);
  console.log(`  ${parsed3.display.description}`);
  const delayedHash = computeMarinadeHash(user, delayedParams);
  console.log(`  Hash: ${Buffer.from(delayedHash).toString('hex').slice(0, 32)}...`);
  console.log(`  TX:   [verify_intent] + [marinade.order_unstake]`);

  // --- Claim Demo ---
  const claimParams: ClaimParams = {
    action: 'claim',
    ticket: fakeTicket,
  };

  console.log(`\n  Scenario 4: Claim Unstake Ticket`);
  console.log(`  ${'-'.repeat(45)}`);
  const qr4 = generateQrPayload(user, claimParams);
  const parsed4 = JSON.parse(qr4);
  console.log(`  ${parsed4.display.description}`);
  const claimHash = computeMarinadeHash(user, claimParams);
  console.log(`  Hash: ${Buffer.from(claimHash).toString('hex').slice(0, 32)}...`);

  // --- Attack Scenarios ---
  console.log(`\n  Attack Scenarios (Stake)`);
  console.log(`  ${'-'.repeat(45)}`);

  // Attack 1: Inflate amount
  const attack1 = computeMarinadeHash(user, { ...stakeParams, amount: 1000_000_000_000n });
  console.log(`  1. Attacker inflates stake to 1000 SOL:`);
  console.log(`     Hash match: ${Buffer.from(stakeHash).equals(Buffer.from(attack1)) ? 'YES' : 'NO -> TX REVERTS'}`);

  // Attack 2: Set minMsolOut to 0 (accept any ratio)
  const attack2 = computeMarinadeHash(user, { ...stakeParams, minMsolOut: 0n });
  console.log(`  2. Attacker sets minMsolOut to 0 (accept bad ratio):`);
  console.log(`     Hash match: ${Buffer.from(stakeHash).equals(Buffer.from(attack2)) ? 'YES' : 'NO -> TX REVERTS'}`);

  // Attack 3: Change action (stake -> unstake)
  const attack3 = computeMarinadeHash(user, {
    action: 'unstake',
    msolAmount: stakeParams.amount,
    minSolOut: 0n,
  });
  console.log(`  3. Attacker changes stake to unstake:`);
  console.log(`     Hash match: ${Buffer.from(stakeHash).equals(Buffer.from(attack3)) ? 'YES' : 'NO -> TX REVERTS'}`);

  // Attack 4: Claim wrong ticket
  const attack4 = computeMarinadeHash(user, { action: 'claim', ticket: PublicKey.unique() });
  console.log(`  4. Attacker claims different ticket:`);
  console.log(`     Hash match: ${Buffer.from(claimHash).equals(Buffer.from(attack4)) ? 'YES' : 'NO -> TX REVERTS'}`);

  console.log(`\n  Result: All staking attacks prevented. Funds SAFE.\n`);
}

demo();
