import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import { createServer, Server } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { parse as parseUrl } from 'url';

// Inline a minimal relay server for testing (same logic as webhook-server.ts)
function createRelayServer(): { server: Server; port: number } {
  const app = express();
  const server = createServer(app);

  interface RelayChannel {
    extension?: WebSocket;
    mobile?: WebSocket;
    createdAt: number;
  }

  const relayChannels = new Map<string, RelayChannel>();

  const wss = new WebSocketServer({ server, path: '/relay' });

  wss.on('connection', (ws, req) => {
    const url = parseUrl(req.url || '', true);
    const channelId = url.query.channel as string;
    const role = url.query.role as string;

    if (!channelId || !role || !['extension', 'mobile'].includes(role)) {
      ws.close(4000, 'Missing channel or role parameter');
      return;
    }

    if (!relayChannels.has(channelId)) {
      relayChannels.set(channelId, { createdAt: Date.now() });
    }
    const channel = relayChannels.get(channelId)!;

    if (role === 'extension') {
      channel.extension = ws;
    } else {
      channel.mobile = ws;
    }

    ws.on('message', (data) => {
      const peer = role === 'extension' ? channel.mobile : channel.extension;
      if (peer && peer.readyState === WebSocket.OPEN) {
        peer.send(data.toString());
      }
    });

    ws.on('close', () => {
      if (role === 'extension' && channel.extension === ws) channel.extension = undefined;
      if (role === 'mobile' && channel.mobile === ws) channel.mobile = undefined;
      if (!channel.extension && !channel.mobile) relayChannels.delete(channelId);
    });
  });

  return { server, port: 0 };
}

function connectWs(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

function waitForMessage(ws: WebSocket): Promise<string> {
  return new Promise((resolve) => {
    ws.once('message', (data) => resolve(data.toString()));
  });
}

describe('Webhook Server — WebSocket Relay', () => {
  let server: Server;
  let port: number;

  beforeAll(
    () =>
      new Promise<void>((resolve) => {
        const relay = createRelayServer();
        server = relay.server;
        server.listen(0, () => {
          port = (server.address() as any).port;
          resolve();
        });
      }),
  );

  afterAll(
    () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  );

  it('relays messages from extension to mobile', async () => {
    const channel = 'test-channel-1';
    const ext = await connectWs(`ws://localhost:${port}/relay?channel=${channel}&role=extension`);
    const mobile = await connectWs(`ws://localhost:${port}/relay?channel=${channel}&role=mobile`);

    const msgPromise = waitForMessage(mobile);
    ext.send(JSON.stringify({ type: 'pair_request', data: 'hello' }));

    const received = await msgPromise;
    const parsed = JSON.parse(received);
    expect(parsed.type).toBe('pair_request');
    expect(parsed.data).toBe('hello');

    ext.close();
    mobile.close();
  });

  it('relays messages from mobile to extension', async () => {
    const channel = 'test-channel-2';
    const ext = await connectWs(`ws://localhost:${port}/relay?channel=${channel}&role=extension`);
    const mobile = await connectWs(`ws://localhost:${port}/relay?channel=${channel}&role=mobile`);

    const msgPromise = waitForMessage(ext);
    mobile.send(JSON.stringify({ type: 'pair_response', publicKey: 'abc123' }));

    const received = await msgPromise;
    const parsed = JSON.parse(received);
    expect(parsed.type).toBe('pair_response');
    expect(parsed.publicKey).toBe('abc123');

    ext.close();
    mobile.close();
  });

  it('does not cross channels', async () => {
    const ext1 = await connectWs(`ws://localhost:${port}/relay?channel=ch-a&role=extension`);
    const mobile1 = await connectWs(`ws://localhost:${port}/relay?channel=ch-a&role=mobile`);
    const ext2 = await connectWs(`ws://localhost:${port}/relay?channel=ch-b&role=extension`);
    const mobile2 = await connectWs(`ws://localhost:${port}/relay?channel=ch-b&role=mobile`);

    const msg1Promise = waitForMessage(mobile1);

    // Only channel ch-a extension sends
    ext1.send(JSON.stringify({ target: 'ch-a' }));

    const received = await msg1Promise;
    expect(JSON.parse(received).target).toBe('ch-a');

    // mobile2 should NOT receive anything
    let mobile2Received = false;
    mobile2.once('message', () => {
      mobile2Received = true;
    });
    await new Promise((r) => setTimeout(r, 300));
    expect(mobile2Received).toBe(false);

    ext1.close();
    mobile1.close();
    ext2.close();
    mobile2.close();
  });

  it('rejects connections without channel param', async () => {
    const ws = new WebSocket(`ws://localhost:${port}/relay?role=extension`);
    const closePromise = new Promise<number>((resolve) => {
      ws.on('close', (code) => resolve(code));
    });
    const code = await closePromise;
    expect(code).toBe(4000);
  });

  it('rejects connections without role param', async () => {
    const ws = new WebSocket(`ws://localhost:${port}/relay?channel=test`);
    const closePromise = new Promise<number>((resolve) => {
      ws.on('close', (code) => resolve(code));
    });
    const code = await closePromise;
    expect(code).toBe(4000);
  });

  it('rejects invalid role', async () => {
    const ws = new WebSocket(`ws://localhost:${port}/relay?channel=test&role=hacker`);
    const closePromise = new Promise<number>((resolve) => {
      ws.on('close', (code) => resolve(code));
    });
    const code = await closePromise;
    expect(code).toBe(4000);
  });

  it('handles extension disconnecting gracefully', async () => {
    const channel = 'disconnect-test';
    const ext = await connectWs(`ws://localhost:${port}/relay?channel=${channel}&role=extension`);
    const mobile = await connectWs(`ws://localhost:${port}/relay?channel=${channel}&role=mobile`);

    ext.close();
    await new Promise((r) => setTimeout(r, 100));

    // Mobile sending after extension disconnect should not crash
    mobile.send(JSON.stringify({ type: 'test' }));
    await new Promise((r) => setTimeout(r, 100));

    // Reconnecting extension should work
    const ext2 = await connectWs(`ws://localhost:${port}/relay?channel=${channel}&role=extension`);
    const msgPromise = waitForMessage(ext2);
    mobile.send(JSON.stringify({ type: 'reconnected' }));

    const received = await msgPromise;
    expect(JSON.parse(received).type).toBe('reconnected');

    ext2.close();
    mobile.close();
  });
});
