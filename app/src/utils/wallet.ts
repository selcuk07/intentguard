import { Keypair } from '@solana/web3.js';
import * as SecureStore from 'expo-secure-store';
import { Buffer } from 'buffer';

const WALLET_KEY = 'intentguard_wallet';

/**
 * Get or create a device-local keypair.
 * Stored encrypted in Expo SecureStore (Keychain on iOS, EncryptedSharedPrefs on Android).
 */
export async function getOrCreateWallet(): Promise<Keypair> {
  const existing = await SecureStore.getItemAsync(WALLET_KEY);

  if (existing) {
    const secret = Uint8Array.from(JSON.parse(existing));
    return Keypair.fromSecretKey(secret);
  }

  const keypair = Keypair.generate();
  await SecureStore.setItemAsync(
    WALLET_KEY,
    JSON.stringify(Array.from(keypair.secretKey)),
  );
  return keypair;
}

/**
 * Import a keypair from a base58 secret key or JSON array.
 */
export async function importWallet(secretKeyData: string): Promise<Keypair> {
  let secret: Uint8Array;

  try {
    // Try JSON array format first
    const arr = JSON.parse(secretKeyData);
    secret = Uint8Array.from(arr);
  } catch {
    // Try base58 (raw secret key)
    const bs58 = await import('bs58');
    secret = bs58.default.decode(secretKeyData);
  }

  const keypair = Keypair.fromSecretKey(secret);
  await SecureStore.setItemAsync(
    WALLET_KEY,
    JSON.stringify(Array.from(keypair.secretKey)),
  );
  return keypair;
}

export async function deleteWallet(): Promise<void> {
  await SecureStore.deleteItemAsync(WALLET_KEY);
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}
