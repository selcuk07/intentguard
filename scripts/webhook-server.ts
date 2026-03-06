/**
 * IntentGuard — Webhook Event Receiver
 *
 * Simple Express server that receives Helius webhook events
 * and logs IntentGuard program activity.
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

const app = express();
app.use(express.json());

// Enhanced webhook endpoint
app.post("/webhook", (req, res) => {
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
  res.json({ status: "ok", program: PROGRAM_ID, uptime: process.uptime() });
});

app.listen(PORT, () => {
  console.log("\n=== IntentGuard Webhook Server ===");
  console.log(`Listening on http://localhost:${PORT}`);
  console.log(`Endpoints:`);
  console.log(`  POST /webhook      — Enhanced events`);
  console.log(`  POST /webhook/raw  — Raw events (low latency)`);
  console.log(`  GET  /health       — Health check`);
  console.log(`\nMonitoring program: ${PROGRAM_ID}`);
  console.log(`\nFor local dev, expose with: ngrok http ${PORT}\n`);
});
