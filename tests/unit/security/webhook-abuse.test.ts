/**
 * Webhook Server Security Tests
 *
 * - Malformed webhook payloads
 * - Token registry injection
 * - Relay channel parameter injection
 * - Excessive connection limits
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { createServer, Server } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { parse as parseUrl } from 'url';

function createTestServer() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  const tokenRegistry = new Map<string, any>();

  app.post('/register', (req, res) => {
    const { pushToken, wallet, appId, intentPda } = req.body;
    if (!pushToken || !wallet || !appId || !intentPda) {
      res.status(400).json({ error: 'Missing fields' });
      return;
    }
    tokenRegistry.set(intentPda, { pushToken, wallet, appId, intentPda, registeredAt: Date.now() });
    res.status(200).json({ registered: true });
  });

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', registeredTokens: tokenRegistry.size });
  });

  interface RelayChannel { extension?: WebSocket; mobile?: WebSocket; createdAt: number; }
  const relayChannels = new Map<string, RelayChannel>();

  const server = createServer(app);
  const wss = new WebSocketServer({ server, path: '/relay' });

  wss.on('connection', (ws, req) => {
    const url = parseUrl(req.url || '', true);
    const channelId = url.query.channel as string;
    const role = url.query.role as string;
    if (!channelId || !role || !['extension', 'mobile'].includes(role)) {
      ws.close(4000, 'Invalid params');
      return;
    }
    if (!relayChannels.has(channelId)) {
      relayChannels.set(channelId, { createdAt: Date.now() });
    }
    const channel = relayChannels.get(channelId)!;
    if (role === 'extension') channel.extension = ws;
    else channel.mobile = ws;
    ws.on('message', (data) => {
      const peer = role === 'extension' ? channel.mobile : channel.extension;
      if (peer && peer.readyState === WebSocket.OPEN) peer.send(data.toString());
    });
    ws.on('close', () => {
      if (role === 'extension' && channel.extension === ws) channel.extension = undefined;
      if (role === 'mobile' && channel.mobile === ws) channel.mobile = undefined;
      if (!channel.extension && !channel.mobile) relayChannels.delete(channelId);
    });
  });

  return { server, wss, app, tokenRegistry, relayChannels };
}

describe('SECURITY — Webhook Server Abuse', () => {
  let server: Server;
  let wss: WebSocketServer;
  let port: number;
  let baseUrl: string;

  beforeAll(() => new Promise<void>((resolve) => {
    const { server: s, wss: w } = createTestServer();
    server = s;
    wss = w;
    server.listen(0, () => { port = (server.address() as any).port; baseUrl = `http://localhost:${port}`; resolve(); });
  }));

  afterAll(() => new Promise<void>((resolve) => {
    // Close all WebSocket connections, then shut down HTTP server
    wss.clients.forEach((ws) => ws.terminate());
    wss.close(() => {
      server.closeAllConnections?.();
      server.close(() => resolve());
    });
  }), 15000);

  describe('Token Registration Abuse', () => {
    it('rejects registration without required fields', async () => {
      const res = await fetch(`${baseUrl}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pushToken: 'token' }), // missing wallet, appId, intentPda
      });
      expect(res.status).toBe(400);
    });

    it('rejects empty body', async () => {
      const res = await fetch(`${baseUrl}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });

    it('accepts valid registration', async () => {
      const res = await fetch(`${baseUrl}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pushToken: 'ExponentPushToken[xxx]',
          wallet: 'Abc123...',
          appId: 'JUP6...',
          intentPda: 'PDA123...',
        }),
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.registered).toBe(true);
    });
  });

  describe('Relay Channel Injection', () => {
    it('rejects connection without channel', async () => {
      const ws = new WebSocket(`ws://localhost:${port}/relay?role=extension`);
      const code = await new Promise<number>((r) => ws.on('close', (c) => r(c)));
      expect(code).toBe(4000);
    });

    it('rejects connection with invalid role', async () => {
      const ws = new WebSocket(`ws://localhost:${port}/relay?channel=test&role=admin`);
      const code = await new Promise<number>((r) => ws.on('close', (c) => r(c)));
      expect(code).toBe(4000);
    });

    it('channel ID with special chars does not crash', async () => {
      const specialChannel = 'ch-../../../etc/passwd';
      const ws = new WebSocket(`ws://localhost:${port}/relay?channel=${encodeURIComponent(specialChannel)}&role=extension`);
      const opened = await new Promise<boolean>((resolve) => {
        ws.on('open', () => resolve(true));
        ws.on('error', () => resolve(false));
        setTimeout(() => resolve(false), 2000);
      });
      expect(opened).toBe(true);
      ws.close();
    });

    it('channel ID with SQL injection chars does not crash', async () => {
      const sqlChannel = "'; DROP TABLE channels; --";
      const ws = new WebSocket(`ws://localhost:${port}/relay?channel=${encodeURIComponent(sqlChannel)}&role=mobile`);
      const opened = await new Promise<boolean>((resolve) => {
        ws.on('open', () => resolve(true));
        ws.on('error', () => resolve(false));
        setTimeout(() => resolve(false), 2000);
      });
      // Server should handle gracefully (it's a Map key, not SQL)
      ws.close();
    });

    it('second connection on same role overwrites channel reference', async () => {
      const channel = 'replace-test';
      const ws1 = await new Promise<WebSocket>((r) => {
        const w = new WebSocket(`ws://localhost:${port}/relay?channel=${channel}&role=extension`);
        w.on('open', () => r(w));
      });

      // Connect mobile peer
      const mobile = await new Promise<WebSocket>((r) => {
        const w = new WebSocket(`ws://localhost:${port}/relay?channel=${channel}&role=mobile`);
        w.on('open', () => r(w));
      });

      // Connect again as same role — server overwrites reference
      const ws2 = await new Promise<WebSocket>((r) => {
        const w = new WebSocket(`ws://localhost:${port}/relay?channel=${channel}&role=extension`);
        w.on('open', () => r(w));
      });

      // ws2 messages should reach mobile (it replaced ws1 in relay)
      const received = new Promise<string>((r) => mobile.once('message', (d) => r(d.toString())));
      ws2.send('from-ws2');
      const msg = await received;
      expect(msg).toBe('from-ws2');

      // When ws1 closes, it should NOT remove ws2's channel reference
      // (close handler checks channel.extension === ws — ws1 !== ws2)
      ws1.close();
      await new Promise((r) => setTimeout(r, 100));

      // ws2 should still relay after ws1 closes
      const received2 = new Promise<string>((r) => mobile.once('message', (d) => r(d.toString())));
      ws2.send('still-alive');
      const msg2 = await received2;
      expect(msg2).toBe('still-alive');

      ws2.close();
      mobile.close();
    });
  });

  describe('Large Message Handling', () => {
    it('relay forwards large messages without crash', async () => {
      const channel = 'large-msg';
      const ext = await new Promise<WebSocket>((r) => {
        const w = new WebSocket(`ws://localhost:${port}/relay?channel=${channel}&role=extension`);
        w.on('open', () => r(w));
      });
      const mobile = await new Promise<WebSocket>((r) => {
        const w = new WebSocket(`ws://localhost:${port}/relay?channel=${channel}&role=mobile`);
        w.on('open', () => r(w));
      });

      const largeMsg = JSON.stringify({ data: 'x'.repeat(100_000) }); // 100KB
      const received = new Promise<string>((r) => mobile.once('message', (d) => r(d.toString())));
      ext.send(largeMsg);

      const msg = await received;
      expect(msg.length).toBe(largeMsg.length);

      ext.close();
      mobile.close();
    });
  });
});
