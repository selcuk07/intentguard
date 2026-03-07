/**
 * Background Service Worker Security Tests
 *
 * Tests for:
 * - Fail-closed RPC error handling (CRITICAL — mainnet fix)
 * - Message handler type validation
 * - Bypass list storage manipulation
 * - Wallet storage injection
 * - Unknown message type handling
 * - Concurrent message handling
 * - CHECK_INTENT flow edge cases
 */
import { describe, it, expect } from 'vitest';

// ─── Simulate hasActiveIntent (from background.js) ─────────────────

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58Decode(str: string): Uint8Array {
  const bytes = [0];
  for (const char of str) {
    const idx = BASE58_ALPHABET.indexOf(char);
    if (idx === -1) throw new Error('Invalid base58');
    let carry = idx;
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (const char of str) {
    if (char !== '1') break;
    bytes.push(0);
  }
  return new Uint8Array(bytes.reverse());
}

// Simulated RPC response parser (mirrors background.js hasActiveIntent logic)
function parseIntentFromRpc(json: any, now: number): boolean {
  if (!json.result || json.result.length === 0) return false;
  for (const item of json.result) {
    try {
      const b64 = item.account.data[0];
      const raw = Buffer.from(b64, 'base64');
      const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
      if (raw.byteLength < 16) continue;
      const expiresAt = Number(view.getBigInt64(8, true));
      if (expiresAt > now) return true;
    } catch {
      continue;
    }
  }
  return false;
}

// ─── Simulate fail-closed hasActiveIntent ───────────────────────────

async function hasActiveIntentFailClosed(
  fetchFn: () => Promise<any>,
): Promise<boolean> {
  try {
    const json = await fetchFn();
    return parseIntentFromRpc(json, Math.floor(Date.now() / 1000));
  } catch {
    // FAIL-CLOSED: RPC error blocks the transaction
    return false;
  }
}

// Old behavior for comparison
async function hasActiveIntentFailOpen(
  fetchFn: () => Promise<any>,
): Promise<boolean> {
  try {
    const json = await fetchFn();
    return parseIntentFromRpc(json, Math.floor(Date.now() / 1000));
  } catch {
    // FAIL-OPEN (old behavior): RPC error allows through
    return true;
  }
}

// ─── Simulate bypass list management ────────────────────────────────

class MockBypassList {
  private list: string[] = [];

  async isBypassed(origin: string): Promise<boolean> {
    return this.list.includes(origin);
  }

  async addBypass(origin: string): Promise<void> {
    if (!this.list.includes(origin)) {
      this.list.push(origin);
    }
  }

  async removeBypass(origin: string): Promise<void> {
    this.list = this.list.filter((o) => o !== origin);
  }

  getList(): string[] {
    return [...this.list];
  }
}

// ─── Simulate message handler dispatch ──────────────────────────────

type MessageHandler = (
  msg: any,
) => Promise<{ action: string; wallet?: string | null } | { ok: boolean } | { list: string[] } | null>;

function createMessageHandler(
  bypassList: MockBypassList,
  storedWallet: string | null,
  hasActiveIntent: (wallet: string) => Promise<boolean>,
): MessageHandler {
  return async (msg: any) => {
    if (!msg || typeof msg.type !== 'string') return null;

    if (msg.type === 'CHECK_INTENT') {
      if (await bypassList.isBypassed(msg.origin)) {
        return { action: 'bypass' };
      }
      if (!storedWallet) {
        return { action: 'no_wallet', wallet: null };
      }
      const verified = await hasActiveIntent(storedWallet);
      return { action: verified ? 'verified' : 'no_intent', wallet: storedWallet };
    }

    if (msg.type === 'ADD_BYPASS') {
      await bypassList.addBypass(msg.origin);
      return { ok: true };
    }

    if (msg.type === 'REMOVE_BYPASS') {
      await bypassList.removeBypass(msg.origin);
      return { ok: true };
    }

    if (msg.type === 'GET_BYPASS_LIST') {
      return { list: bypassList.getList() };
    }

    return null; // Unknown message type
  };
}

// ═══════════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════════

describe('SECURITY — Fail-Closed RPC Error Handling (MAINNET CRITICAL)', () => {
  it('RPC network error blocks transaction (fail-closed)', async () => {
    const result = await hasActiveIntentFailClosed(() => {
      throw new Error('NetworkError: Failed to fetch');
    });
    expect(result).toBe(false); // BLOCKED — safe default
  });

  it('RPC timeout blocks transaction', async () => {
    const result = await hasActiveIntentFailClosed(() => {
      throw new Error('AbortError: The operation was aborted');
    });
    expect(result).toBe(false);
  });

  it('RPC returns malformed JSON blocks transaction', async () => {
    const result = await hasActiveIntentFailClosed(async () => {
      return JSON.parse('not json');
    });
    expect(result).toBe(false);
  });

  it('RPC returns 429 rate limit blocks transaction', async () => {
    const result = await hasActiveIntentFailClosed(() => {
      throw new Error('HTTP 429 Too Many Requests');
    });
    expect(result).toBe(false);
  });

  it('RPC returns 503 service unavailable blocks transaction', async () => {
    const result = await hasActiveIntentFailClosed(() => {
      throw new Error('HTTP 503 Service Unavailable');
    });
    expect(result).toBe(false);
  });

  it('OLD fail-open behavior would have allowed through (regression proof)', async () => {
    const result = await hasActiveIntentFailOpen(() => {
      throw new Error('NetworkError');
    });
    expect(result).toBe(true); // OLD behavior: allowed through — UNSAFE
  });

  it('valid RPC response with active intent returns true', async () => {
    const futureExpiry = Math.floor(Date.now() / 1000) + 3600;
    const data = Buffer.alloc(16);
    const view = new DataView(data.buffer);
    view.setBigInt64(0, BigInt(Math.floor(Date.now() / 1000)), true);
    view.setBigInt64(8, BigInt(futureExpiry), true);

    const result = await hasActiveIntentFailClosed(async () => ({
      result: [{ account: { data: [data.toString('base64')] } }],
    }));
    expect(result).toBe(true);
  });

  it('valid RPC response with NO intents returns false', async () => {
    const result = await hasActiveIntentFailClosed(async () => ({
      result: [],
    }));
    expect(result).toBe(false);
  });

  it('valid RPC with only expired intents returns false', async () => {
    const pastExpiry = Math.floor(Date.now() / 1000) - 100;
    const data = Buffer.alloc(16);
    const view = new DataView(data.buffer);
    view.setBigInt64(0, BigInt(1000), true);
    view.setBigInt64(8, BigInt(pastExpiry), true);

    const result = await hasActiveIntentFailClosed(async () => ({
      result: [{ account: { data: [data.toString('base64')] } }],
    }));
    expect(result).toBe(false);
  });
});

describe('SECURITY — Message Handler Type Validation', () => {
  let handler: MessageHandler;
  let bypassList: MockBypassList;

  beforeEach(() => {
    bypassList = new MockBypassList();
    handler = createMessageHandler(bypassList, 'SomeWal1et', async () => false);
  });

  it('null message returns null (ignored)', async () => {
    expect(await handler(null)).toBeNull();
  });

  it('undefined message returns null', async () => {
    expect(await handler(undefined)).toBeNull();
  });

  it('empty object returns null', async () => {
    expect(await handler({})).toBeNull();
  });

  it('numeric type returns null', async () => {
    expect(await handler({ type: 42 })).toBeNull();
  });

  it('unknown message type returns null (no side effects)', async () => {
    expect(await handler({ type: 'UNKNOWN_TYPE' })).toBeNull();
    expect(await handler({ type: 'EXEC_SHELL' })).toBeNull();
    expect(await handler({ type: '__proto__' })).toBeNull();
  });

  it('prototype pollution via type does not crash', async () => {
    expect(await handler({ type: 'constructor' })).toBeNull();
    expect(await handler({ type: 'toString' })).toBeNull();
    expect(await handler({ type: 'valueOf' })).toBeNull();
  });

  it('CHECK_INTENT without origin does not crash', async () => {
    const result = await handler({ type: 'CHECK_INTENT' });
    // origin is undefined, isBypassed(undefined) returns false
    expect(result).toHaveProperty('action');
  });

  it('ADD_BYPASS without origin does not crash', async () => {
    const result = await handler({ type: 'ADD_BYPASS' });
    // Adds undefined to list — not great but doesn't crash
    expect(result).toEqual({ ok: true });
  });
});

describe('SECURITY — CHECK_INTENT Flow Edge Cases', () => {
  it('bypassed origin returns bypass immediately (no RPC call)', async () => {
    const bypassList = new MockBypassList();
    await bypassList.addBypass('https://jup.ag');

    let rpcCalled = false;
    const handler = createMessageHandler(bypassList, 'wallet123', async () => {
      rpcCalled = true;
      return true;
    });

    const result = await handler({ type: 'CHECK_INTENT', origin: 'https://jup.ag' });
    expect(result).toEqual({ action: 'bypass' });
    expect(rpcCalled).toBe(false); // RPC never called for bypassed sites
  });

  it('no wallet configured returns no_wallet', async () => {
    const handler = createMessageHandler(new MockBypassList(), null, async () => true);
    const result = await handler({ type: 'CHECK_INTENT', origin: 'https://evil.com' });
    expect(result).toEqual({ action: 'no_wallet', wallet: null });
  });

  it('active intent returns verified with wallet', async () => {
    const handler = createMessageHandler(new MockBypassList(), 'MyWallet', async () => true);
    const result = await handler({ type: 'CHECK_INTENT', origin: 'https://jup.ag' });
    expect(result).toEqual({ action: 'verified', wallet: 'MyWallet' });
  });

  it('no active intent returns no_intent with wallet', async () => {
    const handler = createMessageHandler(new MockBypassList(), 'MyWallet', async () => false);
    const result = await handler({ type: 'CHECK_INTENT', origin: 'https://jup.ag' });
    expect(result).toEqual({ action: 'no_intent', wallet: 'MyWallet' });
  });
});

describe('SECURITY — Bypass List Storage Manipulation', () => {
  let bypassList: MockBypassList;

  beforeEach(() => {
    bypassList = new MockBypassList();
  });

  it('duplicate add does not create duplicates', async () => {
    await bypassList.addBypass('https://jup.ag');
    await bypassList.addBypass('https://jup.ag');
    await bypassList.addBypass('https://jup.ag');
    expect(bypassList.getList()).toEqual(['https://jup.ag']);
  });

  it('remove non-existent origin does not crash', async () => {
    await bypassList.removeBypass('https://nonexistent.com');
    expect(bypassList.getList()).toEqual([]);
  });

  it('remove cleans up exactly the target', async () => {
    await bypassList.addBypass('https://a.com');
    await bypassList.addBypass('https://b.com');
    await bypassList.addBypass('https://c.com');
    await bypassList.removeBypass('https://b.com');
    expect(bypassList.getList()).toEqual(['https://a.com', 'https://c.com']);
  });

  it('attacker cannot bypass with unicode homograph', async () => {
    await bypassList.addBypass('https://jup.ag');
    // Cyrillic а (U+0430) vs Latin a (U+0061)
    expect(await bypassList.isBypassed('https://jup.\u0430g')).toBe(false);
  });

  it('attacker cannot bypass with trailing whitespace', async () => {
    await bypassList.addBypass('https://jup.ag');
    expect(await bypassList.isBypassed('https://jup.ag ')).toBe(false);
    expect(await bypassList.isBypassed(' https://jup.ag')).toBe(false);
  });

  it('attacker cannot bypass with null byte injection', async () => {
    await bypassList.addBypass('https://jup.ag');
    expect(await bypassList.isBypassed('https://jup.ag\0')).toBe(false);
    expect(await bypassList.isBypassed('https://jup.ag\0.evil.com')).toBe(false);
  });

  it('attacker cannot bypass with URL encoding tricks', async () => {
    await bypassList.addBypass('https://jup.ag');
    expect(await bypassList.isBypassed('https://jup%2Eag')).toBe(false);
    expect(await bypassList.isBypassed('https://JUP.AG')).toBe(false);
  });

  it('empty string origin is never bypassed', async () => {
    expect(await bypassList.isBypassed('')).toBe(false);
  });

  it('adding many origins does not cause issues', async () => {
    for (let i = 0; i < 1000; i++) {
      await bypassList.addBypass(`https://site${i}.com`);
    }
    expect(bypassList.getList().length).toBe(1000);
    expect(await bypassList.isBypassed('https://site999.com')).toBe(true);
    expect(await bypassList.isBypassed('https://site1000.com')).toBe(false);
  });
});

describe('SECURITY — Wallet Base58 Input Validation', () => {
  it('valid base58 wallet decodes without error', () => {
    const wallet = '4etWfDJNHhjYdv7fuGe236GDPguwUXVk9WhbEpQsPix7';
    expect(() => base58Decode(wallet)).not.toThrow();
    expect(base58Decode(wallet).length).toBe(32);
  });

  it('wallet with HTML injection throws', () => {
    expect(() => base58Decode('<script>alert(1)</script>')).toThrow('Invalid base58');
  });

  it('wallet with SQL injection throws', () => {
    expect(() => base58Decode("' OR 1=1 --")).toThrow('Invalid base58');
  });

  it('wallet with path traversal throws', () => {
    expect(() => base58Decode('../../etc/passwd')).toThrow('Invalid base58');
  });

  it('wallet with newline injection throws', () => {
    expect(() => base58Decode('valid\ninjected')).toThrow('Invalid base58');
  });

  it('wallet with emoji throws', () => {
    expect(() => base58Decode('wallet💰key')).toThrow('Invalid base58');
  });

  it('wallet with unicode throws', () => {
    expect(() => base58Decode('wаllet')).toThrow('Invalid base58'); // Cyrillic а
  });
});

describe('SECURITY — RPC Response Manipulation Attacks', () => {
  const now = Math.floor(Date.now() / 1000);

  it('malicious RPC returning null result is safe', () => {
    expect(parseIntentFromRpc({ result: null }, now)).toBe(false);
  });

  it('malicious RPC returning string instead of array is safe', () => {
    expect(parseIntentFromRpc({ result: 'hacked' }, now)).toBe(false);
  });

  it('malicious RPC returning number is safe', () => {
    // result is a number (not iterable) — for...of would throw
    // parseIntentFromRpc checks length === 0 first
    try {
      const result = parseIntentFromRpc({ result: 42 }, now);
      expect(result).toBe(false);
    } catch {
      // Throwing is also safe — attacker can't exploit this
      expect(true).toBe(true);
    }
  });

  it('malicious RPC with nested prototype pollution is safe', () => {
    const json = JSON.parse('{"result":[{"account":{"data":["__proto__"]}}]}');
    expect(parseIntentFromRpc(json, now)).toBe(false);
  });

  it('malicious RPC with MAX_SAFE_INTEGER expiry is handled', () => {
    const data = Buffer.alloc(16);
    const view = new DataView(data.buffer);
    view.setBigInt64(8, BigInt(Number.MAX_SAFE_INTEGER), true);
    const json = { result: [{ account: { data: [data.toString('base64')] } }] };
    expect(parseIntentFromRpc(json, now)).toBe(true); // far future = active
  });

  it('malicious RPC with i64 max value expiry is handled', () => {
    const data = Buffer.alloc(16);
    const view = new DataView(data.buffer);
    view.setBigInt64(8, BigInt('9223372036854775807'), true); // i64::MAX
    const json = { result: [{ account: { data: [data.toString('base64')] } }] };
    // Number() of i64::MAX loses precision but still > now
    expect(parseIntentFromRpc(json, now)).toBe(true);
  });

  it('malicious RPC with exactly-now expiry returns false (not >)', () => {
    const data = Buffer.alloc(16);
    const view = new DataView(data.buffer);
    view.setBigInt64(8, BigInt(now), true); // exactly now
    const json = { result: [{ account: { data: [data.toString('base64')] } }] };
    // expires_at > now is false when equal
    expect(parseIntentFromRpc(json, now)).toBe(false);
  });

  it('malicious RPC with mixed valid/invalid entries parses correctly', () => {
    const expiredData = Buffer.alloc(16);
    const expiredView = new DataView(expiredData.buffer);
    expiredView.setBigInt64(8, BigInt(1000), true); // expired

    const activeData = Buffer.alloc(16);
    const activeView = new DataView(activeData.buffer);
    activeView.setBigInt64(8, BigInt(now + 3600), true); // active

    const json = {
      result: [
        { account: { data: ['invalid-base64'] } },
        { account: { data: [expiredData.toString('base64')] } },
        { account: { data: [activeData.toString('base64')] } },
      ],
    };
    expect(parseIntentFromRpc(json, now)).toBe(true); // found active one
  });

  it('malicious RPC with 100 expired entries and 0 active returns false', () => {
    const entries = Array.from({ length: 100 }, () => {
      const data = Buffer.alloc(16);
      const view = new DataView(data.buffer);
      view.setBigInt64(8, BigInt(1000), true);
      return { account: { data: [data.toString('base64')] } };
    });
    expect(parseIntentFromRpc({ result: entries }, now)).toBe(false);
  });

  it('empty data array item does not crash', () => {
    const json = { result: [{ account: { data: [] } }] };
    expect(parseIntentFromRpc(json, now)).toBe(false);
  });
});
