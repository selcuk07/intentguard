# IntentGuard

[![CI](https://github.com/selcuk07/intentguard/actions/workflows/ci.yml/badge.svg)](https://github.com/selcuk07/intentguard/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/intentguard-sdk?color=10b981)](https://www.npmjs.com/package/intentguard-sdk)
[![crates.io](https://img.shields.io/crates/v/intentguard-cpi?color=10b981)](https://crates.io/crates/intentguard-cpi)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

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
+--------------------+                 +--------------------+
|   Trusted Device   |                 |    Browser/dApp    |
|  (Mobile / CLI)    |                 |   (Untrusted)      |
+--------------------+                 +--------------------+
|                    |                 |                    |
|  1. User sees:     |                 |                    |
|     "Swap 100 USDC |                 |                    |
|      for SOL on    |                 |                    |
|      Jupiter"      |                 |                    |
|                    |                 |                    |
|  2. Confirms ->    |                 |                    |
|     TX1: commit    |---- hash ---->  |  3. Detects commit |
|     intent hash    |   on-chain      |     on-chain       |
|                    |                 |                    |
|                    |                 |  4. Executes TX2:  |
|                    |                 |     swap + verify  |
|                    |                 |     intent         |
|                    |                 |                    |
|                    |                 |  Hash matches ->   |
|                    |                 |     TX succeeds    |
|                    |                 |                    |
|                    |                 |  Hash mismatch ->  |
|                    |                 |     TX reverts     |
+--------------------+                 +--------------------+
```

**Even if the browser is fully compromised after step 2, the attacker cannot change the transaction parameters.** The hash is already locked on-chain from the trusted device.

## How It Works

### 1. Commit (Trusted Device -> On-chain)

User confirms intent parameters on their mobile app or CLI. The app computes a SHA-256 hash and sends a `commit_intent` transaction to Solana.

```typescript
import { computeIntentHash } from 'intentguard-sdk';

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

### 2. Verify (Browser -> On-chain)

The dApp detects the on-chain IntentCommit PDA and includes a `verify_intent` call in the same transaction as the target action. IntentGuard checks the hash and closes the PDA.

```typescript
// Browser detects commit exists, adds verify instruction
await program.methods
  .verifyIntent(hash)
  .accounts({ ... })
  .rpc();

// If hash matches -> PDA closed, rent refunded, dApp proceeds
// If hash doesn't match -> TX reverts, funds are safe
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

### On-chain Program (~530 lines Rust)

| Instruction | Description |
|---|---|
| `initialize` | One-time protocol setup (admin config) |
| `commit_intent` | Lock intent hash on-chain (TX1 from trusted device) |
| `verify_intent` | Verify hash match and close PDA (TX2 from dApp) |
| `revoke_intent` | Cancel pending intent, refund rent |
| `pause_protocol` | Admin: block new commits (emergency) |
| `unpause_protocol` | Admin: resume commits |
| `transfer_admin` | Admin: change authority |
| `update_config` | Admin: tune spam protection (min_balance) |
| `migrate_config` | Admin: safe realloc for config PDA upgrades |

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

Global protocol state with admin controls, lifetime counters, and spam protection settings.

| Field | Type | Description |
|---|---|---|
| `admin` | `Pubkey` | Protocol authority |
| `is_paused` | `bool` | Emergency pause flag |
| `total_commits` | `u64` | Lifetime commit counter |
| `total_verifies` | `u64` | Lifetime verify counter |
| `min_balance` | `u64` | Minimum SOL balance to commit (spam protection) |
| `bump` | `u8` | PDA bump |

### Security Properties

| Attack | Protection |
|---|---|
| Frontend compromise (after commit) | Hash is locked on-chain — changing params breaks the hash |
| Replay attack | PDA is closed after verification — can't reuse |
| Stale intent | TTL enforced (30s-1h, default 5min) |
| Cross-app attack | Per-app PDA isolation — Jupiter intent can't verify on Raydium |
| Account theft | `has_one = user` constraint — only owner can verify/revoke |
| Spam / dust attacks | Configurable min_balance (default 0.01 SOL), admin-tunable up to 1 SOL |
| Protocol compromise | Emergency pause, admin transfer, rate limiting (1 intent per user per app) |

## Devnet Deployment

IntentGuard is live on Solana devnet:

| Resource | Address |
|---|---|
| **Program** | `4etWfDJNHhjYdv7fuGe236GDPguwUXVk9WhbEpQsPix7` |
| **IDL** | `Dvn2qXEn4cvPW4fGEwjJ723gcvSdfooS2AVyqmyZxRKW` |
| **Config PDA** | `6atm7ijvFwoRnDsJKz6yaYbKBMBuqvTXqHTtbNUieKCj` |

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
use intentguard_cpi::{verify_intent_cpi, VerifyAccounts};

// In your program's instruction handler:
verify_intent_cpi(accounts, intent_hash)?;
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
├── programs/intent-guard/       # Anchor program (9 instructions, ~530 lines)
│   └── src/
│       ├── lib.rs               # Program entrypoint
│       ├── state.rs             # IntentCommit, GuardConfig
│       ├── errors.rs            # Error codes
│       └── instructions/        # Instruction handlers
│           ├── initialize.rs    # Protocol setup
│           ├── commit_intent.rs # Lock intent hash
│           ├── verify_intent.rs # Verify + close PDA
│           ├── revoke_intent.rs # Cancel intent
│           └── admin.rs         # Pause, unpause, transfer, config
├── packages/
│   ├── sdk/                     # TypeScript SDK (npm: intentguard-sdk)
│   │   └── src/
│   │       ├── client.ts        # computeIntentHash, getIntentCommit
│   │       ├── instructions.ts  # Instruction builders (no Anchor dep)
│   │       ├── pdas.ts          # PDA derivation helpers
│   │       ├── constants.ts     # Program ID, defaults
│   │       └── react.tsx        # <IntentGuardButton /> component
│   └── cpi/                     # Rust CPI crate (crates.io: intentguard-cpi)
│       └── src/lib.rs           # CPI helpers + PDA finders
├── cli/                         # CLI tool (commit, status, revoke)
│   └── src/commands/
├── app/                         # React Native mobile app (Expo)
│   └── src/
│       ├── screens/             # Scan, Confirm, Home
│       └── utils/
├── extension/                   # Chrome extension (Manifest V3)
│   └── src/                     # Popup, content script, background
├── examples/                    # Integration examples
│   ├── full-flow.ts             # Commit -> verify -> close
│   ├── protected-swap.ts        # Jupiter swap with IntentGuard
│   ├── protected-transfer.ts    # SPL token transfer with IntentGuard
│   └── cpi-integration.rs       # Rust CPI example
├── landing/                     # GitHub Pages site
│   ├── index.html               # Landing page
│   ├── dashboard.html           # Live devnet stats dashboard
│   └── api-docs/                # TypeDoc API reference
├── tests/
│   └── intent-guard.ts          # 29 integration tests
├── trident-tests/               # Trident fuzzing (8 flows, ~1M instructions)
│   └── fuzz_0/test_fuzz.rs
├── scripts/
│   └── devnet-demo.ts           # Live devnet demo
├── THREAT-MODEL.md              # 12 attack vectors analyzed
├── SECURITY.md                  # Bug bounty policy (up to $50K)
├── GRANT-APPLICATION.md         # Solana grant application
└── Anchor.toml
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

# Build with dev-testing feature (relaxed TTL + min_balance for tests)
anchor build -- --features dev-testing
```

### Test

```bash
# Run all tests (29 tests)
anchor test

# Skip build if already compiled
anchor test --skip-build

# Run fuzz tests (requires nightly Rust)
cd trident-tests && cargo +nightly run --bin fuzz_0
```

### Dependency Pins

Platform-tools ships rustc 1.79.0. The following pins are required:

```bash
cargo update -p indexmap --precise 2.11.4
cargo update -p proc-macro-crate@3.5.0 --precise 3.2.0
```

## SDK

### TypeScript SDK

```bash
npm install intentguard-sdk
```

```typescript
import {
  computeIntentHash,
  getIntentCommit,
  findIntentCommitPda,
  findConfigPda,
  INTENT_GUARD_PROGRAM_ID,
  // Instruction builders (no Anchor dependency)
  createCommitIntentInstruction,
  createVerifyIntentInstruction,
  createRevokeIntentInstruction,
  createPauseProtocolInstruction,
  createUnpauseProtocolInstruction,
  createTransferAdminInstruction,
} from 'intentguard-sdk';

// React component
import { IntentGuardButton } from 'intentguard-sdk/react';
```

### Rust CPI Crate

```toml
[dependencies]
intentguard-cpi = "0.2"
```

```rust
use intentguard_cpi::{
    commit_intent_cpi, verify_intent_cpi, revoke_intent_cpi,
    pause_protocol_cpi, unpause_protocol_cpi, transfer_admin_cpi,
    find_intent_commit_pda, find_config_pda,
};
```

## Security

IntentGuard takes security seriously. See [SECURITY.md](SECURITY.md) for our bug bounty policy.

- **Threat model:** 12 attack vectors analyzed — [THREAT-MODEL.md](THREAT-MODEL.md)
- **Fuzzing:** Trident — 8 flows, 5K iterations, ~1M instructions, 0 violations
- **Tests:** 29 integration tests covering all instructions and attack vectors
- **Admin controls:** Emergency pause, admin transfer, configurable spam protection
- **Spam protection:** Configurable min_balance (0.01 SOL default, max 1 SOL)
- **Rate limiting:** 1 active intent per user per app (PDA init constraint)
- **Bug bounty:** Up to $50K for critical vulnerabilities

Report vulnerabilities to **security@intentguard.dev**.

## Live Dashboard

Real-time protocol stats are available at the [IntentGuard Dashboard](https://selcuk07.github.io/intentguard/dashboard.html):

- Total commits and verifies
- Verify rate
- Protocol pause status
- Intent lookup by wallet

## Roadmap

- [x] On-chain program (9 instructions, ~530 lines)
- [x] TypeScript SDK v0.2.0 (npm: `intentguard-sdk`)
- [x] Rust CPI crate v0.2.0 (crates.io: `intentguard-cpi`)
- [x] CLI commit tool
- [x] React Native mobile app (Expo)
- [x] Chrome browser extension
- [x] React `<IntentGuardButton />` component
- [x] Devnet deployment + live demo
- [x] Test suite (29 tests + Trident fuzzing)
- [x] Threat model (12 attack vectors)
- [x] Bug bounty program (up to $50K)
- [x] Live dashboard + API docs
- [x] First integration: [ACELaunch](https://github.com/selcuk07/acelaunch) (IntentProof)
- [ ] External audit
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
