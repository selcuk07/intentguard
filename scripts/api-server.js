const http = require("http");
const { Connection, Keypair, Transaction } = require("@solana/web3.js");
const fs = require("fs");

const PORT = 3200;
const DEVNET_RPC = "https://api.devnet.solana.com";
const MAX_BODY = 8192;

// ─── Rate Limiting ──────────────────────────────────────────────────
// Per-IP sliding window: max RATE_LIMIT requests per RATE_WINDOW_MS
const RATE_LIMIT = 10;          // max relay-commit requests per window
const RATE_WINDOW_MS = 60_000;  // 1 minute
const GLOBAL_LIMIT = 100;       // max total relay-commit requests per window

const ipHits = new Map();  // ip -> [timestamp, ...]
let globalHits = [];

function getClientIp(req) {
  return req.headers["x-real-ip"] || req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket.remoteAddress;
}

function isRateLimited(ip) {
  const now = Date.now();

  // Global rate limit
  globalHits = globalHits.filter((t) => now - t < RATE_WINDOW_MS);
  if (globalHits.length >= GLOBAL_LIMIT) return "global";

  // Per-IP rate limit
  let hits = ipHits.get(ip) || [];
  hits = hits.filter((t) => now - t < RATE_WINDOW_MS);
  ipHits.set(ip, hits);
  if (hits.length >= RATE_LIMIT) return "ip";

  hits.push(now);
  globalHits.push(now);
  return false;
}

// Cleanup stale IP entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, hits] of ipHits) {
    const active = hits.filter((t) => now - t < RATE_WINDOW_MS);
    if (active.length === 0) ipHits.delete(ip);
    else ipHits.set(ip, active);
  }
}, 300_000);

// Load fee payer keypair
const feePayerSecret = JSON.parse(fs.readFileSync(__dirname + "/fee-payer.json"));
const feePayer = Keypair.fromSecretKey(Uint8Array.from(feePayerSecret));
console.log("Fee payer:", feePayer.publicKey.toBase58());

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > MAX_BODY) reject(new Error("Body too large"));
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // Health check
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", service: "intentshield-api", feePayer: feePayer.publicKey.toBase58() }));
    return;
  }

  // Stats
  if (req.url === "/v1/stats") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      program: "4etWfDJNHhjYdv7fuGe236GDPguwUXVk9WhbEpQsPix7",
      network: "devnet",
      version: "0.3.0",
    }));
    return;
  }

  // Fee Relay endpoint: receives user-signed tx, pays fee, submits
  if (req.url === "/v1/relay-commit" && req.method === "POST") {
    const ip = getClientIp(req);
    const limited = isRateLimited(ip);
    if (limited) {
      console.log(`[rate-limit] ${limited} limit hit for ${ip}`);
      res.writeHead(429, { "Content-Type": "application/json", "Retry-After": "60" });
      res.end(JSON.stringify({ error: "Rate limit exceeded. Try again in 1 minute." }));
      return;
    }

    try {
      const body = JSON.parse(await readBody(req));
      const { transaction, network } = body;

      if (!transaction) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Missing transaction" }));
        return;
      }

      const rpc = network === "mainnet-beta" ? "https://api.mainnet-beta.solana.com" : DEVNET_RPC;
      const connection = new Connection(rpc, "confirmed");

      // Deserialize the user-signed transaction (fee payer already set by client)
      const txBuf = Buffer.from(transaction, "base64");
      const tx = Transaction.from(txBuf);

      // Fee payer co-signs (user already partially signed)
      tx.partialSign(feePayer);

      // Submit
      const sig = await connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: false,
        preflightCommitment: "confirmed",
      });
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");

      console.log("[relay] Submitted tx: " + sig + " (network: " + (network || "devnet") + ")");

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ signature: sig }));
    } catch (err) {
      console.error("[relay] Error:", err.message);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
});

server.listen(PORT, "127.0.0.1", () => {
  console.log("IntentShield API listening on 127.0.0.1:" + PORT);
});
