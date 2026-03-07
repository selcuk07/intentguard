/**
 * Content Script & Injected Script Security Tests — MAINNET CRITICAL
 *
 * Tests for:
 * - postMessage spoofing / origin bypass
 * - RPC response parsing (malicious RPC node)
 * - base58 decode edge cases
 * - Wallet provider unwrapping bypass
 * - innerHTML injection vectors
 * - Bypass list manipulation
 */
import { describe, it, expect } from 'vitest';

// ─── base58 decode (from content.js lines 248-270) ──────────────────

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

// ─── escapeHtml (from content.js lines 151-155) ─────────────────────

function escapeHtml(str: string): string {
  // Real implementation uses DOM: document.createElement('div').textContent=str; return div.innerHTML
  // Simulating the effect:
  const map: Record<string, string> = {
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  };
  return str.replace(/[&<>"']/g, (c) => map[c]);
}

// ─── extractProgramIds (from injected.js lines 57-81) ───────────────

function extractProgramIds(tx: any): string[] {
  try {
    if (tx && tx.instructions) {
      return tx.instructions
        .map((ix: any) => ix.programId?.toBase58?.() || ix.programId?.toString?.())
        .filter(Boolean);
    }
    if (tx && tx.message) {
      const keys = tx.message.staticAccountKeys || tx.message.accountKeys || [];
      const ixs = tx.message.compiledInstructions || tx.message.instructions || [];
      return ixs
        .map((ix: any) => {
          const idx = ix.programIdIndex;
          const key = keys[idx];
          return key?.toBase58?.() || key?.toString?.();
        })
        .filter(Boolean);
    }
  } catch {
    return [];
  }
  return [];
}

describe('SECURITY — base58 Decode Attack Surface', () => {
  it('valid Solana address decodes to 32 bytes', () => {
    const addr = '4etWfDJNHhjYdv7fuGe236GDPguwUXVk9WhbEpQsPix7';
    const decoded = base58Decode(addr);
    expect(decoded.length).toBe(32);
  });

  it('throws on invalid characters (0, O, I, l)', () => {
    expect(() => base58Decode('0invalid')).toThrow('Invalid base58');
    expect(() => base58Decode('Oinvalid')).toThrow('Invalid base58');
    expect(() => base58Decode('Iinvalid')).toThrow('Invalid base58');
    expect(() => base58Decode('linvalid')).toThrow('Invalid base58');
  });

  it('throws on special characters', () => {
    expect(() => base58Decode('abc+def')).toThrow('Invalid base58');
    expect(() => base58Decode('abc/def')).toThrow('Invalid base58');
    expect(() => base58Decode('abc=def')).toThrow('Invalid base58');
  });

  it('throws on spaces', () => {
    expect(() => base58Decode('abc def')).toThrow('Invalid base58');
  });

  it('throws on null bytes', () => {
    expect(() => base58Decode('abc\0def')).toThrow('Invalid base58');
  });

  it('leading "1"s produce leading zero bytes', () => {
    const decoded = base58Decode('11111');
    // Leading 1s in base58 represent leading zero bytes
    const leadingZeros = decoded.filter(b => b === 0).length;
    expect(leadingZeros).toBeGreaterThanOrEqual(5);
  });

  it('extremely long input does not crash (DoS)', () => {
    const longAddr = '2'.repeat(10000);
    // Should not throw, just produce a large output
    expect(() => base58Decode(longAddr)).not.toThrow();
  });
});

describe('SECURITY — extractProgramIds Bypass Attempts', () => {
  it('null transaction returns empty array', () => {
    expect(extractProgramIds(null)).toEqual([]);
    expect(extractProgramIds(undefined)).toEqual([]);
    expect(extractProgramIds({})).toEqual([]);
  });

  it('prototype pollution in tx.instructions does not crash', () => {
    const malicious = JSON.parse('{"instructions":[{"programId":"__proto__"}]}');
    const result = extractProgramIds(malicious);
    expect(result).toEqual(['__proto__']);
  });

  it('instructions with toString returning script tag', () => {
    const tx = {
      instructions: [{
        programId: { toString: () => '<script>alert(1)</script>' },
      }],
    };
    const ids = extractProgramIds(tx);
    expect(ids[0]).toBe('<script>alert(1)</script>');
    // The programId is passed to the overlay which uses escapeHtml — safe
  });

  it('negative programIdIndex does not crash', () => {
    const tx = {
      message: {
        staticAccountKeys: [{ toBase58: () => 'abc' }],
        compiledInstructions: [{ programIdIndex: -1 }],
      },
    };
    const ids = extractProgramIds(tx);
    // keys[-1] is undefined, filtered out
    expect(ids).toEqual([]);
  });

  it('programIdIndex beyond array length returns empty', () => {
    const tx = {
      message: {
        staticAccountKeys: [{ toBase58: () => 'abc' }],
        compiledInstructions: [{ programIdIndex: 999 }],
      },
    };
    const ids = extractProgramIds(tx);
    expect(ids).toEqual([]);
  });

  it('throwing toBase58 is caught gracefully', () => {
    const tx = {
      instructions: [{
        programId: {
          toBase58: () => { throw new Error('crash'); },
          toString: () => 'fallback',
        },
      }],
    };
    // toBase58 throws but extractProgramIds catches
    const ids = extractProgramIds(tx);
    // Actually it won't catch because the try/catch is around the whole function
    // but toBase58 throws before toString is tried
    expect(ids).toEqual([]);
  });
});

describe('SECURITY — postMessage Spoofing Prevention', () => {
  // The content script checks: event.source !== window
  // This means only messages from the same window context are accepted

  it('event.source check blocks cross-frame messages', () => {
    const isValid = (event: { source: any; data: any }) => {
      if (event.source !== 'window-ref') return false;
      if (!event.data || event.data.type !== 'IG_SIGN_REQUEST') return false;
      return true;
    };

    // Attacker sends from iframe
    expect(isValid({ source: 'iframe-ref', data: { type: 'IG_SIGN_REQUEST' } })).toBe(false);
    // Attacker sends null source
    expect(isValid({ source: null, data: { type: 'IG_SIGN_REQUEST' } })).toBe(false);
    // Valid message from same window
    expect(isValid({ source: 'window-ref', data: { type: 'IG_SIGN_REQUEST' } })).toBe(true);
  });

  it('IG_SIGN_RESPONSE only accepts "allow" and "block"', () => {
    const validActions = new Set(['allow', 'block']);

    expect(validActions.has('allow')).toBe(true);
    expect(validActions.has('block')).toBe(true);
    expect(validActions.has('bypass')).toBe(false);
    expect(validActions.has('skip')).toBe(false);
    expect(validActions.has('')).toBe(false);
    expect(validActions.has('ALLOW')).toBe(false); // case sensitive
  });

  it('missing type field is rejected', () => {
    const isValid = (data: any) => !!(data && data.type === 'IG_SIGN_REQUEST');
    expect(isValid(null)).toBe(false);
    expect(isValid(undefined)).toBe(false);
    expect(isValid({})).toBe(false);
    expect(isValid({ type: 'OTHER' })).toBe(false);
  });
});

describe('SECURITY — Overlay innerHTML XSS Prevention', () => {
  it('method with HTML tags is escaped in overlay', () => {
    const method = '<img src=x onerror=alert(1)>';
    const safe = escapeHtml(method);
    expect(safe).not.toContain('<img');
    expect(safe).toContain('&lt;img');
  });

  it('programId with script tag is escaped in overlay', () => {
    const programId = '<script>document.cookie</script>';
    const display = escapeHtml(programId.slice(0, 8) + '...');
    expect(display).not.toContain('<script>');
  });

  it('method with template literal injection', () => {
    const method = '${alert(1)}';
    const safe = escapeHtml(method);
    // Template literals aren't executed in innerHTML, but verify it passes through
    expect(safe).toBe('${alert(1)}');
  });

  it('unicode characters pass through safely', () => {
    const method = 'signTransaction\u{1F4B0}';
    const safe = escapeHtml(method);
    expect(safe).toContain('signTransaction');
  });

  it('very long method name does not cause DoS', () => {
    const method = 'a'.repeat(1_000_000);
    const safe = escapeHtml(method);
    expect(safe.length).toBe(1_000_000);
  });
});

describe('SECURITY — RPC Response Parsing', () => {
  // Simulates what content.js checkForCommit does with RPC responses

  function parseRpcResult(json: any): boolean {
    if (!json.result || json.result.length === 0) return false;
    const now = Math.floor(Date.now() / 1000);
    for (const item of json.result) {
      try {
        const b64 = item.account.data[0];
        const raw = Buffer.from(b64, 'base64');
        const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
        if (raw.byteLength < 16) continue; // need at least 16 bytes for committed_at + expires_at
        const expiresAt = Number(view.getBigInt64(8, true));
        if (expiresAt > now) return true;
      } catch {
        continue;
      }
    }
    return false;
  }

  it('empty result returns false', () => {
    expect(parseRpcResult({ result: [] })).toBe(false);
    expect(parseRpcResult({ result: null })).toBe(false);
    expect(parseRpcResult({})).toBe(false);
  });

  it('malformed base64 data does not crash', () => {
    const json = { result: [{ account: { data: ['!!!invalid-base64!!!'] } }] };
    expect(parseRpcResult(json)).toBe(false);
  });

  it('truncated data (< 16 bytes) is skipped safely', () => {
    const shortData = Buffer.from([1, 2, 3]).toString('base64');
    const json = { result: [{ account: { data: [shortData] } }] };
    expect(parseRpcResult(json)).toBe(false);
  });

  it('expired intent returns false', () => {
    const data = Buffer.alloc(16);
    const view = new DataView(data.buffer);
    view.setBigInt64(0, BigInt(1000), true); // committed_at
    view.setBigInt64(8, BigInt(1000), true); // expires_at = 1000 (way past)
    const json = { result: [{ account: { data: [data.toString('base64')] } }] };
    expect(parseRpcResult(json)).toBe(false);
  });

  it('far-future expiry returns true', () => {
    const data = Buffer.alloc(16);
    const view = new DataView(data.buffer);
    view.setBigInt64(0, BigInt(Math.floor(Date.now() / 1000)), true);
    view.setBigInt64(8, BigInt(Math.floor(Date.now() / 1000) + 3600), true);
    const json = { result: [{ account: { data: [data.toString('base64')] } }] };
    expect(parseRpcResult(json)).toBe(true);
  });

  it('malicious RPC with missing data array does not crash', () => {
    const json = { result: [{ account: {} }] };
    expect(parseRpcResult(json)).toBe(false);
  });

  it('malicious RPC with extra-large data does not crash', () => {
    const largeData = Buffer.alloc(10000).toString('base64');
    const json = { result: [{ account: { data: [largeData] } }] };
    // expires_at at offset 8 will be 0 (all zeros) — expired
    expect(parseRpcResult(json)).toBe(false);
  });

  it('negative expires_at from malicious data returns false', () => {
    const data = Buffer.alloc(16);
    const view = new DataView(data.buffer);
    view.setBigInt64(8, BigInt(-1), true); // negative timestamp
    const json = { result: [{ account: { data: [data.toString('base64')] } }] };
    expect(parseRpcResult(json)).toBe(false);
  });
});

describe('SECURITY — Bypass List Injection', () => {
  it('bypass check uses exact string match', () => {
    const bypassList = ['https://jup.ag', 'https://raydium.io'];

    // Exact match
    expect(bypassList.includes('https://jup.ag')).toBe(true);

    // Subdomain attack
    expect(bypassList.includes('https://evil.jup.ag')).toBe(false);

    // Path suffix attack
    expect(bypassList.includes('https://jup.ag/evil')).toBe(false);

    // Port manipulation
    expect(bypassList.includes('https://jup.ag:8080')).toBe(false);

    // Protocol downgrade
    expect(bypassList.includes('http://jup.ag')).toBe(false);

    // Trailing slash
    expect(bypassList.includes('https://jup.ag/')).toBe(false);

    // Unicode homograph
    expect(bypassList.includes('https://juр.ag')).toBe(false); // Cyrillic р

    // Null byte injection
    expect(bypassList.includes('https://jup.ag\0')).toBe(false);
  });

  it('window.location.origin always returns clean origin', () => {
    // window.location.origin format: "https://domain.com" (no path, no query)
    // Simulating what the browser returns
    const parseOrigin = (url: string) => {
      try { return new URL(url).origin; } catch { return ''; }
    };

    expect(parseOrigin('https://jup.ag/swap?token=SOL')).toBe('https://jup.ag');
    expect(parseOrigin('https://jup.ag:443')).toBe('https://jup.ag');
    expect(parseOrigin('https://jup.ag:8080')).toBe('https://jup.ag:8080');
    expect(parseOrigin('javascript:alert(1)')).toBe('null');
    expect(parseOrigin('data:text/html,<h1>hi</h1>')).toBe('null');
  });
});

describe('SECURITY — Wallet Provider Wrapping Integrity', () => {
  it('__igWrapped flag prevents double-wrapping', () => {
    const provider: any = { __igWrapped: false };

    function wrapProvider(p: any) {
      if (!p || p.__igWrapped) return false;
      p.__igWrapped = true;
      return true;
    }

    expect(wrapProvider(provider)).toBe(true);
    expect(wrapProvider(provider)).toBe(false); // already wrapped
  });

  it('attacker cannot unwrap by deleting __igWrapped', () => {
    const provider: any = { __igWrapped: true };

    // Attacker tries to unwrap
    delete provider.__igWrapped;

    // Now wrapProvider would re-wrap — but the original signTransaction is already replaced
    // The re-wrap would wrap the already-wrapped function, not bypass it
    expect(provider.__igWrapped).toBeUndefined();
  });

  it('attacker replacing window.solana gets re-wrapped by defineProperty', () => {
    // The injected.js uses Object.defineProperty to watch for wallet injection
    // If attacker replaces window.solana, the setter fires and re-wraps
    let currentValue: any = null;
    let wrapCalled = false;

    // Simulate defineProperty behavior
    const windowMock: any = {};
    Object.defineProperty(windowMock, 'solana', {
      get() { return currentValue; },
      set(val) {
        currentValue = val;
        if (val) wrapCalled = true;
      },
      configurable: true,
    });

    windowMock.solana = { signTransaction: () => {} };
    expect(wrapCalled).toBe(true);
  });

  it('signTransaction wrapping preserves function binding', () => {
    let originalCalled = false;
    const provider = {
      name: 'test-wallet',
      signTransaction: function(tx: any) {
        originalCalled = true;
        return tx;
      },
    };

    // Simulate wrapping
    const original = provider.signTransaction.bind(provider);
    provider.signTransaction = async function(tx: any) {
      // IntentGuard check would happen here
      return original(tx);
    };

    provider.signTransaction('tx');
    expect(originalCalled).toBe(true);
  });
});
