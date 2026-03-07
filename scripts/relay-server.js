/**
 * IntentGuard WebSocket Relay Server
 * Routes messages between extension and mobile app via channels.
 *
 * Usage: node relay-server.js [port]
 * Default port: 3201
 */

const http = require("http");
const { WebSocketServer } = require("ws");

const PORT = parseInt(process.env.PORT || process.argv[2] || "3201", 10);

// ─── Rate Limiting ──────────────────────────────────────────────────
const MAX_CONNECTIONS_PER_IP = 10;  // max concurrent WS connections per IP
const MAX_MESSAGES_PER_MIN = 60;    // max messages per connection per minute
const MAX_CHANNELS = 500;           // max total active channels

const ipConnections = new Map(); // ip -> count

function getClientIp(req) {
  return req.headers["x-real-ip"] || req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket.remoteAddress;
}

// Map<channelId, Map<role, WebSocket>>
const channels = new Map();

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, channels: channels.size }));
    return;
  }
  res.writeHead(404);
  res.end("Not found");
});

const wss = new WebSocketServer({ server });

wss.on("connection", (ws, req) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const channel = url.searchParams.get("channel");
  const role = url.searchParams.get("role"); // "extension" or "mobile"
  const ip = getClientIp(req);

  if (!channel || !role || !["extension", "mobile"].includes(role)) {
    ws.close(4000, "Missing channel or role param");
    return;
  }

  // Rate limit: max connections per IP
  const currentConns = ipConnections.get(ip) || 0;
  if (currentConns >= MAX_CONNECTIONS_PER_IP) {
    ws.close(4008, "Too many connections");
    return;
  }
  ipConnections.set(ip, currentConns + 1);

  // Rate limit: max total channels
  if (!channels.has(channel) && channels.size >= MAX_CHANNELS) {
    ws.close(4009, "Server at capacity");
    ipConnections.set(ip, (ipConnections.get(ip) || 1) - 1);
    return;
  }

  // Register in channel
  if (!channels.has(channel)) {
    channels.set(channel, new Map());
  }
  const room = channels.get(channel);

  // Close existing connection for this role in the channel
  const existing = room.get(role);
  if (existing && existing.readyState <= 1) {
    existing.close(4001, "Replaced by new connection");
  }
  room.set(role, ws);

  console.log(`[${channel.slice(0, 8)}] ${role} connected (ip: ${ip})`);

  // Per-connection message rate limiting
  let msgCount = 0;
  const msgResetTimer = setInterval(() => { msgCount = 0; }, 60000);

  // Forward messages to the other role
  ws.on("message", (data) => {
    msgCount++;
    if (msgCount > MAX_MESSAGES_PER_MIN) {
      ws.close(4010, "Message rate limit exceeded");
      return;
    }

    const otherRole = role === "extension" ? "mobile" : "extension";
    const peer = room.get(otherRole);
    if (peer && peer.readyState === 1) {
      peer.send(data.toString());
    }
  });

  ws.on("close", () => {
    clearInterval(msgResetTimer);

    // Decrement IP connection count
    const count = ipConnections.get(ip) || 1;
    if (count <= 1) ipConnections.delete(ip);
    else ipConnections.set(ip, count - 1);

    // Only remove if this is still the registered ws
    if (room.get(role) === ws) {
      room.delete(role);
    }
    // Clean up empty channels
    if (room.size === 0) {
      channels.delete(channel);
    }
    console.log(`[${channel.slice(0, 8)}] ${role} disconnected`);
  });

  ws.on("error", () => {
    // Handled by close event
  });
});

// Cleanup stale channels every 5 minutes
setInterval(() => {
  for (const [channelId, room] of channels) {
    let hasAlive = false;
    for (const [, ws] of room) {
      if (ws.readyState <= 1) { hasAlive = true; break; }
    }
    if (!hasAlive) channels.delete(channelId);
  }
}, 300000);

server.listen(PORT, () => {
  console.log(`IntentGuard Relay Server running on port ${PORT}`);
});
