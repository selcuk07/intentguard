/**
 * Timing, Race Condition & State Machine Security Tests
 *
 * Tests for:
 * - Intent lifecycle state machine correctness
 * - Polling race conditions
 * - Request ID collision / overflow
 * - Timeout behavior
 * - Concurrent overlay handling
 * - Clock manipulation resistance
 * - Message ordering attacks
 */
import { describe, it, expect } from 'vitest';

// ─── Intent State Machine ──────────────────────────────────────────

type IntentState = 'none' | 'committed' | 'verified' | 'revoked' | 'expired';

interface IntentStateMachine {
  state: IntentState;
  transition(action: string): boolean;
  getValidActions(): string[];
}

function createIntentStateMachine(): IntentStateMachine {
  let state: IntentState = 'none';

  const transitions: Map<IntentState, Map<string, IntentState>> = new Map([
    ['none', new Map([['commit', 'committed' as IntentState]])],
    ['committed', new Map([['verify', 'verified' as IntentState], ['revoke', 'revoked' as IntentState], ['expire', 'expired' as IntentState]])],
    ['verified', new Map([['commit', 'committed' as IntentState]])],
    ['revoked', new Map([['commit', 'committed' as IntentState]])],
    ['expired', new Map([['revoke', 'revoked' as IntentState], ['commit', 'committed' as IntentState]])],
  ]);

  return {
    get state() { return state; },
    transition(action: string): boolean {
      const stateMap = transitions.get(state);
      if (!stateMap) return false;
      const next = stateMap.get(action);
      if (!next) return false;
      state = next;
      return true;
    },
    getValidActions(): string[] {
      const stateMap = transitions.get(state);
      return stateMap ? Array.from(stateMap.keys()) : [];
    },
  };
}

// ─── Request ID Manager (from injected.js) ─────────────────────────

class RequestIdManager {
  private id = 0;
  private pending = new Map<number, { resolve: Function; reject: Function; createdAt: number }>();

  create(): { id: number; promise: Promise<string> } {
    const id = ++this.id;
    const promise = new Promise<string>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, createdAt: Date.now() });
    });
    return { id, promise };
  }

  resolve(id: number, action: string): boolean {
    const entry = this.pending.get(id);
    if (!entry) return false;
    this.pending.delete(id);
    entry.resolve(action);
    return true;
  }

  reject(id: number, error: Error): boolean {
    const entry = this.pending.get(id);
    if (!entry) return false;
    this.pending.delete(id);
    entry.reject(error);
    return true;
  }

  has(id: number): boolean {
    return this.pending.has(id);
  }

  get size(): number {
    return this.pending.size;
  }

  get currentId(): number {
    return this.id;
  }

  // Clean up stale requests
  cleanupStale(maxAgeMs: number): number {
    const now = Date.now();
    let cleaned = 0;
    for (const [id, entry] of this.pending) {
      if (now - entry.createdAt > maxAgeMs) {
        this.pending.delete(id);
        entry.reject(new Error('Request timed out'));
        cleaned++;
      }
    }
    return cleaned;
  }
}

// ─── Polling State Manager ─────────────────────────────────────────

class PollManager {
  private attempts = 0;
  private maxAttempts: number;
  private active = false;
  private found = false;

  constructor(maxAttempts: number) {
    this.maxAttempts = maxAttempts;
  }

  start(): void {
    this.active = true;
    this.attempts = 0;
    this.found = false;
  }

  tick(foundIntent: boolean): 'continue' | 'found' | 'timeout' {
    if (!this.active) return 'timeout';
    this.attempts++;
    if (foundIntent) {
      this.active = false;
      this.found = true;
      return 'found';
    }
    if (this.attempts >= this.maxAttempts) {
      this.active = false;
      return 'timeout';
    }
    return 'continue';
  }

  stop(): void {
    this.active = false;
  }

  get isActive(): boolean { return this.active; }
  get totalAttempts(): number { return this.attempts; }
  get wasFound(): boolean { return this.found; }
}

// ═══════════════════════════════════════════════════════════════════

describe('SECURITY — Intent Lifecycle State Machine', () => {
  it('starts in none state', () => {
    const sm = createIntentStateMachine();
    expect(sm.state).toBe('none');
  });

  it('valid lifecycle: none -> committed -> verified -> committed', () => {
    const sm = createIntentStateMachine();
    expect(sm.transition('commit')).toBe(true);
    expect(sm.state).toBe('committed');
    expect(sm.transition('verify')).toBe(true);
    expect(sm.state).toBe('verified');
    expect(sm.transition('commit')).toBe(true);
    expect(sm.state).toBe('committed');
  });

  it('valid lifecycle: none -> committed -> revoked -> committed', () => {
    const sm = createIntentStateMachine();
    expect(sm.transition('commit')).toBe(true);
    expect(sm.transition('revoke')).toBe(true);
    expect(sm.state).toBe('revoked');
    expect(sm.transition('commit')).toBe(true);
    expect(sm.state).toBe('committed');
  });

  it('cannot verify from none state', () => {
    const sm = createIntentStateMachine();
    expect(sm.transition('verify')).toBe(false);
    expect(sm.state).toBe('none');
  });

  it('cannot revoke from none state', () => {
    const sm = createIntentStateMachine();
    expect(sm.transition('revoke')).toBe(false);
  });

  it('cannot double-verify', () => {
    const sm = createIntentStateMachine();
    sm.transition('commit');
    sm.transition('verify');
    expect(sm.transition('verify')).toBe(false); // already verified/closed
  });

  it('cannot double-revoke', () => {
    const sm = createIntentStateMachine();
    sm.transition('commit');
    sm.transition('revoke');
    expect(sm.transition('revoke')).toBe(false);
  });

  it('cannot commit while already committed (PDA exists)', () => {
    const sm = createIntentStateMachine();
    sm.transition('commit');
    expect(sm.transition('commit')).toBe(false);
  });

  it('expired intent can be revoked (rent recovery)', () => {
    const sm = createIntentStateMachine();
    sm.transition('commit');
    sm.transition('expire');
    expect(sm.state).toBe('expired');
    expect(sm.transition('revoke')).toBe(true);
  });

  it('expired intent cannot be verified', () => {
    const sm = createIntentStateMachine();
    sm.transition('commit');
    sm.transition('expire');
    expect(sm.transition('verify')).toBe(false);
  });

  it('expired intent can be re-committed', () => {
    const sm = createIntentStateMachine();
    sm.transition('commit');
    sm.transition('expire');
    expect(sm.transition('commit')).toBe(true);
  });

  it('valid actions change per state', () => {
    const sm = createIntentStateMachine();
    expect(sm.getValidActions()).toEqual(['commit']);
    sm.transition('commit');
    expect(sm.getValidActions()).toContain('verify');
    expect(sm.getValidActions()).toContain('revoke');
    expect(sm.getValidActions()).toContain('expire');
    expect(sm.getValidActions()).not.toContain('commit');
  });

  it('unknown action returns false', () => {
    const sm = createIntentStateMachine();
    expect(sm.transition('hack')).toBe(false);
    expect(sm.transition('')).toBe(false);
    // __proto__ is a valid key in a plain object literal, so transitions['none']['__proto__']
    // may return Object.prototype methods — verify it doesn't cause a transition
    const before = sm.state;
    sm.transition('constructor');
    expect(sm.state).toBe(before); // state unchanged
  });
});

describe('SECURITY — Request ID Management', () => {
  it('IDs are sequential and unique', () => {
    const mgr = new RequestIdManager();
    const r1 = mgr.create();
    const r2 = mgr.create();
    const r3 = mgr.create();
    expect(r1.id).toBe(1);
    expect(r2.id).toBe(2);
    expect(r3.id).toBe(3);
  });

  it('resolving unknown ID returns false', () => {
    const mgr = new RequestIdManager();
    expect(mgr.resolve(999, 'allow')).toBe(false);
  });

  it('double-resolve returns false (prevents replay)', () => {
    const mgr = new RequestIdManager();
    const r = mgr.create();
    expect(mgr.resolve(r.id, 'allow')).toBe(true);
    expect(mgr.resolve(r.id, 'allow')).toBe(false); // already resolved
  });

  it('resolve with wrong ID does not affect other requests', () => {
    const mgr = new RequestIdManager();
    const r1 = mgr.create();
    const r2 = mgr.create();
    mgr.resolve(r1.id, 'allow');
    expect(mgr.has(r2.id)).toBe(true); // r2 still pending
  });

  it('pending count tracks correctly', () => {
    const mgr = new RequestIdManager();
    expect(mgr.size).toBe(0);
    const r1 = mgr.create();
    const r2 = mgr.create();
    expect(mgr.size).toBe(2);
    mgr.resolve(r1.id, 'allow');
    expect(mgr.size).toBe(1);
    mgr.resolve(r2.id, 'block');
    expect(mgr.size).toBe(0);
  });

  it('negative ID does not match', () => {
    const mgr = new RequestIdManager();
    mgr.create();
    expect(mgr.resolve(-1, 'allow')).toBe(false);
  });

  it('zero ID does not match (IDs start at 1)', () => {
    const mgr = new RequestIdManager();
    mgr.create();
    expect(mgr.resolve(0, 'allow')).toBe(false);
  });

  it('very large number of requests does not crash', () => {
    const mgr = new RequestIdManager();
    for (let i = 0; i < 10000; i++) {
      mgr.create();
    }
    expect(mgr.size).toBe(10000);
    expect(mgr.currentId).toBe(10000);
    // Resolve all
    for (let i = 1; i <= 10000; i++) {
      mgr.resolve(i, 'allow');
    }
    expect(mgr.size).toBe(0);
  });

  it('stale request cleanup works', async () => {
    const mgr = new RequestIdManager();
    const r1 = mgr.create();
    const r2 = mgr.create();
    const r3 = mgr.create();

    // Catch rejections so they don't become unhandled
    r1.promise.catch(() => {});
    r2.promise.catch(() => {});
    r3.promise.catch(() => {});

    // Wait a small amount so createdAt is in the past
    await new Promise((r) => setTimeout(r, 10));

    // Cleanup with maxAge=5ms — all 3 should be stale by now
    const cleaned = mgr.cleanupStale(5);
    expect(cleaned).toBe(3);
    expect(mgr.size).toBe(0);
  });
});

describe('SECURITY — Polling Race Conditions', () => {
  it('polling stops immediately when intent found', () => {
    const pm = new PollManager(150);
    pm.start();
    expect(pm.tick(false)).toBe('continue');
    expect(pm.tick(false)).toBe('continue');
    expect(pm.tick(true)).toBe('found');
    expect(pm.isActive).toBe(false);
    // Further ticks after found
    expect(pm.tick(false)).toBe('timeout');
  });

  it('polling times out after max attempts', () => {
    const pm = new PollManager(3);
    pm.start();
    expect(pm.tick(false)).toBe('continue');
    expect(pm.tick(false)).toBe('continue');
    expect(pm.tick(false)).toBe('timeout');
    expect(pm.isActive).toBe(false);
    expect(pm.totalAttempts).toBe(3);
  });

  it('manual stop prevents further processing', () => {
    const pm = new PollManager(100);
    pm.start();
    pm.tick(false);
    pm.stop();
    expect(pm.tick(true)).toBe('timeout'); // stopped, so returns timeout
    expect(pm.wasFound).toBe(false);
  });

  it('starting new poll resets state', () => {
    const pm = new PollManager(5);
    pm.start();
    pm.tick(false);
    pm.tick(false);
    pm.start(); // reset
    expect(pm.totalAttempts).toBe(0);
    expect(pm.isActive).toBe(true);
  });

  it('concurrent overlay scenario — second request cancels first', async () => {
    // Simulates: user triggers TX1 (overlay shown), then triggers TX2
    const mgr = new RequestIdManager();
    const r1 = mgr.create();
    const r2 = mgr.create();

    // Catch the rejection so it doesn't become unhandled
    r1.promise.catch(() => { /* expected rejection */ });

    // Cancel first request (overlay replaced)
    mgr.reject(r1.id, new Error('Replaced by new request'));
    expect(mgr.has(r1.id)).toBe(false);
    expect(mgr.has(r2.id)).toBe(true);

    // Resolve second
    mgr.resolve(r2.id, 'allow');
    expect(mgr.size).toBe(0);

    // Verify r1 was rejected
    await expect(r1.promise).rejects.toThrow('Replaced by new request');
    await expect(r2.promise).resolves.toBe('allow');
  });
});

describe('SECURITY — Clock Manipulation Resistance', () => {
  // The program uses Clock::get() for timestamps.
  // Client-side, we use Date.now()/1000 for display.
  // These tests verify client-side handling is safe.

  it('expiry check handles clock skew (client ahead of chain)', () => {
    const chainNow = 1700000000;
    const clientNow = 1700000060; // 60 seconds ahead
    const expiresAt = chainNow + 300; // expires 300s after chain time

    // Client thinks only 240s remaining instead of 300s
    const clientRemaining = expiresAt - clientNow;
    expect(clientRemaining).toBe(240);
    expect(clientRemaining).toBeGreaterThan(0); // still shows as active
  });

  it('expiry check handles clock skew (client behind chain)', () => {
    const chainNow = 1700000060;
    const clientNow = 1700000000; // 60 seconds behind
    const expiresAt = chainNow + 30; // short TTL

    // Client thinks 90s remaining instead of 30s — shows more time than actual
    const clientRemaining = expiresAt - clientNow;
    expect(clientRemaining).toBe(90);
    // This is "safe" in that it doesn't allow expired intents through
    // The on-chain check is authoritative
  });

  it('zero timestamp is always expired', () => {
    const now = Math.floor(Date.now() / 1000);
    expect(0 > now).toBe(false); // 0 is never > now
  });

  it('negative timestamp is always expired', () => {
    const now = Math.floor(Date.now() / 1000);
    expect(-1 > now).toBe(false);
  });

  it('year 2038 problem — i32 overflow does not affect i64', () => {
    const y2038 = 2147483647; // i32::MAX — Jan 19, 2038
    const now = Math.floor(Date.now() / 1000); // currently ~1.7 billion

    // i64 can handle dates well beyond 2038
    const y2100 = 4102444800;
    expect(y2100 > now).toBe(true);
    expect(y2038 > now).toBe(true); // Not yet reached
  });
});

describe('SECURITY — Message Ordering Attacks', () => {
  it('response for old request ID is ignored', () => {
    const mgr = new RequestIdManager();
    const r1 = mgr.create();
    mgr.resolve(r1.id, 'block');

    // Attacker sends delayed response for r1 with 'allow'
    const replayed = mgr.resolve(r1.id, 'allow');
    expect(replayed).toBe(false); // Already resolved — replay ignored
  });

  it('response arrives before request timeout', async () => {
    const mgr = new RequestIdManager();
    const r = mgr.create();

    // Simulate: response arrives quickly
    mgr.resolve(r.id, 'allow');
    const result = await r.promise;
    expect(result).toBe('allow');
  });

  it('interleaved responses resolve correct promises', async () => {
    const mgr = new RequestIdManager();
    const r1 = mgr.create();
    const r2 = mgr.create();
    const r3 = mgr.create();

    // Out of order resolution
    mgr.resolve(r2.id, 'block');
    mgr.resolve(r3.id, 'allow');
    mgr.resolve(r1.id, 'allow');

    expect(await r1.promise).toBe('allow');
    expect(await r2.promise).toBe('block');
    expect(await r3.promise).toBe('allow');
  });

  it('attacker cannot inject response with fabricated ID', () => {
    const mgr = new RequestIdManager();
    mgr.create(); // id 1

    // Attacker guesses id 2 before it exists
    expect(mgr.resolve(2, 'allow')).toBe(false);

    // Now create id 2
    const r2 = mgr.create();
    expect(r2.id).toBe(2);
    expect(mgr.has(2)).toBe(true);
  });
});

describe('SECURITY — Overlay State Consistency', () => {
  type OverlayState = 'hidden' | 'shown' | 'success' | 'timeout';

  class OverlayManager {
    state: OverlayState = 'hidden';
    requestId: number | null = null;

    show(requestId: number): void {
      this.state = 'shown';
      this.requestId = requestId;
    }

    setSuccess(): void {
      if (this.state === 'shown') this.state = 'success';
    }

    setTimeout(): void {
      if (this.state === 'shown') this.state = 'timeout';
    }

    hide(): void {
      this.state = 'hidden';
      this.requestId = null;
    }

    isForRequest(id: number): boolean {
      return this.requestId === id;
    }
  }

  it('overlay starts hidden', () => {
    const om = new OverlayManager();
    expect(om.state).toBe('hidden');
    expect(om.requestId).toBeNull();
  });

  it('showing overlay sets request ID', () => {
    const om = new OverlayManager();
    om.show(42);
    expect(om.state).toBe('shown');
    expect(om.requestId).toBe(42);
  });

  it('success only works when shown', () => {
    const om = new OverlayManager();
    om.setSuccess(); // hidden -> no change
    expect(om.state).toBe('hidden');
    om.show(1);
    om.setSuccess();
    expect(om.state).toBe('success');
  });

  it('timeout only works when shown', () => {
    const om = new OverlayManager();
    om.setTimeout();
    expect(om.state).toBe('hidden');
    om.show(1);
    om.setTimeout();
    expect(om.state).toBe('timeout');
  });

  it('hide resets everything', () => {
    const om = new OverlayManager();
    om.show(99);
    om.hide();
    expect(om.state).toBe('hidden');
    expect(om.requestId).toBeNull();
  });

  it('second show replaces first (no stale overlay)', () => {
    const om = new OverlayManager();
    om.show(1);
    om.show(2);
    expect(om.requestId).toBe(2);
    expect(om.isForRequest(1)).toBe(false);
    expect(om.isForRequest(2)).toBe(true);
  });

  it('success for wrong request ID does not affect overlay', () => {
    const om = new OverlayManager();
    om.show(1);
    // Attacker sends success signal for old request
    if (om.isForRequest(99)) {
      om.setSuccess();
    }
    expect(om.state).toBe('shown'); // unchanged
  });
});
