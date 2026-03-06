import { PublicKey } from '@solana/web3.js';

export const INTENT_GUARD_PROGRAM_ID = new PublicKey(
  '4etWfDJNHhjYdv7fuGe236GDPguwUXVk9WhbEpQsPix7',
);

export const DEVNET_RPC = 'https://api.devnet.solana.com';
export const MAINNET_RPC = 'https://api.mainnet-beta.solana.com';

export const DEFAULT_TTL = 300;

// Webhook server URL for push notification registration
// Set to your deployed webhook-server URL (e.g., ngrok tunnel or production)
export const WEBHOOK_SERVER_URL = process.env.EXPO_PUBLIC_WEBHOOK_URL || '';
