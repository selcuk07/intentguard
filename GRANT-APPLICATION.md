# IntentGuard — Solana Foundation Grant Application

## One-Liner
**IntentGuard is a 2FA protocol for Solana transactions** — users confirm intent from a trusted device before execution, making frontend compromises ineffective.

## Problem

Solana dApp users are vulnerable to **frontend attacks**:
- A compromised frontend shows "Swap 10 USDC" but signs "Swap 10,000 USDC"
- Wallet simulation can be spoofed if the frontend itself is hijacked
- Hardware wallets display raw hex — humans can't verify parameters
- **One compromised frontend = drained wallet**

In 2024–2025, over $200M was lost to frontend compromises, DNS hijacks, and approval phishing across EVM and Solana ecosystems.

## Solution

IntentGuard adds a **commit-reveal pattern with device separation**:

```
Mobile (trusted)              Browser (untrusted)
     │                              │
     │  1. User sees params         │
     │  2. Confirms → commit_intent │
     │     (hash on-chain) ────────►│ 3. Detects commit
     │                              │ 4. verify_intent + action
     │                              │    ✅ hash match → succeeds
     │                              │    ❌ mismatch  → reverts
```

**Even if the browser is fully compromised after step 2, the attacker cannot change transaction parameters.** The hash is locked on-chain from the trusted device.

## What We've Built (Phase 1 — Complete)

| Component | Status |
|-----------|--------|
| On-chain program (Anchor 0.32.1) | ✅ Deployed to devnet |
| 4 instructions (init, commit, verify, revoke) | ✅ Working |
| 14 integration tests | ✅ All passing |
| TypeScript SDK (`@intentguard/sdk`) | ✅ Built (CJS + ESM) |
| Instruction builders (no Anchor dep) | ✅ Ready |
| React `IntentGuardButton` component | ✅ Built |
| CLI tool | ✅ Tested on devnet |
| React Native mobile app (Expo) | ✅ QR scan + biometric auth |
| Landing page | ✅ Live on GitHub Pages |
| CI/CD pipeline | ✅ GitHub Actions |
| CPI integration example | ✅ Documented |
| Live devnet demo | ✅ Verified with real TXs |

### Devnet Proof
- **Program**: `4etWfDJNHhjYdv7fuGe236GDPguwUXVk9WhbEpQsPix7`
- **IDL**: Published on-chain (`Dvn2qXEn4cvPW4fGEwjJ723gcvSdfooS2AVyqmyZxRKW`)
- **Demo TXs**: Commit + Verify flow verified on Solana Explorer

## Architecture

```
┌─────────────────────────────────────────────────┐
│                 IntentGuard Protocol              │
├──────────────┬──────────────┬────────────────────┤
│ commit_intent│ verify_intent│  revoke_intent     │
│ (mobile/CLI) │ (browser CPI)│  (cancel anytime)  │
├──────────────┴──────────────┴────────────────────┤
│          IntentCommit PDA [intent,user,app]       │
│          GuardConfig PDA  [config]                │
├──────────────────────────────────────────────────┤
│                  Solana Runtime                    │
└──────────────────────────────────────────────────┘
```

**Key design choices:**
- **Per-user per-app PDA isolation** — Jupiter intent can't be used on Raydium
- **TTL enforcement** (30s–1h) — stale intents auto-expire
- **Atomic close** — PDA destroyed on verification, rent refunded
- **Zero token requirement** — no governance token, no staking
- **CPI-composable** — any program can call `verify_intent`

## Use Cases

1. **DEX swaps** — Verify swap parameters before execution (Jupiter, Raydium, Orca)
2. **Token transfers** — Confirm recipient and amount on mobile before sending
3. **NFT purchases** — Verify collection, price, and mint before buying
4. **Governance** — Confirm vote parameters on trusted device
5. **Bridge transactions** — Verify destination chain, token, and amount
6. **Auction bids** — Verify bid amount and auction (ACELaunch — our first integration)

## Team

- **Selcuk** — Full-stack Solana developer. Built ACELaunch (sealed-bid auction platform) with 3 on-chain programs, 247 tests, live on devnet. 6 security audits completed.

## Grant Request

**$25,000** for Phase 2–3 development:

| Phase | Deliverable | Timeline |
|-------|-------------|----------|
| Phase 2 | Mobile app TestFlight + Play Store beta | 4 weeks |
| Phase 3 | npm publish, Jupiter/Raydium integration demos | 2 weeks |
| Phase 4 | Security audit (external) | 4 weeks |
| Phase 5 | Mainnet deployment + 3 dApp integrations | 4 weeks |

## Competitive Advantage

| Feature | IntentGuard | Wallet Simulation | Hardware Wallet |
|---------|-------------|-------------------|-----------------|
| Frontend compromise protection | ✅ | ❌ (spoofable) | ⚠️ (raw hex) |
| Human-readable verification | ✅ (mobile app) | ⚠️ | ❌ |
| No hardware required | ✅ (phone) | ✅ | ❌ ($100+) |
| Works with any dApp | ✅ (CPI) | ✅ | ✅ |
| On-chain proof | ✅ (PDA) | ❌ | ❌ |
| Composable (other programs) | ✅ | ❌ | ❌ |

## Links

- **GitHub**: https://github.com/selcuk07/intentguard
- **Landing Page**: https://selcuk07.github.io/intentguard
- **Devnet Program**: [Explorer](https://explorer.solana.com/address/4etWfDJNHhjYdv7fuGe236GDPguwUXVk9WhbEpQsPix7?cluster=devnet)
- **ACELaunch** (first customer): https://github.com/selcuk07/acelaunch

## Why Solana Needs This

Solana's speed is its superpower — but it also means transactions execute before users can react. IntentGuard adds a deliberate confirmation step without sacrificing UX:

- **400ms block time** means a compromised TX executes instantly
- **No mempool** means MEV bots can't front-run, but frontend attacks are worse
- **Mobile-first users** need protection that works on phones, not hardware wallets

IntentGuard turns every Solana user's phone into a hardware wallet — cryptographic verification, human-readable confirmation, zero hardware cost.
