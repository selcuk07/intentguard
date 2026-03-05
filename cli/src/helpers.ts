import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import idl from '../intent_guard.json';

// Program ID — update after devnet deploy
export const PROGRAM_ID = new PublicKey(idl.address);

export function findConfigPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from('config')], PROGRAM_ID);
}

export function findIntentPda(user: PublicKey, appId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('intent'), user.toBuffer(), appId.toBuffer()],
    PROGRAM_ID,
  );
}

export function loadKeypair(keypairPath?: string): Keypair {
  const resolvedPath = keypairPath
    || process.env.INTENTGUARD_KEYPAIR
    || path.join(os.homedir(), '.config', 'solana', 'id.json');

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Keypair not found: ${resolvedPath}\nSet --keypair or INTENTGUARD_KEYPAIR env var`);
  }

  const raw = JSON.parse(fs.readFileSync(resolvedPath, 'utf-8'));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

export function getRpcUrl(cluster?: string): string {
  const c = cluster || process.env.INTENTGUARD_CLUSTER || 'devnet';
  switch (c) {
    case 'mainnet':
    case 'mainnet-beta':
      return process.env.INTENTGUARD_RPC || 'https://api.mainnet-beta.solana.com';
    case 'devnet':
      return process.env.INTENTGUARD_RPC || 'https://api.devnet.solana.com';
    case 'localnet':
    case 'localhost':
      return 'http://localhost:8899';
    default:
      // Treat as custom RPC URL
      return c;
  }
}

export function getProgram(keypair: Keypair, rpcUrl: string) {
  const connection = new Connection(rpcUrl, 'confirmed');
  const wallet = new anchor.Wallet(keypair);
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: 'confirmed',
  });
  return new anchor.Program(idl as anchor.Idl, provider);
}

/**
 * Compute SHA-256 intent hash from raw buffers.
 */
export function computeHash(buffers: Buffer[]): number[] {
  const hash = createHash('sha256');
  for (const buf of buffers) hash.update(buf);
  return Array.from(hash.digest());
}

/**
 * Compute intent hash for a generic action.
 * Format: SHA-256(app_id + user + action_label + params_json)
 */
export function computeActionHash(
  appId: PublicKey,
  user: PublicKey,
  action: string,
  params: Record<string, string>,
): number[] {
  const paramsJson = JSON.stringify(params, Object.keys(params).sort());
  return computeHash([
    appId.toBuffer(),
    user.toBuffer(),
    Buffer.from(action),
    Buffer.from(paramsJson),
  ]);
}

export function shortKey(pubkey: PublicKey): string {
  const s = pubkey.toBase58();
  return `${s.slice(0, 4)}...${s.slice(-4)}`;
}

export function formatTimestamp(ts: number): string {
  return new Date(ts * 1000).toISOString().replace('T', ' ').replace('.000Z', ' UTC');
}
