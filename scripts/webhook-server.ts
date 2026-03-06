/**
 * IntentGuard — Webhook Event Receiver + Push Notification Service
 *
 * Receives Helius webhook events and sends push notifications
 * to mobile devices when intents are verified, revoked, or expire.
 *
 * Usage:
 *   npx tsx scripts/webhook-server.ts
 *
 * For local dev, use ngrok to expose:
 *   ngrok http 3000
 *   Then use the ngrok URL as --webhook-url in setup-helius-webhook.ts
 */

import express from "express";

const PORT = process.env.PORT || 3000;
const PROGRAM_ID = "4etWfDJNHhjYdv7fuGe236GDPguwUXVk9WhbEpQsPix7";
const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

// Anchor discriminators for log matching
const DISCRIMINATORS: Record<string, string> = {
  "af980d0a28eac908": "commit_intent",
  "f0c6d5df5e07f7f7": "verify_intent",
  "5d82f389f7bbe0c2": "revoke_intent",
  "85bbce498c267168": "pause_protocol",
  "3728bfe992208386": "unpause_protocol",
  "bfab37559f1e5e63": "transfer_admin",
  "778d9b9b60488865": "update_config",
  "5c833a69d29ae0c1": "migrate_config",
};

function parseInstruction(data: string): string {
  const disc = data.slice(0, 16);
  return DISCRIMINATORS[disc] || `unknown(${disc})`;
}

// ─── Push Token Registry ────────────────────────────────────────────

interface TokenEntry {
  pushToken: string;
  wallet: string;
  appId: string;
  intentPda: string;
  registeredAt: number;
}

// In-memory registry: intentPda -> TokenEntry
const tokenRegistry = new Map<string, TokenEntry>();

// Clean up stale entries (older than 1 hour)
function cleanupStaleEntries() {
  const cutoff = Date.now() - 3600_000;
  for (const [pda, entry] of tokenRegistry) {
    if (entry.registeredAt < cutoff) {
      tokenRegistry.delete(pda);
    }
  }
}

setInterval(cleanupStaleEntries, 60_000);

// ─── Expo Push API ──────────────────────────────────────────────────

interface PushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, string>;
  sound?: string;
  channelId?: string;
}

async function sendPushNotification(message: PushMessage): Promise<void> {
  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(message),
    });

    if (!res.ok) {
      console.log(`  Push send failed: ${res.status} ${res.statusText}`);
    } else {
      const result = await res.json();
      console.log(`  Push sent to ${message.to.slice(0, 30)}... status: ${result.data?.status || 'ok'}`);
    }
  } catch (err) {
    console.log(`  Push send error: ${(err as Error).message}`);
  }
}

/**
 * Find registered tokens matching an on-chain event's accounts.
 * For verify_intent: accounts[0] = intentPda, accounts[2] = user (verifier)
 * For revoke_intent: accounts[0] = intentPda, accounts[1] = user
 */
function findTokenByPda(intentPda: string): TokenEntry | undefined {
  return tokenRegistry.get(intentPda);
}

function findTokenByWallet(wallet: string): TokenEntry | undefined {
  for (const entry of tokenRegistry.values()) {
    if (entry.wallet === wallet) return entry;
  }
  return undefined;
}

// ─── Express App ────────────────────────────────────────────────────

const app = express();
app.use(express.json());

// Push token registration endpoint
app.post("/register", (req, res) => {
  const { pushToken, wallet, appId, intentPda } = req.body;

  if (!pushToken || !wallet || !appId || !intentPda) {
    res.status(400).json({ error: "Missing required fields: pushToken, wallet, appId, intentPda" });
    return;
  }

  tokenRegistry.set(intentPda, {
    pushToken,
    wallet,
    appId,
    intentPda,
    registeredAt: Date.now(),
  });

  console.log(`[REGISTER] ${wallet.slice(0, 8)}... | pda: ${intentPda.slice(0, 8)}... | token: ${pushToken.slice(0, 30)}...`);
  res.status(200).json({ registered: true });
});

// Unregister endpoint
app.post("/unregister", (req, res) => {
  const { intentPda, wallet } = req.body;

  if (intentPda) {
    tokenRegistry.delete(intentPda);
  } else if (wallet) {
    for (const [pda, entry] of tokenRegistry) {
      if (entry.wallet === wallet) tokenRegistry.delete(pda);
    }
  }

  res.status(200).json({ unregistered: true });
});

// Enhanced webhook endpoint with push notifications
app.post("/webhook", async (req, res) => {
  const events = Array.isArray(req.body) ? req.body : [req.body];

  for (const event of events) {
    const sig = event.signature || "unknown";
    const type = event.type || "unknown";
    const ts = event.timestamp
      ? new Date(event.timestamp * 1000).toISOString()
      : new Date().toISOString();

    // Check if this involves our program
    const instructions = event.instructions || [];
    const ourIxs = instructions.filter(
      (ix: any) => ix.programId === PROGRAM_ID
    );

    if (ourIxs.length > 0) {
      for (const ix of ourIxs) {
        const action = parseInstruction(ix.data || "");
        const accounts = (ix.accounts || []).slice(0, 3);

        console.log(
          `[${ts}] ${action} | sig: ${sig.slice(0, 20)}... | accounts: ${accounts.join(", ").slice(0, 60)}`
        );

        // Alert on critical events
        if (
          ["pause_protocol", "transfer_admin", "update_config"].includes(action)
        ) {
          console.log(`  *** ALERT: Admin action detected: ${action} ***`);
        }

        // Send push notifications for intent lifecycle events
        if (action === "verify_intent") {
          const intentPda = accounts[0];
          const entry = intentPda ? findTokenByPda(intentPda) : undefined;
          if (entry) {
            await sendPushNotification({
              to: entry.pushToken,
              title: "Intent Verified",
              body: "Your intent was verified on-chain. Transaction completed successfully.",
              data: { action: "verify_intent", sig, appId: entry.appId },
              sound: "default",
              channelId: "intent-updates",
            });
            tokenRegistry.delete(intentPda);
          }
        }

        if (action === "revoke_intent") {
          const intentPda = accounts[0];
          const entry = intentPda ? findTokenByPda(intentPda) : undefined;
          if (entry) {
            await sendPushNotification({
              to: entry.pushToken,
              title: "Intent Revoked",
              body: "Your pending intent was revoked. Rent has been refunded.",
              data: { action: "revoke_intent", sig, appId: entry.appId },
              sound: "default",
              channelId: "intent-updates",
            });
            tokenRegistry.delete(intentPda);
          }
        }
      }
    } else {
      // Might be an account-level event (config change, etc)
      console.log(`[${ts}] ${type} | sig: ${sig.slice(0, 20)}...`);
    }
  }

  res.status(200).json({ received: true });
});

// Raw webhook endpoint (lower latency)
app.post("/webhook/raw", (req, res) => {
  const events = Array.isArray(req.body) ? req.body : [req.body];

  for (const event of events) {
    const sig = event.transaction?.signatures?.[0] || "unknown";
    console.log(`[RAW] ${new Date().toISOString()} | sig: ${sig.slice(0, 30)}...`);
  }

  res.status(200).json({ received: true });
});

// Health check
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    program: PROGRAM_ID,
    uptime: process.uptime(),
    registeredTokens: tokenRegistry.size,
  });
});

// Debug: list registered tokens (dev only)
app.get("/debug/tokens", (_req, res) => {
  const entries = Array.from(tokenRegistry.values()).map((e) => ({
    wallet: `${e.wallet.slice(0, 8)}...`,
    appId: `${e.appId.slice(0, 8)}...`,
    intentPda: `${e.intentPda.slice(0, 8)}...`,
    age: `${Math.round((Date.now() - e.registeredAt) / 1000)}s`,
  }));
  res.json({ count: entries.length, entries });
});

app.listen(PORT, () => {
  console.log("\n=== IntentGuard Webhook + Push Notification Server ===");
  console.log(`Listening on http://localhost:${PORT}`);
  console.log(`Endpoints:`);
  console.log(`  POST /webhook        — Enhanced events + push notifications`);
  console.log(`  POST /webhook/raw    — Raw events (low latency)`);
  console.log(`  POST /register       — Register push token for intent`);
  console.log(`  POST /unregister     — Remove push token`);
  console.log(`  GET  /health         — Health check`);
  console.log(`  GET  /debug/tokens   — List registered tokens (dev)`);
  console.log(`\nMonitoring program: ${PROGRAM_ID}`);
  console.log(`\nFor local dev, expose with: ngrok http ${PORT}\n`);
});
