/**
 * IntentGuard — Mainnet On-Chain Monitor
 *
 * Polls the GuardConfig PDA and detects state changes in real-time.
 * Sends alerts via Telegram and/or Discord when critical events occur.
 *
 * Usage:
 *   npx tsx scripts/monitor.ts
 *
 * Environment variables:
 *   RPC_URL              Solana RPC endpoint (default: mainnet-beta)
 *   POLL_INTERVAL_MS     Poll interval in ms (default: 10000 = 10s)
 *   TELEGRAM_BOT_TOKEN   Telegram bot token (optional)
 *   TELEGRAM_CHAT_ID     Telegram chat/group ID (optional)
 *   DISCORD_WEBHOOK_URL  Discord webhook URL (optional)
 *   ALERT_LOG_FILE       Path to write alert log (default: ./monitor-alerts.log)
 */

import { Connection, PublicKey } from "@solana/web3.js";
import * as fs from "fs";

// ─── Config ───────────────────────────────────────────────────

const PROGRAM_ID = new PublicKey("4etWfDJNHhjYdv7fuGe236GDPguwUXVk9WhbEpQsPix7");
const RPC_URL = process.env.RPC_URL || "https://api.mainnet-beta.solana.com";
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL_MS || "10000", 10);
const ALERT_LOG_FILE = process.env.ALERT_LOG_FILE || "./monitor-alerts.log";

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "";
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || "";

// GuardConfig layout (66 bytes):
//   [0..8]   discriminator
//   [8..40]  admin (Pubkey)
//   [40]     is_paused (bool)
//   [41..49] total_commits (u64 LE)
//   [49..57] total_verifies (u64 LE)
//   [57]     bump (u8)
//   [58..66] min_balance (u64 LE)

const [CONFIG_PDA] = PublicKey.findProgramAddressSync(
  [Buffer.from("config")],
  PROGRAM_ID,
);

// ─── Types ────────────────────────────────────────────────────

interface ConfigState {
  admin: string;
  isPaused: boolean;
  totalCommits: bigint;
  totalVerifies: bigint;
  minBalance: bigint;
  fetchedAt: number;
}

type Severity = "CRITICAL" | "WARNING" | "INFO";

interface Alert {
  severity: Severity;
  title: string;
  details: string;
  timestamp: string;
}

// ─── Config Decoder ───────────────────────────────────────────

function decodeConfig(data: Buffer): ConfigState {
  const admin = new PublicKey(data.subarray(8, 40)).toBase58();
  const isPaused = data[40] !== 0;
  const view = new DataView(data.buffer, data.byteOffset, data.length);
  const totalCommits = view.getBigUint64(41, true);
  const totalVerifies = view.getBigUint64(49, true);
  const minBalance = data.length >= 66
    ? view.getBigUint64(58, true)
    : 0n;
  return { admin, isPaused, totalCommits, totalVerifies, minBalance, fetchedAt: Date.now() };
}

// ─── Alert Channels ──────────────────────────────────────────

async function sendTelegram(alert: Alert): Promise<void> {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;

  const icon = alert.severity === "CRITICAL" ? "🚨" : alert.severity === "WARNING" ? "⚠️" : "ℹ️";
  const text = `${icon} *IntentGuard ${alert.severity}*\n\n*${alert.title}*\n${alert.details}\n\n_${alert.timestamp}_`;

  try {
    const res = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: TELEGRAM_CHAT_ID,
          text,
          parse_mode: "Markdown",
          disable_web_page_preview: true,
        }),
      },
    );
    if (!res.ok) {
      const err = await res.text();
      console.error(`  Telegram send failed: ${res.status} ${err}`);
    }
  } catch (err) {
    console.error(`  Telegram error: ${(err as Error).message}`);
  }
}

async function sendDiscord(alert: Alert): Promise<void> {
  if (!DISCORD_WEBHOOK_URL) return;

  const color = alert.severity === "CRITICAL" ? 0xff0000
    : alert.severity === "WARNING" ? 0xffaa00
    : 0x00aaff;

  try {
    const res = await fetch(DISCORD_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        embeds: [{
          title: `IntentGuard ${alert.severity}: ${alert.title}`,
          description: alert.details,
          color,
          timestamp: new Date().toISOString(),
          footer: { text: "IntentGuard Monitor" },
        }],
      }),
    });
    if (!res.ok) {
      console.error(`  Discord send failed: ${res.status}`);
    }
  } catch (err) {
    console.error(`  Discord error: ${(err as Error).message}`);
  }
}

function logToFile(alert: Alert): void {
  const line = `[${alert.timestamp}] [${alert.severity}] ${alert.title} — ${alert.details}\n`;
  try {
    fs.appendFileSync(ALERT_LOG_FILE, line);
  } catch {
    // Ignore file write errors
  }
}

async function sendAlert(severity: Severity, title: string, details: string): Promise<void> {
  const alert: Alert = {
    severity,
    title,
    details,
    timestamp: new Date().toISOString(),
  };

  // Always log to console and file
  const prefix = severity === "CRITICAL" ? "!!!" : severity === "WARNING" ? "!!" : "--";
  console.log(`\n  ${prefix} [${severity}] ${title}`);
  console.log(`      ${details}`);
  logToFile(alert);

  // Send to external channels
  await Promise.allSettled([
    sendTelegram(alert),
    sendDiscord(alert),
  ]);
}

// ─── State Comparison ────────────────────────────────────────

async function checkStateChanges(
  prev: ConfigState,
  curr: ConfigState,
): Promise<void> {
  // Admin changed
  if (prev.admin !== curr.admin) {
    await sendAlert(
      "CRITICAL",
      "Admin Transfer Detected",
      `Admin changed from ${prev.admin} to ${curr.admin}`,
    );
  }

  // Pause state changed
  if (prev.isPaused !== curr.isPaused) {
    await sendAlert(
      "CRITICAL",
      curr.isPaused ? "Protocol PAUSED" : "Protocol UNPAUSED",
      `Paused state changed: ${prev.isPaused} -> ${curr.isPaused}`,
    );
  }

  // Min balance changed
  if (prev.minBalance !== curr.minBalance) {
    await sendAlert(
      "WARNING",
      "Min Balance Updated",
      `min_balance changed: ${prev.minBalance} -> ${curr.minBalance} lamports`,
    );
  }

  // Commit rate spike (>100 commits in one poll interval)
  const newCommits = curr.totalCommits - prev.totalCommits;
  if (newCommits > 100n) {
    await sendAlert(
      "WARNING",
      "High Commit Rate",
      `${newCommits} new commits in ${POLL_INTERVAL / 1000}s (total: ${curr.totalCommits})`,
    );
  }

  // Verify rate spike
  const newVerifies = curr.totalVerifies - prev.totalVerifies;
  if (newVerifies > 100n) {
    await sendAlert(
      "WARNING",
      "High Verify Rate",
      `${newVerifies} new verifies in ${POLL_INTERVAL / 1000}s (total: ${curr.totalVerifies})`,
    );
  }

  // Counter went backwards (should never happen — indicates data corruption)
  if (curr.totalCommits < prev.totalCommits || curr.totalVerifies < prev.totalVerifies) {
    await sendAlert(
      "CRITICAL",
      "Counter Regression Detected",
      `Commits: ${prev.totalCommits} -> ${curr.totalCommits}, Verifies: ${prev.totalVerifies} -> ${curr.totalVerifies}. Possible data corruption or program upgrade.`,
    );
  }
}

// ─── RPC Health ──────────────────────────────────────────────

let consecutiveRpcFailures = 0;
const MAX_RPC_FAILURES_BEFORE_ALERT = 3;
let rpcAlertSent = false;

async function fetchConfig(connection: Connection): Promise<ConfigState | null> {
  try {
    const info = await connection.getAccountInfo(CONFIG_PDA);
    if (!info || !info.data) {
      if (consecutiveRpcFailures === 0) {
        await sendAlert("CRITICAL", "Config PDA Not Found", `Account ${CONFIG_PDA.toBase58()} returned null. Program may not be initialized.`);
      }
      return null;
    }
    if (info.owner.toBase58() !== PROGRAM_ID.toBase58()) {
      await sendAlert("CRITICAL", "Config PDA Wrong Owner", `Expected owner ${PROGRAM_ID.toBase58()}, got ${info.owner.toBase58()}`);
      return null;
    }
    consecutiveRpcFailures = 0;
    if (rpcAlertSent) {
      await sendAlert("INFO", "RPC Connection Restored", `Connection to ${RPC_URL} restored after ${consecutiveRpcFailures} failures.`);
      rpcAlertSent = false;
    }
    return decodeConfig(Buffer.from(info.data));
  } catch (err) {
    consecutiveRpcFailures++;
    if (consecutiveRpcFailures >= MAX_RPC_FAILURES_BEFORE_ALERT && !rpcAlertSent) {
      await sendAlert("CRITICAL", "RPC Connection Lost", `Failed to reach ${RPC_URL} for ${consecutiveRpcFailures} consecutive polls. Error: ${(err as Error).message}`);
      rpcAlertSent = true;
    }
    console.error(`  RPC error (${consecutiveRpcFailures}x): ${(err as Error).message}`);
    return null;
  }
}

// ─── Main Loop ───────────────────────────────────────────────

async function main() {
  const connection = new Connection(RPC_URL, "confirmed");

  console.log("\n=== IntentGuard Mainnet Monitor ===");
  console.log(`  Program:    ${PROGRAM_ID.toBase58()}`);
  console.log(`  Config PDA: ${CONFIG_PDA.toBase58()}`);
  console.log(`  RPC:        ${RPC_URL}`);
  console.log(`  Interval:   ${POLL_INTERVAL / 1000}s`);
  console.log(`  Telegram:   ${TELEGRAM_BOT_TOKEN ? "configured" : "not configured"}`);
  console.log(`  Discord:    ${DISCORD_WEBHOOK_URL ? "configured" : "not configured"}`);
  console.log(`  Log file:   ${ALERT_LOG_FILE}`);
  console.log();

  // Initial fetch
  let prevState = await fetchConfig(connection);
  if (!prevState) {
    console.error("Failed to fetch initial config. Will keep retrying...\n");
  } else {
    console.log("  Initial state:");
    console.log(`    Admin:         ${prevState.admin}`);
    console.log(`    Paused:        ${prevState.isPaused}`);
    console.log(`    Total commits: ${prevState.totalCommits}`);
    console.log(`    Total verifies:${prevState.totalVerifies}`);
    console.log(`    Min balance:   ${prevState.minBalance} lamports`);
    console.log();

    await sendAlert("INFO", "Monitor Started", `Watching config PDA ${CONFIG_PDA.toBase58().slice(0, 16)}... on ${RPC_URL.includes("mainnet") ? "mainnet" : "other"}`);
  }

  // Poll loop
  const poll = async () => {
    const currState = await fetchConfig(connection);
    if (!currState) return;

    if (prevState) {
      await checkStateChanges(prevState, currState);
    }
    prevState = currState;
  };

  setInterval(poll, POLL_INTERVAL);

  // Periodic heartbeat (every 6 hours)
  setInterval(async () => {
    if (prevState) {
      await sendAlert(
        "INFO",
        "Monitor Heartbeat",
        `Running. Admin: ${prevState.admin.slice(0, 12)}... | Commits: ${prevState.totalCommits} | Verifies: ${prevState.totalVerifies} | Paused: ${prevState.isPaused}`,
      );
    }
  }, 6 * 3600 * 1000);

  // Handle graceful shutdown
  const shutdown = async () => {
    console.log("\nShutting down monitor...");
    await sendAlert("WARNING", "Monitor Stopped", "IntentGuard monitor process terminated.");
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
