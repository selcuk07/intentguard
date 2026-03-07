/**
 * App Registry — resolve app_id to verified metadata.
 *
 * Uses a bundled registry for known apps (works offline) and
 * optionally fetches the latest registry from GitHub Pages.
 */

export interface AppInfo {
  name: string;
  icon: string;
  website: string;
  verified: boolean;
  category: string;
  description: string;
}

export interface AppRegistry {
  version: number;
  updatedAt: string;
  apps: Record<string, AppInfo>;
}

const REGISTRY_URL =
  'https://selcuk07.github.io/intentguard/app-registry.json';

/** Bundled known apps — always available without network */
const KNOWN_APPS: Record<string, AppInfo> = {
  'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4': {
    name: 'Jupiter',
    icon: 'https://jup.ag/favicon.ico',
    website: 'https://jup.ag',
    verified: true,
    category: 'DEX',
    description: 'Jupiter Aggregator — Best swap rates on Solana',
  },
  '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8': {
    name: 'Raydium',
    icon: 'https://raydium.io/favicon.ico',
    website: 'https://raydium.io',
    verified: true,
    category: 'DEX',
    description: 'Raydium AMM — Liquidity and swaps',
  },
  'TSWAPaqyCSx2KABk68Shruf4rp7CxcNi8hAsbdwmHbN': {
    name: 'Tensor',
    icon: 'https://tensor.trade/favicon.ico',
    website: 'https://tensor.trade',
    verified: true,
    category: 'NFT',
    description: 'Tensor — NFT marketplace',
  },
  'M2mx93ekt1fmXSVkTrUL9xVFHkmME8HTUi5Cyc5aF7K': {
    name: 'Magic Eden',
    icon: 'https://magiceden.io/favicon.ico',
    website: 'https://magiceden.io',
    verified: true,
    category: 'NFT',
    description: 'Magic Eden — NFT marketplace',
  },
  'MarBmsSgKXdrN1egZf5sqe1TMai9K1rChYNDJgjq7aD': {
    name: 'Marinade',
    icon: 'https://marinade.finance/favicon.ico',
    website: 'https://marinade.finance',
    verified: true,
    category: 'Staking',
    description: 'Marinade Finance — Liquid staking',
  },
  'PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY': {
    name: 'Phoenix',
    icon: 'https://phoenix.trade/favicon.ico',
    website: 'https://phoenix.trade',
    verified: true,
    category: 'DEX',
    description: 'Phoenix — On-chain order book',
  },
  'DjVE6JNiYqPL2QXyCUUh8rNjHrbz9hXHNYt99MQ59qw1': {
    name: 'Orca',
    icon: 'https://orca.so/favicon.ico',
    website: 'https://orca.so',
    verified: true,
    category: 'DEX',
    description: 'Orca — Concentrated liquidity AMM',
  },
  'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK': {
    name: 'Raydium CLMM',
    icon: 'https://raydium.io/favicon.ico',
    website: 'https://raydium.io',
    verified: true,
    category: 'DEX',
    description: 'Raydium Concentrated Liquidity Market Maker',
  },
  '4etWfDJNHhjYdv7fuGe236GDPguwUXVk9WhbEpQsPix7': {
    name: 'IntentGuard',
    icon: 'https://selcuk07.github.io/intentguard/favicon.png',
    website: 'https://selcuk07.github.io/intentguard',
    verified: true,
    category: 'Security',
    description: 'IntentGuard — Solana 2FA protocol',
  },
};

let remoteCache: AppRegistry | null = null;

/**
 * Look up an app by its program ID (base58).
 * Checks remote registry first (if fetched), then falls back to bundled list.
 */
export async function lookupApp(appId: string): Promise<AppInfo | null> {
  // Try remote first
  if (!remoteCache) {
    try {
      const res = await fetch(REGISTRY_URL);
      if (res.ok) remoteCache = await res.json();
    } catch {
      // Network unavailable — use bundled
    }
  }

  return remoteCache?.apps[appId] ?? KNOWN_APPS[appId] ?? null;
}

/**
 * Synchronous lookup using only the bundled registry (no network).
 */
export function lookupAppSync(appId: string): AppInfo | null {
  return remoteCache?.apps[appId] ?? KNOWN_APPS[appId] ?? null;
}

/**
 * Check if an app is verified in the registry.
 */
export function isVerified(info: AppInfo | null): boolean {
  return info?.verified === true;
}

/**
 * Get the full bundled registry (no network needed).
 */
export function getKnownApps(): Readonly<Record<string, AppInfo>> {
  return KNOWN_APPS;
}

/**
 * Fetch and return the latest remote registry.
 */
export async function fetchRegistry(): Promise<AppRegistry> {
  const res = await fetch(REGISTRY_URL);
  if (!res.ok) throw new Error(`Failed to fetch registry: ${res.status}`);
  const registry: AppRegistry = await res.json();
  remoteCache = registry;
  return registry;
}
