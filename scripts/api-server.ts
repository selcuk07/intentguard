/**
 * IntentGuard Premium API Server
 *
 * Hosted verification service with API key authentication,
 * rate limiting, analytics, and webhook management.
 *
 * Tiers:
 *   Free:       10 req/min, basic stats
 *   Pro:        100 req/min, analytics, webhooks, priority support
 *   Enterprise: unlimited, custom deployment, SLA, dedicated support
 *
 * Usage:
 *   PORT=4000 API_SECRET=mysecret npx tsx scripts/api-server.ts
 *
 * Endpoints:
 *   POST /api/v1/verify          Check if intent is verified
 *   GET  /api/v1/intent/:pda     Get intent status by PDA
 *   GET  /api/v1/intents/:wallet Get all intents for a wallet
 *   GET  /api/v1/stats           Protocol stats (public)
 *   GET  /api/v1/analytics       Detailed analytics (Pro+)
 *   POST /api/v1/webhooks        Register webhook (Pro+)
 *   GET  /api/v1/webhooks        List webhooks (Pro+)
 *   DELETE /api/v1/webhooks/:id  Delete webhook (Pro+)
 *   POST /api/v1/keys            Create API key (admin)
 *   GET  /api/v1/keys            List API keys (admin)
 *   GET  /api/v1/pricing         Get pricing info (public)
 */

import express from 'express';
import crypto from 'crypto';
import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';

const app = express();
app.use(express.json());

const PORT = parseInt(process.env.PORT || '4000', 10);
const API_SECRET = process.env.API_SECRET || 'dev-secret-change-me';
const RPC_URL = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
const PROGRAM_ID = '4etWfDJNHhjYdv7fuGe236GDPguwUXVk9WhbEpQsPix7';

const connection = new Connection(RPC_URL, 'confirmed');

// ─── Tier Definitions ─────────────────────────────────────────

interface Tier {
  name: string;
  rateLimit: number; // requests per minute
  analyticsAccess: boolean;
  webhookLimit: number;
  prioritySupport: boolean;
  price: { monthly: number; yearly: number }; // USD
}

const TIERS: Record<string, Tier> = {
  free: {
    name: 'Free',
    rateLimit: 10,
    analyticsAccess: false,
    webhookLimit: 0,
    prioritySupport: false,
    price: { monthly: 0, yearly: 0 },
  },
  pro: {
    name: 'Pro',
    rateLimit: 100,
    analyticsAccess: true,
    webhookLimit: 10,
    prioritySupport: true,
    price: { monthly: 49, yearly: 470 },
  },
  enterprise: {
    name: 'Enterprise',
    rateLimit: Infinity,
    analyticsAccess: true,
    webhookLimit: 100,
    prioritySupport: true,
    price: { monthly: 299, yearly: 2990 },
  },
};

// ─── In-Memory Storage (use database in production) ───────────

interface ApiKey {
  key: string;
  name: string;
  tier: string;
  createdAt: string;
  requestCount: number;
  lastUsed: string | null;
}

interface Webhook {
  id: string;
  apiKey: string;
  url: string;
  events: string[];
  createdAt: string;
  deliveryCount: number;
}

interface RateWindow {
  count: number;
  resetAt: number;
}

const apiKeys = new Map<string, ApiKey>();
const webhooks = new Map<string, Webhook>();
const rateLimits = new Map<string, RateWindow>();
const analyticsEvents: Array<{
  timestamp: string;
  apiKey: string;
  endpoint: string;
  status: number;
  latencyMs: number;
}> = [];

// Create default admin key
const adminKey = crypto.createHash('sha256').update(API_SECRET).digest('hex').slice(0, 32);
apiKeys.set(adminKey, {
  key: adminKey,
  name: 'Admin',
  tier: 'enterprise',
  createdAt: new Date().toISOString(),
  requestCount: 0,
  lastUsed: null,
});

// ─── Middleware ────────────────────────────────────────────────

function authenticate(req: express.Request, res: express.Response, next: express.NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing API key. Use Authorization: Bearer <key>' });
    return;
  }

  const key = authHeader.slice(7);
  const apiKey = apiKeys.get(key);
  if (!apiKey) {
    res.status(403).json({ error: 'Invalid API key' });
    return;
  }

  // Rate limiting
  const tier = TIERS[apiKey.tier];
  const now = Date.now();
  let window = rateLimits.get(key);

  if (!window || now > window.resetAt) {
    window = { count: 0, resetAt: now + 60_000 };
    rateLimits.set(key, window);
  }

  window.count++;
  if (window.count > tier.rateLimit) {
    res.status(429).json({
      error: 'Rate limit exceeded',
      limit: tier.rateLimit,
      resetIn: Math.ceil((window.resetAt - now) / 1000),
      upgrade: apiKey.tier === 'free' ? 'Upgrade to Pro for 100 req/min' : undefined,
    });
    return;
  }

  apiKey.requestCount++;
  apiKey.lastUsed = new Date().toISOString();
  (req as any).apiKey = apiKey;
  (req as any).tier = tier;
  next();
}

function requireTier(minTier: string) {
  const tierOrder = ['free', 'pro', 'enterprise'];
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const apiKey = (req as any).apiKey as ApiKey;
    const userIdx = tierOrder.indexOf(apiKey.tier);
    const requiredIdx = tierOrder.indexOf(minTier);
    if (userIdx < requiredIdx) {
      res.status(403).json({
        error: `This endpoint requires ${TIERS[minTier].name} tier or higher`,
        currentTier: apiKey.tier,
        upgrade: `Upgrade to ${TIERS[minTier].name}: $${TIERS[minTier].price.monthly}/mo`,
      });
      return;
    }
    next();
  };
}

function trackAnalytics(req: express.Request, res: express.Response, next: express.NextFunction) {
  const start = Date.now();
  const originalEnd = res.end.bind(res);
  (res as any).end = function (...args: any[]) {
    const apiKey = (req as any).apiKey as ApiKey | undefined;
    if (apiKey) {
      analyticsEvents.push({
        timestamp: new Date().toISOString(),
        apiKey: apiKey.key.slice(0, 8) + '...',
        endpoint: req.path,
        status: res.statusCode,
        latencyMs: Date.now() - start,
      });
      // Keep last 10K events
      if (analyticsEvents.length > 10_000) analyticsEvents.splice(0, analyticsEvents.length - 10_000);
    }
    return originalEnd(...args);
  };
  next();
}

app.use(trackAnalytics);

// ─── Public Endpoints ─────────────────────────────────────────

// Pricing info (no auth needed)
app.get('/api/v1/pricing', (_req, res) => {
  res.json({
    tiers: Object.entries(TIERS).map(([id, tier]) => ({
      id,
      name: tier.name,
      rateLimit: tier.rateLimit === Infinity ? 'unlimited' : `${tier.rateLimit}/min`,
      analytics: tier.analyticsAccess,
      webhooks: tier.webhookLimit,
      prioritySupport: tier.prioritySupport,
      price: tier.price,
    })),
    protocolFee: {
      description: 'Per-verify on-chain fee (separate from API pricing)',
      note: 'Protocol fee is set by admin and paid in SOL on-chain',
    },
  });
});

// Protocol stats (no auth needed)
app.get('/api/v1/stats', async (_req, res) => {
  try {
    const discriminator = Buffer.from([95, 175, 118, 50, 193, 113, 37, 250]).toString('base64');
    const result = await connection.getProgramAccounts(new PublicKey(PROGRAM_ID), {
      encoding: 'base64',
      filters: [{ memcmp: { offset: 0, bytes: discriminator, encoding: 'base64' } }],
    });

    if (result.length === 0) {
      res.json({ error: 'Config not found' });
      return;
    }

    const data = Buffer.from(result[0].account.data);
    const view = new DataView(data.buffer, data.byteOffset);
    const isPaused = data[40] === 1;
    const totalCommits = Number(view.getBigUint64(41, true));
    const totalVerifies = Number(view.getBigUint64(49, true));

    let verifyFee = 0;
    let totalFeesCollected = 0;
    if (data.length >= 82) {
      verifyFee = Number(view.getBigUint64(65, true));
      totalFeesCollected = Number(view.getBigUint64(73, true));
    }

    res.json({
      status: isPaused ? 'paused' : 'active',
      totalCommits,
      totalVerifies,
      verifyRate: totalCommits > 0 ? +(totalVerifies / totalCommits * 100).toFixed(1) : 0,
      verifyFee: { lamports: verifyFee, sol: verifyFee / LAMPORTS_PER_SOL },
      totalFeesCollected: { lamports: totalFeesCollected, sol: totalFeesCollected / LAMPORTS_PER_SOL },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Authenticated Endpoints ──────────────────────────────────

// Check intent verification status
app.post('/api/v1/verify', authenticate, async (req, res) => {
  const { wallet, appId } = req.body;
  if (!wallet || !appId) {
    res.status(400).json({ error: 'wallet and appId required' });
    return;
  }

  try {
    const userKey = new PublicKey(wallet);
    const appKey = new PublicKey(appId);
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from('intent'), userKey.toBuffer(), appKey.toBuffer()],
      new PublicKey(PROGRAM_ID),
    );

    const info = await connection.getAccountInfo(pda);
    if (!info) {
      res.json({ exists: false, status: 'none', pda: pda.toBase58() });
      return;
    }

    const data = info.data;
    const view = new DataView(data.buffer, data.byteOffset);
    const committedAt = Number(view.getBigInt64(104, true));
    const expiresAt = Number(view.getBigInt64(112, true));
    const now = Math.floor(Date.now() / 1000);

    res.json({
      exists: true,
      status: expiresAt > now ? 'active' : 'expired',
      pda: pda.toBase58(),
      committedAt: new Date(committedAt * 1000).toISOString(),
      expiresAt: new Date(expiresAt * 1000).toISOString(),
      remainingSeconds: Math.max(0, expiresAt - now),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get all intents for a wallet
app.get('/api/v1/intents/:wallet', authenticate, async (req, res) => {
  try {
    const wallet = req.params.wallet;
    const walletKey = new PublicKey(wallet);
    const discriminator = Buffer.from([103, 72, 77, 62, 59, 234, 35, 126]).toString('base64');
    const walletBase64 = walletKey.toBuffer().toString('base64');

    const result = await connection.getProgramAccounts(new PublicKey(PROGRAM_ID), {
      encoding: 'base64',
      filters: [
        { memcmp: { offset: 0, bytes: discriminator, encoding: 'base64' } },
        { memcmp: { offset: 8, bytes: walletBase64, encoding: 'base64' } },
      ],
    });

    const now = Math.floor(Date.now() / 1000);
    const intents = result.map((item) => {
      const data = Buffer.from(item.account.data);
      const view = new DataView(data.buffer, data.byteOffset);
      const expiresAt = Number(view.getBigInt64(112, true));
      const hashBytes = data.slice(72, 104);

      return {
        pda: item.pubkey.toBase58(),
        appId: new PublicKey(data.slice(40, 72)).toBase58(),
        hash: hashBytes.toString('hex'),
        status: expiresAt > now ? 'active' : 'expired',
        expiresAt: new Date(expiresAt * 1000).toISOString(),
      };
    });

    res.json({ wallet, count: intents.length, intents });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Pro+ Endpoints ───────────────────────────────────────────

// Analytics
app.get('/api/v1/analytics', authenticate, requireTier('pro'), (req, res) => {
  const apiKey = (req as any).apiKey as ApiKey;
  const last24h = new Date(Date.now() - 86_400_000).toISOString();
  const recentEvents = analyticsEvents.filter((e) => e.timestamp > last24h);

  // Aggregate by endpoint
  const byEndpoint: Record<string, { count: number; avgLatency: number; errors: number }> = {};
  for (const e of recentEvents) {
    if (!byEndpoint[e.endpoint]) {
      byEndpoint[e.endpoint] = { count: 0, avgLatency: 0, errors: 0 };
    }
    const ep = byEndpoint[e.endpoint];
    ep.avgLatency = (ep.avgLatency * ep.count + e.latencyMs) / (ep.count + 1);
    ep.count++;
    if (e.status >= 400) ep.errors++;
  }

  // Hourly breakdown
  const hourly: Record<string, number> = {};
  for (const e of recentEvents) {
    const hour = e.timestamp.slice(0, 13);
    hourly[hour] = (hourly[hour] || 0) + 1;
  }

  res.json({
    period: '24h',
    totalRequests: recentEvents.length,
    byEndpoint,
    hourlyBreakdown: hourly,
    keyStats: {
      tier: apiKey.tier,
      totalRequests: apiKey.requestCount,
      lastUsed: apiKey.lastUsed,
    },
  });
});

// Webhook management
app.post('/api/v1/webhooks', authenticate, requireTier('pro'), (req, res) => {
  const apiKey = (req as any).apiKey as ApiKey;
  const tier = (req as any).tier as Tier;

  const userWebhooks = Array.from(webhooks.values()).filter((w) => w.apiKey === apiKey.key);
  if (userWebhooks.length >= tier.webhookLimit) {
    res.status(400).json({
      error: `Webhook limit reached (${tier.webhookLimit})`,
      upgrade: apiKey.tier === 'pro' ? 'Upgrade to Enterprise for 100 webhooks' : undefined,
    });
    return;
  }

  const { url, events } = req.body;
  if (!url || typeof url !== 'string') {
    res.status(400).json({ error: 'url required' });
    return;
  }

  const validEvents = ['commit', 'verify', 'revoke', 'expire', 'pause', 'unpause'];
  const selectedEvents = Array.isArray(events)
    ? events.filter((e: string) => validEvents.includes(e))
    : validEvents;

  const webhook: Webhook = {
    id: crypto.randomUUID(),
    apiKey: apiKey.key,
    url,
    events: selectedEvents,
    createdAt: new Date().toISOString(),
    deliveryCount: 0,
  };

  webhooks.set(webhook.id, webhook);
  res.status(201).json(webhook);
});

app.get('/api/v1/webhooks', authenticate, requireTier('pro'), (req, res) => {
  const apiKey = (req as any).apiKey as ApiKey;
  const userWebhooks = Array.from(webhooks.values())
    .filter((w) => w.apiKey === apiKey.key)
    .map(({ apiKey: _, ...w }) => w);
  res.json({ webhooks: userWebhooks });
});

app.delete('/api/v1/webhooks/:id', authenticate, requireTier('pro'), (req, res) => {
  const apiKey = (req as any).apiKey as ApiKey;
  const webhook = webhooks.get(req.params.id);
  if (!webhook || webhook.apiKey !== apiKey.key) {
    res.status(404).json({ error: 'Webhook not found' });
    return;
  }
  webhooks.delete(req.params.id);
  res.json({ deleted: true });
});

// ─── Admin Endpoints ──────────────────────────────────────────

app.post('/api/v1/keys', authenticate, requireTier('enterprise'), (req, res) => {
  const { name, tier } = req.body;
  if (!name || !tier || !TIERS[tier]) {
    res.status(400).json({ error: 'name and tier (free/pro/enterprise) required' });
    return;
  }

  const key = crypto.randomBytes(16).toString('hex');
  const apiKey: ApiKey = {
    key,
    name,
    tier,
    createdAt: new Date().toISOString(),
    requestCount: 0,
    lastUsed: null,
  };

  apiKeys.set(key, apiKey);
  res.status(201).json({
    key,
    name,
    tier,
    rateLimit: TIERS[tier].rateLimit === Infinity ? 'unlimited' : `${TIERS[tier].rateLimit}/min`,
    message: 'Save this key — it will not be shown again',
  });
});

app.get('/api/v1/keys', authenticate, requireTier('enterprise'), (_req, res) => {
  const keys = Array.from(apiKeys.values()).map((k) => ({
    key: k.key.slice(0, 8) + '...',
    name: k.name,
    tier: k.tier,
    requestCount: k.requestCount,
    lastUsed: k.lastUsed,
    createdAt: k.createdAt,
  }));
  res.json({ keys });
});

// ─── Health ───────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    apiKeys: apiKeys.size,
    webhooks: webhooks.size,
    analyticsEvents: analyticsEvents.length,
  });
});

// ─── Start ────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`
  IntentGuard Premium API Server
  ${'═'.repeat(45)}
  Port:      ${PORT}
  RPC:       ${RPC_URL}
  Admin key: ${adminKey.slice(0, 8)}...

  Public endpoints:
    GET  /api/v1/pricing
    GET  /api/v1/stats

  Authenticated (Bearer token):
    POST /api/v1/verify
    GET  /api/v1/intents/:wallet

  Pro+ only:
    GET  /api/v1/analytics
    POST /api/v1/webhooks
    GET  /api/v1/webhooks
    DEL  /api/v1/webhooks/:id

  Admin only:
    POST /api/v1/keys
    GET  /api/v1/keys
  `);
});
