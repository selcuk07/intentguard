/**
 * IntentGuard — Helius Webhook Monitoring Setup
 *
 * Creates webhooks to monitor IntentGuard program events on Solana:
 * - commit_intent events
 * - verify_intent events
 * - Admin actions (pause, unpause, transfer_admin, update_config)
 *
 * Prerequisites:
 *   1. Create a free account at https://www.helius.dev
 *   2. Get your API key from the dashboard
 *   3. Set HELIUS_API_KEY env variable
 *
 * Usage:
 *   HELIUS_API_KEY=your-key npx tsx scripts/setup-helius-webhook.ts --webhook-url https://your-server.com/webhook
 *   HELIUS_API_KEY=your-key npx tsx scripts/setup-helius-webhook.ts --discord https://discord.com/api/webhooks/...
 *   HELIUS_API_KEY=your-key npx tsx scripts/setup-helius-webhook.ts --list
 *   HELIUS_API_KEY=your-key npx tsx scripts/setup-helius-webhook.ts --delete <webhook-id>
 */

const PROGRAM_ID = "4etWfDJNHhjYdv7fuGe236GDPguwUXVk9WhbEpQsPix7";
const CONFIG_PDA = "6atm7ijvFwoRnDsJKz6yaYbKBMBuqvTXqHTtbNUieKCj";

// Squads multisig vault (devnet) — monitor admin actions
const MULTISIG_VAULT = "HXHDwq98S8a1kvMPDJuuJ8J1MaoXYVCjBLNp6wBV6yv1";

const HELIUS_API = "https://api.helius.xyz/v0";

interface WebhookRequest {
  webhookURL: string;
  transactionTypes: string[];
  accountAddresses: string[];
  webhookType: "enhanced" | "raw" | "discord";
}

interface WebhookResponse {
  webhookID: string;
  wallet: string;
  webhookURL: string;
  transactionTypes: string[];
  accountAddresses: string[];
  webhookType: string;
}

async function createWebhook(
  apiKey: string,
  config: WebhookRequest
): Promise<WebhookResponse> {
  const res = await fetch(`${HELIUS_API}/webhooks?api-key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Helius API error ${res.status}: ${text}`);
  }
  return res.json();
}

async function listWebhooks(apiKey: string): Promise<WebhookResponse[]> {
  const res = await fetch(`${HELIUS_API}/webhooks?api-key=${apiKey}`);
  if (!res.ok) throw new Error(`Helius API error ${res.status}`);
  return res.json();
}

async function deleteWebhook(apiKey: string, id: string): Promise<void> {
  const res = await fetch(`${HELIUS_API}/webhooks/${id}?api-key=${apiKey}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(`Helius API error ${res.status}`);
}

async function main() {
  const apiKey = process.env.HELIUS_API_KEY;
  if (!apiKey) {
    console.log("\nError: HELIUS_API_KEY environment variable is required.");
    console.log("\n1. Sign up at https://www.helius.dev (free tier: 1M credits/mo)");
    console.log("2. Copy your API key from the dashboard");
    console.log("3. Run: HELIUS_API_KEY=your-key npx tsx scripts/setup-helius-webhook.ts --help\n");
    process.exit(1);
  }

  const args = process.argv.slice(2);

  // ─── List webhooks ─────────────────────────────────────────
  if (args.includes("--list")) {
    const hooks = await listWebhooks(apiKey);
    if (hooks.length === 0) {
      console.log("\nNo webhooks found.\n");
      return;
    }
    console.log(`\nFound ${hooks.length} webhook(s):\n`);
    for (const h of hooks) {
      console.log(`  ID:      ${h.webhookID}`);
      console.log(`  URL:     ${h.webhookURL}`);
      console.log(`  Type:    ${h.webhookType}`);
      console.log(`  Addrs:   ${h.accountAddresses.length} addresses`);
      console.log(`  Events:  ${h.transactionTypes.join(", ")}`);
      console.log("");
    }
    return;
  }

  // ─── Delete webhook ────────────────────────────────────────
  const deleteIdx = args.indexOf("--delete");
  if (deleteIdx !== -1) {
    const id = args[deleteIdx + 1];
    if (!id) {
      console.log("Usage: --delete <webhook-id>");
      process.exit(1);
    }
    await deleteWebhook(apiKey, id);
    console.log(`Webhook ${id} deleted.`);
    return;
  }

  // ─── Create webhooks ──────────────────────────────────────
  const webhookUrlIdx = args.indexOf("--webhook-url");
  const discordIdx = args.indexOf("--discord");

  if (webhookUrlIdx === -1 && discordIdx === -1) {
    console.log("\nIntentGuard — Helius Webhook Monitoring\n");
    console.log("Usage:");
    console.log("  --webhook-url <url>  Create enhanced webhook (sends JSON to your server)");
    console.log("  --discord <url>      Create Discord webhook (sends formatted messages)");
    console.log("  --list               List all webhooks");
    console.log("  --delete <id>        Delete a webhook\n");
    console.log("Examples:");
    console.log("  npx tsx scripts/setup-helius-webhook.ts --webhook-url https://myserver.com/webhook");
    console.log("  npx tsx scripts/setup-helius-webhook.ts --discord https://discord.com/api/webhooks/123/abc\n");
    process.exit(0);
  }

  const isDiscord = discordIdx !== -1;
  const targetUrl = isDiscord ? args[discordIdx + 1] : args[webhookUrlIdx + 1];

  if (!targetUrl) {
    console.log("Error: URL is required after --webhook-url or --discord");
    process.exit(1);
  }

  const monitoredAddresses = [PROGRAM_ID, CONFIG_PDA, MULTISIG_VAULT];

  console.log("\n=== IntentGuard Helius Webhook Setup ===\n");
  console.log("Type:      ", isDiscord ? "Discord" : "Enhanced");
  console.log("URL:       ", targetUrl);
  console.log("Monitoring:");
  console.log("  Program: ", PROGRAM_ID);
  console.log("  Config:  ", CONFIG_PDA);
  console.log("  Vault:   ", MULTISIG_VAULT);

  // Webhook 1: All program transactions (enhanced)
  console.log("\n[1/2] Creating program activity webhook...");
  const hook1 = await createWebhook(apiKey, {
    webhookURL: targetUrl,
    webhookType: isDiscord ? "discord" : "enhanced",
    accountAddresses: monitoredAddresses,
    transactionTypes: ["Any"],
  });
  console.log("  Created! ID:", hook1.webhookID);

  // Webhook 2: Raw webhook for lower latency alerting
  if (!isDiscord) {
    console.log("\n[2/2] Creating raw low-latency webhook...");
    const hook2 = await createWebhook(apiKey, {
      webhookURL: targetUrl.replace("/webhook", "/webhook/raw"),
      webhookType: "raw",
      accountAddresses: [PROGRAM_ID],
      transactionTypes: ["Any"],
    });
    console.log("  Created! ID:", hook2.webhookID);
  }

  console.log("\n" + "=".repeat(50));
  console.log("  Webhooks active! Events you'll receive:");
  console.log("  - commit_intent (new intent committed)");
  console.log("  - verify_intent (intent verified)");
  console.log("  - revoke_intent (intent revoked)");
  console.log("  - pause/unpause (admin actions)");
  console.log("  - transfer_admin (authority changes)");
  console.log("  - Program upgrades (via multisig)");
  console.log("=".repeat(50));
  console.log("\n  Manage at: https://app.helius.dev/webhooks\n");
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
