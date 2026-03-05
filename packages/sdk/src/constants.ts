import { PublicKey } from '@solana/web3.js';

// Program ID — update after first deploy
export const INTENT_GUARD_PROGRAM_ID = new PublicKey(
  '4etWfDJNHhjYdv7fuGe236GDPguwUXVk9WhbEpQsPix7',
);

export const DEFAULT_TTL = 300; // 5 minutes
export const MAX_TTL = 3600; // 1 hour
