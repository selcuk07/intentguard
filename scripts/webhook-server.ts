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
import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { parse as parseUrl } from "url";

const PORT = process.env.PORT || 3000;
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const PROGRAM_ID = "4etWfDJNHhjYdv7fuGe236GDPguwUXVk9WhbEpQsPix7";
const MAX_FIELD_LENGTH = 256;
const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

// Alert channels for admin action notifications
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "";
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || "";

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

// ─── Admin Alert Channels ───────────────────────────────────────────

async function sendAdminAlert(action: string, details: string): Promise<void> {
  // Telegram
  if (TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) {
    const text = `🚨 *IntentGuard ALERT*\n\n*${action}*\n\`\`\`\n${details}\n\`\`\``;
    try {
      await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: TELEGRAM_CHAT_ID,
          text,
          parse_mode: "Markdown",
        }),
      });
    } catch (err) {
      console.error(`  Telegram alert failed: ${(err as Error).message}`);
    }
  }

  // Discord
  if (DISCORD_WEBHOOK_URL) {
    try {
      await fetch(DISCORD_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          embeds: [{
            title: `IntentGuard ALERT: ${action}`,
            description: `\`\`\`\n${details}\n\`\`\``,
            color: 0xff0000,
            timestamp: new Date().toISOString(),
          }],
        }),
      });
    } catch (err) {
      console.error(`  Discord alert failed: ${(err as Error).message}`);
    }
  }
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
app.use(express.json({ limit: "1mb" }));

// Push token registration endpoint
app.post("/register", (req, res) => {
  const { pushToken, wallet, appId, intentPda } = req.body;

  if (!pushToken || !wallet || !appId || !intentPda) {
    res.status(400).json({ error: "Missing required fields: pushToken, wallet, appId, intentPda" });
    return;
  }

  // Validate field types and lengths to prevent injection/abuse
  if (typeof pushToken !== "string" || typeof wallet !== "string" ||
      typeof appId !== "string" || typeof intentPda !== "string") {
    res.status(400).json({ error: "All fields must be strings" });
    return;
  }
  if (pushToken.length > MAX_FIELD_LENGTH || wallet.length > MAX_FIELD_LENGTH ||
      appId.length > MAX_FIELD_LENGTH || intentPda.length > MAX_FIELD_LENGTH) {
    res.status(400).json({ error: "Field too long" });
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

        // Alert on critical admin events via Telegram/Discord
        if (
          ["pause_protocol", "transfer_admin", "update_config", "unpause_protocol", "migrate_config"].includes(action)
        ) {
          console.log(`  *** ALERT: Admin action detected: ${action} ***`);
          const alertMsg = `Admin action: ${action}\nSig: ${sig}\nAccounts: ${accounts.join(", ")}`;
          sendAdminAlert(action, alertMsg);
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

// Debug: list registered tokens (dev only — disabled in production)
app.get("/debug/tokens", (_req, res) => {
  if (IS_PRODUCTION) { res.status(404).json({ error: "Not found" }); return; }
  const entries = Array.from(tokenRegistry.values()).map((e) => ({
    wallet: `${e.wallet.slice(0, 8)}...`,
    appId: `${e.appId.slice(0, 8)}...`,
    intentPda: `${e.intentPda.slice(0, 8)}...`,
    age: `${Math.round((Date.now() - e.registeredAt) / 1000)}s`,
  }));
  res.json({ count: entries.length, entries });
});

// ─── WebSocket Relay for Extension ↔ Mobile Pairing ─────────────────

// Channels: channelId -> { extension?: WebSocket, mobile?: WebSocket }
interface RelayChannel {
  extension?: WebSocket;
  mobile?: WebSocket;
  createdAt: number;
}

const relayChannels = new Map<string, RelayChannel>();

// Clean up stale relay channels (older than 24h)
function cleanupStaleChannels() {
  const cutoff = Date.now() - 86400_000;
  for (const [id, channel] of relayChannels) {
    if (channel.createdAt < cutoff) {
      if (channel.extension?.readyState === WebSocket.OPEN) channel.extension.close();
      if (channel.mobile?.readyState === WebSocket.OPEN) channel.mobile.close();
      relayChannels.delete(id);
    }
  }
}

setInterval(cleanupStaleChannels, 300_000);

// Debug endpoint for relay channels (dev only — disabled in production)
app.get("/debug/channels", (_req, res) => {
  if (IS_PRODUCTION) { res.status(404).json({ error: "Not found" }); return; }
  const entries = Array.from(relayChannels.entries()).map(([id, ch]) => ({
    channelId: `${id.slice(0, 8)}...`,
    extension: ch.extension?.readyState === WebSocket.OPEN ? "connected" : "disconnected",
    mobile: ch.mobile?.readyState === WebSocket.OPEN ? "connected" : "disconnected",
    age: `${Math.round((Date.now() - ch.createdAt) / 1000)}s`,
  }));
  res.json({ count: entries.length, entries });
});

// ─── HTTP + WebSocket Server ────────────────────────────────────────

const server = createServer(app);

const MAX_WS_PAYLOAD = 256 * 1024; // 256KB max message size
const MAX_CHANNEL_ID_LENGTH = 64;
const CHANNEL_ID_REGEX = /^[a-f0-9]+$/;

const wss = new WebSocketServer({ server, path: "/relay", maxPayload: MAX_WS_PAYLOAD });

wss.on("connection", (ws, req) => {
  const url = parseUrl(req.url || "", true);
  const channelId = url.query.channel as string;
  const role = url.query.role as string;

  if (!channelId || !role || !["extension", "mobile"].includes(role)) {
    ws.close(4000, "Missing channel or role parameter");
    return;
  }

  // Validate channelId format and length
  if (channelId.length > MAX_CHANNEL_ID_LENGTH || !CHANNEL_ID_REGEX.test(channelId)) {
    ws.close(4002, "Invalid channel ID format");
    return;
  }

  // Get or create channel
  if (!relayChannels.has(channelId)) {
    relayChannels.set(channelId, { createdAt: Date.now() });
  }
  const channel = relayChannels.get(channelId)!;

  // Register this connection
  if (role === "extension") {
    if (channel.extension?.readyState === WebSocket.OPEN) {
      channel.extension.close(4001, "Replaced by new connection");
    }
    channel.extension = ws;
  } else {
    if (channel.mobile?.readyState === WebSocket.OPEN) {
      channel.mobile.close(4001, "Replaced by new connection");
    }
    channel.mobile = ws;
  }

  console.log(`[RELAY] ${role} connected to channel ${channelId.slice(0, 8)}...`);

  // Relay messages to the other side
  ws.on("message", (data) => {
    const peer = role === "extension" ? channel.mobile : channel.extension;
    if (peer && peer.readyState === WebSocket.OPEN) {
      peer.send(data.toString());
    }
  });

  ws.on("close", () => {
    console.log(`[RELAY] ${role} disconnected from channel ${channelId.slice(0, 8)}...`);
    if (role === "extension" && channel.extension === ws) {
      channel.extension = undefined;
    }
    if (role === "mobile" && channel.mobile === ws) {
      channel.mobile = undefined;
    }
    // Clean up empty channels
    if (!channel.extension && !channel.mobile) {
      relayChannels.delete(channelId);
    }
  });
});

server.listen(PORT, () => {
  console.log("\n=== IntentGuard Webhook + Push + Relay Server ===");
  console.log(`Listening on http://localhost:${PORT}`);
  console.log(`Endpoints:`);
  console.log(`  POST /webhook        — Enhanced events + push notifications`);
  console.log(`  POST /webhook/raw    — Raw events (low latency)`);
  console.log(`  POST /register       — Register push token for intent`);
  console.log(`  POST /unregister     — Remove push token`);
  console.log(`  WS   /relay          — Extension <-> Mobile encrypted relay`);
  console.log(`  GET  /health         — Health check`);
  console.log(`  GET  /debug/tokens   — List registered tokens (dev)`);
  console.log(`  GET  /debug/channels — List active relay channels (dev)`);
  console.log(`\nMonitoring program: ${PROGRAM_ID}`);
  console.log(`\nFor local dev, expose with: ngrok http ${PORT}\n`);
});
