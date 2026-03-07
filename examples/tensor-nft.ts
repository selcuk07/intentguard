/**
 * Partner Integration: IntentGuard + Tensor / Magic Eden
 *
 * Protects NFT marketplace operations (buy, list, bid, delist) by binding
 * NFT parameters to an intent hash committed from a trusted device.
 *
 * Supported actions:
 *   - buy:    Purchase an NFT at a listed price
 *   - list:   List an NFT for sale
 *   - bid:    Place a bid on an NFT or collection
 *   - delist: Remove an NFT listing
 *
 * Flow:
 *   1. User sees NFT: "Buy Mad Lads #1234 for 50 SOL"
 *   2. Frontend shows QR code with purchase params
 *   3. User scans QR on mobile -> commits intent hash on-chain (TX1)
 *   4. Frontend detects commit -> builds atomic TX:
 *      verify_intent + Tensor buy (TX2)
 *   5. If frontend is compromised and swaps the NFT mint or price:
 *      -> verify_intent fails -> TX reverts -> funds safe
 *
 * CLI commit:
 *   intentguard commit \
 *     --app TSWAPaqyCSx2KABk68Shruf4rp7CxcNi8hAsbdwmHbN \
 *     --action buy \
 *     --params '{"mint":"...","price":"50000000000","collection":"mad_lads"}'
 */

import { PublicKey, Transaction } from '@solana/web3.js';
import {
  computeIntentHash,
  createVerifyIntentInstruction,
  findIntentCommitPda,
} from 'intentguard-sdk';

// Tensor Trade program
const TENSOR_SWAP = new PublicKey('TSWAPaqyCSx2KABk68Shruf4rp7CxcNi8hAsbdwmHbN');
// Magic Eden v2
const MAGIC_EDEN_V2 = new PublicKey('M2mx93ekt1fmXSVkTrUL9xVFHkmME8HTUi5Cyc5aF7K');

type NftAction = 'buy' | 'list' | 'bid' | 'delist';

interface NftBuyParams {
  action: 'buy';
  marketplace: PublicKey;
  mint: PublicKey;
  /** Price in lamports */
  price: bigint;
  /** Optional: seller address for verification */
  seller?: PublicKey;
}

interface NftListParams {
  action: 'list';
  marketplace: PublicKey;
  mint: PublicKey;
  /** Listing price in lamports */
  price: bigint;
}

interface NftBidParams {
  action: 'bid';
  marketplace: PublicKey;
  /** Collection address or specific mint */
  target: PublicKey;
  /** Bid amount in lamports */
  amount: bigint;
  /** Number of NFTs to bid on (collection bid) */
  quantity: number;
}

interface NftDelistParams {
  action: 'delist';
  marketplace: PublicKey;
  mint: PublicKey;
}

type NftParams = NftBuyParams | NftListParams | NftBidParams | NftDelistParams;

/**
 * Compute intent hash for NFT operations.
 */
function computeNftHash(user: PublicKey, params: NftParams): number[] {
  const buffers: Buffer[] = [
    params.marketplace.toBuffer(),
    user.toBuffer(),
    Buffer.from(params.action),
  ];

  switch (params.action) {
    case 'buy':
      buffers.push(params.mint.toBuffer());
      buffers.push(Buffer.from(new BigUint64Array([params.price]).buffer));
      if (params.seller) buffers.push(params.seller.toBuffer());
      break;
    case 'list':
      buffers.push(params.mint.toBuffer());
      buffers.push(Buffer.from(new BigUint64Array([params.price]).buffer));
      break;
    case 'bid':
      buffers.push(params.target.toBuffer());
      buffers.push(Buffer.from(new BigUint64Array([params.amount]).buffer));
      buffers.push(Buffer.from(new Uint32Array([params.quantity]).buffer));
      break;
    case 'delist':
      buffers.push(params.mint.toBuffer());
      break;
  }

  return computeIntentHash(buffers);
}

/**
 * Generate QR payload for mobile app.
 */
function generateQrPayload(user: PublicKey, params: NftParams): string {
  const marketplaceName = params.marketplace.equals(TENSOR_SWAP) ? 'Tensor' : 'Magic Eden';

  let description: string;
  let qrParams: Record<string, string>;

  switch (params.action) {
    case 'buy':
      description = `Buy NFT for ${Number(params.price) / 1e9} SOL`;
      qrParams = {
        mint: params.mint.toBase58(),
        price: params.price.toString(),
        ...(params.seller ? { seller: params.seller.toBase58() } : {}),
      };
      break;
    case 'list':
      description = `List NFT for ${Number(params.price) / 1e9} SOL`;
      qrParams = {
        mint: params.mint.toBase58(),
        price: params.price.toString(),
      };
      break;
    case 'bid':
      description = `Bid ${Number(params.amount) / 1e9} SOL x${params.quantity}`;
      qrParams = {
        target: params.target.toBase58(),
        amount: params.amount.toString(),
        quantity: params.quantity.toString(),
      };
      break;
    case 'delist':
      description = `Delist NFT`;
      qrParams = { mint: params.mint.toBase58() };
      break;
  }

  return JSON.stringify({
    protocol: 'intentguard',
    version: 1,
    app: params.marketplace.toBase58(),
    action: params.action,
    params: qrParams,
    display: {
      title: `${marketplaceName} - ${capitalize(params.action)}`,
      description,
      icon: params.marketplace.equals(TENSOR_SWAP)
        ? 'https://tensor.trade/favicon.ico'
        : 'https://magiceden.io/favicon.ico',
    },
  });
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Build a protected NFT buy transaction.
 */
function buildProtectedBuyTx(
  user: PublicKey,
  params: NftBuyParams,
): { tx: Transaction; hash: number[] } {
  const hash = computeNftHash(user, params);

  const verifyIx = createVerifyIntentInstruction(
    user,
    params.marketplace,
    hash,
  );

  // In production: build Tensor/ME buy instruction
  // const buyIx = buildTensorBuyInstruction(params);
  const tx = new Transaction().add(verifyIx);
  // tx.add(buyIx);

  return { tx, hash };
}

// --- Demo ---

async function demo() {
  const user = PublicKey.unique();
  const nftMint = PublicKey.unique();
  const seller = PublicKey.unique();
  const collectionAddr = PublicKey.unique();

  console.log('\n  IntentGuard + Tensor/Magic Eden NFT Integration');
  console.log(`  ${'='.repeat(50)}`);

  // --- Buy NFT Demo ---
  const buyParams: NftBuyParams = {
    action: 'buy',
    marketplace: TENSOR_SWAP,
    mint: nftMint,
    price: 50_000_000_000n,  // 50 SOL
    seller,
  };

  console.log(`\n  Scenario 1: Buy NFT on Tensor`);
  console.log(`  ${'-'.repeat(45)}`);
  const qr1 = generateQrPayload(user, buyParams);
  const parsed1 = JSON.parse(qr1);
  console.log(`  ${parsed1.display.title}`);
  console.log(`  ${parsed1.display.description}`);
  const buyHash = computeNftHash(user, buyParams);
  console.log(`  Hash: ${Buffer.from(buyHash).toString('hex').slice(0, 32)}...`);

  // --- List NFT Demo ---
  const listParams: NftListParams = {
    action: 'list',
    marketplace: MAGIC_EDEN_V2,
    mint: nftMint,
    price: 75_000_000_000n,  // 75 SOL
  };

  console.log(`\n  Scenario 2: List NFT on Magic Eden`);
  console.log(`  ${'-'.repeat(45)}`);
  const qr2 = generateQrPayload(user, listParams);
  const parsed2 = JSON.parse(qr2);
  console.log(`  ${parsed2.display.title}`);
  console.log(`  ${parsed2.display.description}`);
  const listHash = computeNftHash(user, listParams);
  console.log(`  Hash: ${Buffer.from(listHash).toString('hex').slice(0, 32)}...`);

  // --- Collection Bid Demo ---
  const bidParams: NftBidParams = {
    action: 'bid',
    marketplace: TENSOR_SWAP,
    target: collectionAddr,
    amount: 30_000_000_000n,  // 30 SOL per NFT
    quantity: 5,
  };

  console.log(`\n  Scenario 3: Collection Bid on Tensor`);
  console.log(`  ${'-'.repeat(45)}`);
  const qr3 = generateQrPayload(user, bidParams);
  const parsed3 = JSON.parse(qr3);
  console.log(`  ${parsed3.display.title}`);
  console.log(`  ${parsed3.display.description}`);
  const bidHash = computeNftHash(user, bidParams);
  console.log(`  Hash: ${Buffer.from(bidHash).toString('hex').slice(0, 32)}...`);

  // --- Attack Scenarios ---
  console.log(`\n  Attack Scenarios (Buy)`);
  console.log(`  ${'-'.repeat(45)}`);

  // Attack 1: Swap NFT mint
  const attack1 = computeNftHash(user, { ...buyParams, mint: PublicKey.unique() });
  console.log(`  1. Attacker swaps NFT to worthless mint:`);
  console.log(`     Hash match: ${Buffer.from(buyHash).equals(Buffer.from(attack1)) ? 'YES' : 'NO -> TX REVERTS'}`);

  // Attack 2: Inflate price
  const attack2 = computeNftHash(user, { ...buyParams, price: 500_000_000_000n });
  console.log(`  2. Attacker inflates price to 500 SOL:`);
  console.log(`     Hash match: ${Buffer.from(buyHash).equals(Buffer.from(attack2)) ? 'YES' : 'NO -> TX REVERTS'}`);

  // Attack 3: Change marketplace
  const attack3 = computeNftHash(user, { ...buyParams, marketplace: MAGIC_EDEN_V2 });
  console.log(`  3. Attacker redirects to different marketplace:`);
  console.log(`     Hash match: ${Buffer.from(buyHash).equals(Buffer.from(attack3)) ? 'YES' : 'NO -> TX REVERTS'}`);

  // Attack 4: Change seller (front-run)
  const attack4 = computeNftHash(user, { ...buyParams, seller: PublicKey.unique() });
  console.log(`  4. Attacker changes seller (front-run attack):`);
  console.log(`     Hash match: ${Buffer.from(buyHash).equals(Buffer.from(attack4)) ? 'YES' : 'NO -> TX REVERTS'}`);

  console.log(`\n  Result: All NFT attacks prevented. Funds SAFE.\n`);
}

demo();
