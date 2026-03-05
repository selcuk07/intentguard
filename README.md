# IntentGuard

**Solana 2FA — Cryptographic intent verification for every transaction.**

IntentGuard is an on-chain protocol that adds two-factor authentication to Solana transactions. Before executing any action through a dApp (browser), users first confirm their intent from a separate trusted device (mobile app, CLI, or hardware wallet). If the dApp is compromised and tries to alter transaction parameters, the on-chain hash verification fails and the transaction reverts.

## The Problem

Solana transactions today have a single point of failure: the frontend.

- A compromised dApp can show "Swap 10 USDC" while actually signing "Swap 10,000 USDC"
- Wallet simulation helps, but if the frontend is hijacked, the simulation data can be spoofed too
- Hardware wallets display raw hex — humans can't verify transaction parameters on a Ledger screen
- Once you click "Approve", there's no going back

**One compromised frontend = drained wallet.**

## The Solution

IntentGuard introduces a commit-reveal pattern with device separation:

```
┌──────────────────┐                 ┌──────────────────┐
│   Trusted Device  │                 │    Browser/dApp   │
│  (Mobile / CLI)   │                 │   (Untrusted)     │
├──────────────────┤                 ├──────────────────┤
│                    │                 │                    │
│  1. User sees:     │                 │                    │
│     "Swap 100 USDC │                 │                    │
│      for SOL on    │                 │                    │
│      Jupiter"      │                 │                    │
│                    │                 │                    │
│  2. Confirms →     │                 │                    │
│     TX1: commit    │──── hash ────►  │  3. Detects commit │
│     intent hash    │   on-chain      │     on-chain       │
│                    │                 │                    │
│                    │                 │  4. Executes TX2:  │
│                    │                 │     swap + verify  │
│                    │                 │     intent         │
│                    │                 │                    │
│                    │                 │  ✅ Hash matches → │
│                    │                 │     TX succeeds    │
│                    │                 │                    │
│                    │                 │  ❌ Hash mismatch →│
│                    │                 │     TX reverts     │
└──────────────────┘                 └──────────────────┘
```

**Even if the browser is fully compromised after step 2, the attacker cannot change the transaction parameters.** The hash is already locked on-chain from the trusted device.

## How It Works

### 1. Commit (Trusted Device → On-chain)

User confirms intent parameters on their mobile app or CLI. The app computes a SHA-256 hash and sends a `commit_intent` transaction to Solana.

```typescript
import { computeIntentHash } from '@intentguard/sdk';

// Hash whatever parameters the target dApp needs
const hash = computeIntentHash([
  jupiterProgramId.toBuffer(),
  userWallet.toBuffer(),
  inputMint.toBuffer(),
  outputMint.toBuffer(),
  amountIn.toArrayLike(Buffer, 'le', 8),
  minAmountOut.toArrayLike(Buffer, 'le', 8),
]);

// Send commit TX from trusted device
await program.methods
  .commitIntent(jupiterProgramId, hash, new BN(300)) // 5 min TTL
  .accounts({ ... })
  .rpc();
```

### 2. Verify (Browser → On-chain)

The dApp detects the on-chain IntentCommit PDA and includes a `verify_intent` call in the same transaction as the target action. IntentGuard checks the hash and closes the PDA.

```typescript
// Browser detects commit exists, adds verify instruction
await program.methods
  .verifyIntent(hash)
  .accounts({ ... })
  .rpc();

// If hash matches → PDA closed, rent refunded, dApp proceeds
// If hash doesn't match → TX reverts, funds are safe
```

### 3. Revoke (Optional)

User changed their mind? Revoke the commit from any device.

```typescript
await program.methods
  .revokeIntent(appId)
  .accounts({ ... })
  .rpc();
```

## Architecture

### On-chain Program

| Instruction | Description |
|---|---|
| `initialize` | One-time protocol setup (admin config) |
| `commit_intent` | Lock intent hash on-chain (TX1 from trusted device) |
| `verify_intent` | Verify hash match and close PDA (TX2 from dApp) |
| `revoke_intent` | Cancel pending intent, refund rent |

### PDA Structure

**IntentCommit** — `seeds: [b"intent", user, app_id]`

One active intent per user per app. Automatically closed on verification.

| Field | Type | Description |
|---|---|---|
| `user` | `Pubkey` | Wallet that committed |
| `app_id` | `Pubkey` | Target program identifier |
| `intent_hash` | `[u8; 32]` | SHA-256 of intent parameters |
| `committed_at` | `i64` | When committed |
| `expires_at` | `i64` | When it expires |
| `bump` | `u8` | PDA bump |

**GuardConfig** — `seeds: [b"config"]`

Global protocol state with admin controls and lifetime counters.

### Security Properties

| Attack | Protection |
|---|---|
| Frontend compromise (after commit) | Hash is locked on-chain — changing params breaks the hash |
| Replay attack | PDA is closed after verification — can't reuse |
| Stale intent | TTL enforced (30s–1h, default 5min) |
| Cross-app attack | Per-app PDA isolation — Jupiter intent can't verify on Raydium |
| Account theft | `has_one = user` constraint — only owner can verify/revoke |

## Integration Guide

Any Solana program can integrate IntentGuard in two ways:

### Option A: Separate Verify Instruction

Add `verify_intent` as a separate instruction in the same transaction. No changes to your program needed.

```typescript
const tx = new Transaction();
tx.add(intentGuardVerifyIx);  // Verify intent hash
tx.add(yourDappSwapIx);        // Your actual instruction
await sendTransaction(tx);
```

### Option B: CPI Verification

Call IntentGuard via CPI from within your program for tighter integration.

```rust
// In your program's instruction handler:
intent_guard::cpi::verify_intent(cpi_ctx, intent_hash)?;
// If we reach here, intent was verified
proceed_with_swap(...)?;
```

### Hash Format

IntentGuard is hash-format agnostic. You define what goes into the hash based on your dApp's needs:

```
SHA-256(program_id + user + param1 + param2 + ...)
```

The only requirement: both the commit side (mobile/CLI) and verify side (browser) must compute the same hash from the same parameters.

## Project Structure

```
intentguard/
├── programs/intent-guard/     # Anchor program
│   └── src/
│       ├── lib.rs             # Program entrypoint (4 instructions)
│       ├── state.rs           # IntentCommit, GuardConfig
│       ├── errors.rs          # Error codes
│       └── instructions/      # Instruction handlers
├── packages/sdk/              # TypeScript SDK
│   └── src/
│       ├── client.ts          # computeIntentHash, getIntentCommit
│       ├── pdas.ts            # PDA derivation helpers
│       └── constants.ts       # Program ID, defaults
├── tests/
│   └── intent-guard.ts        # 14 tests (full coverage)
├── Anchor.toml
└── README.md
```

## Development

### Prerequisites

- Rust 1.75+
- Solana CLI 2.x
- Anchor CLI 0.32.1
- Node.js 20+

### Build

```bash
# Build the program (requires WSL on Windows for BPF compilation)
anchor build

# Build with dev-testing feature (relaxed TTL for tests)
anchor build -- --features dev-testing
```

### Test

```bash
# Run all tests (14 tests)
anchor test

# Skip build if already compiled
anchor test --skip-build
```

### Dependency Pins

Platform-tools ships rustc 1.79.0. The following pins are required:

```bash
cargo update -p indexmap --precise 2.11.4
cargo update -p proc-macro-crate@3.5.0 --precise 3.2.0
```

## SDK

```bash
npm install @intentguard/sdk
```

```typescript
import {
  computeIntentHash,
  getIntentCommit,
  findIntentCommitPda,
  findConfigPda,
  INTENT_GUARD_PROGRAM_ID,
} from '@intentguard/sdk';
```

## Roadmap

- [x] On-chain program (commit, verify, revoke)
- [x] TypeScript SDK
- [x] Test suite (14 tests)
- [ ] Mobile app (React Native — QR scan + confirm)
- [ ] Browser extension (popup confirmation)
- [ ] CPI integration examples (Jupiter, Raydium)
- [ ] CLI commit tool
- [ ] Devnet deployment
- [ ] Audit
- [ ] Mainnet launch

## Why "2FA"?

The same principle as Google Authenticator:

| | Traditional 2FA | IntentGuard |
|---|---|---|
| **What** | Login confirmation | Transaction confirmation |
| **Where** | Separate device | Separate device |
| **How** | TOTP code | On-chain hash commit |
| **Protects against** | Password theft | Frontend compromise |
| **Verification** | Server checks code | Program checks hash |

The key insight: **your browser is your password, your mobile is your authenticator.**

## License

MIT
