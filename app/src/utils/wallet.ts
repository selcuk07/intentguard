import { Keypair } from '@solana/web3.js';
import { Platform } from 'react-native';
import { Buffer } from 'buffer';

const WALLET_KEY = 'intentguard_wallet';

// Storage abstraction: SecureStore on native, localStorage on web
async function getItem(key: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    return localStorage.getItem(key);
  }
  const SecureStore = await import('expo-secure-store');
  return SecureStore.getItemAsync(key);
}

async function setItem(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    localStorage.setItem(key, value);
    return;
  }
  const SecureStore = await import('expo-secure-store');
  await SecureStore.setItemAsync(key, value);
}

async function deleteItem(key: string): Promise<void> {
  if (Platform.OS === 'web') {
    localStorage.removeItem(key);
    return;
  }
  const SecureStore = await import('expo-secure-store');
  await SecureStore.deleteItemAsync(key);
}

/**
 * Get or create a device-local keypair.
 * Native: Expo SecureStore (Keychain / EncryptedSharedPrefs)
 * Web: localStorage (for testing only)
 */
export async function getOrCreateWallet(): Promise<Keypair> {
  const existing = await getItem(WALLET_KEY);

  if (existing) {
    const secret = Uint8Array.from(JSON.parse(existing));
    return Keypair.fromSecretKey(secret);
  }

  const keypair = Keypair.generate();
  await setItem(WALLET_KEY, JSON.stringify(Array.from(keypair.secretKey)));
  return keypair;
}

/**
 * Import a keypair from a base58 secret key or JSON array.
 */
export async function importWallet(secretKeyData: string): Promise<Keypair> {
  let secret: Uint8Array;

  try {
    const arr = JSON.parse(secretKeyData);
    secret = Uint8Array.from(arr);
  } catch {
    const bs58 = await import('bs58');
    secret = bs58.default.decode(secretKeyData);
  }

  const keypair = Keypair.fromSecretKey(secret);
  await setItem(WALLET_KEY, JSON.stringify(Array.from(keypair.secretKey)));
  return keypair;
}

export async function deleteWallet(): Promise<void> {
  await deleteItem(WALLET_KEY);
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}
