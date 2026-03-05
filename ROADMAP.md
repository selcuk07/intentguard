# IntentGuard Roadmap

## Phase 0 — Foundation ✅ DONE

- [x] On-chain program: `commit_intent`, `verify_intent`, `revoke_intent`, `initialize`
- [x] PDA design: per-user per-app isolation (`[b"intent", user, app_id]`)
- [x] TTL system: configurable 30s–1h, default 5min
- [x] Global counters: `total_commits`, `total_verifies`
- [x] Protocol admin: `GuardConfig` with pause capability
- [x] TypeScript SDK: `computeIntentHash`, `findIntentCommitPda`, `getIntentCommit`
- [x] Test suite: 14 tests covering full flow, access control, TTL, multi-app
- [x] README with integration guide
- [x] BPF build: 231KB .so, IDL generated

## Phase 1 — CLI + Devnet ✅ DONE

### CLI Commit Tool
- [x] `intentguard commit` — commit intent from terminal with keypair
- [x] `intentguard status` — check pending intents for a wallet
- [x] `intentguard revoke` — cancel pending intent
- [x] JSON config file support (app presets)
- [ ] Ledger hardware wallet support

### Devnet Deployment
- [x] Deploy program to Solana devnet (`4etWfDJNHhjYdv7fuGe236GDPguwUXVk9WhbEpQsPix7`)
- [x] Update program ID in Anchor.toml, SDK constants, README
- [x] Publish IDL on-chain (`Dvn2qXEn4cvPW4fGEwjJ723gcvSdfooS2AVyqmyZxRKW`)
- [x] SDK points to devnet by default
- [x] Live devnet demo with real TX signatures

### Integration Examples
- [x] Example: IntentGuard + SPL Token transfer
- [x] Example: IntentGuard + Jupiter swap (protected-swap.ts)
- [x] CPI integration example (Rust)
- [x] Full flow example (TypeScript — commit → verify → close)

## Phase 2 — Mobile App + Widget ✅ DONE

### React Native App (Expo)
- [x] QR code scanner screen (expo-camera)
- [x] Intent confirmation screen (human-readable params)
- [x] Embedded keypair with biometric unlock (expo-secure-store + expo-local-authentication)
- [x] TX signing + submission to Solana RPC
- [ ] Push notification when intent is verified or expires
- [ ] TestFlight / Play Store beta

### QR Protocol
- [x] QR payload: `{ protocol: 'intentguard', version, app, action, params, display }`
- [x] Human-readable display (action + description)
- [ ] Anti-phishing: app registry with verified names + icons
- [ ] Deep link support: `intentguard://commit?...`

### Frontend Widget
- [x] `<IntentGuardButton />` React component
- [x] States: idle → show QR → waiting for commit → verified → expired
- [x] Polling for IntentCommit PDA detection
- [ ] WebSocket mode for faster detection
- [ ] Fallback: manual hash entry for CLI users

## Phase 3 — SDK + Publishing ✅ DONE

### TypeScript SDK
- [x] `intentguard-sdk` on npm (v0.1.0)
- [x] Instruction builders (no Anchor dependency)
- [x] CJS + ESM dual output
- [x] React component via subpath export
- [x] SDK README with API docs

### Rust CPI Crate
- [x] `intentguard-cpi` on crates.io (v0.1.0)
- [x] `verify_intent_cpi()`, `commit_intent_cpi()`, `revoke_intent_cpi()`
- [x] `find_intent_commit_pda()`, `find_config_pda()` helpers
- [ ] Anchor constraint macro: `#[intent_guard(hash = ...)]`

### Infrastructure
- [x] GitHub public repo with MIT license
- [x] GitHub Actions CI (SDK build + Rust check)
- [x] GitHub Pages landing page with badges
- [x] GitHub Release v0.1.0
- [x] Grant application document
- [x] Twitter announcement thread draft

## Phase 4 — Browser Extension (Week 6–7)

### Chrome/Firefox Extension
- [ ] Intercepts wallet `signTransaction` calls
- [ ] Shows popup: "Confirm this transaction with IntentGuard?"
- [ ] Displays decoded parameters (token amounts, destinations)
- [ ] Sends push to mobile app for confirmation
- [ ] Blocks TX submission until intent is verified on-chain
- [ ] Bypass list: trusted dApps that don't need 2FA

### Extension ↔ Mobile Pairing
- [ ] One-time QR pairing (like WhatsApp Web)
- [ ] Encrypted WebSocket channel for real-time communication
- [ ] Device management: pair/unpair multiple devices

## Phase 5 — Partner Integrations (Week 8–10)

### Integrations
- [x] ACELaunch: auction bid intent verification (IntentProof — live on devnet)
- [ ] Jupiter: swap intent verification
- [ ] Raydium: LP add/remove intent verification
- [ ] Tensor/Magic Eden: NFT purchase intent verification
- [ ] Marinade: stake/unstake intent verification

### App Registry
- [ ] On-chain registry of verified app names + metadata
- [ ] Mobile app resolves `app_id` → human-readable name + icon
- [ ] Governance for registry additions (prevent spoofing)

## Phase 6 — Security + Audit (Week 11–13)

### Security Hardening
- [ ] Formal threat model document
- [ ] Fuzzing with Trident or custom harness
- [ ] Rate limiting: max N commits per user per epoch
- [ ] Spam protection: minimum SOL balance to commit
- [ ] Emergency pause tested end-to-end

### Audit
- [ ] Select audit firm (OtterSec, Neodyme, Halborn, Trail of Bits)
- [ ] Scope: 1 program (~300 lines Rust) + SDK
- [ ] Fix all findings
- [ ] Publish audit report

### Bug Bounty
- [ ] Immunefi listing
- [ ] Bounty tiers: Critical ($50K), High ($10K), Medium ($2K)

## Phase 7 — Mainnet + SDK v1.0 (Week 14–16)

### Mainnet Deployment
- [ ] Deploy program to Solana mainnet-beta
- [ ] Multisig upgrade authority (Squads)
- [ ] Monitor: Helius webhooks for commit/verify events
- [ ] Dashboard: real-time stats (commits, verifies, unique users)

### SDK v1.0
- [ ] Full API docs (TypeDoc)
- [ ] Integration examples repo
- [ ] Video tutorial: "Add 2FA to your Solana dApp in 10 minutes"

### Mobile App v1.0
- [ ] iOS App Store submission
- [ ] Google Play Store submission
- [ ] Onboarding flow: wallet connect → first intent → tutorial
- [ ] Analytics: anonymous usage metrics

## Phase 8 — Growth + Protocol Revenue (Week 17+)

### Protocol Economics
- [ ] Optional fee per verify (configurable, starts at 0)
- [ ] Premium tier: priority verification, analytics dashboard
- [ ] Staking: IG token for governance + fee sharing (if tokenized)

### Ecosystem Growth
- [ ] Solana Foundation grant application
- [ ] Wallet-native integration (Phantom, Solflare built-in support)
- [ ] Multi-chain: EVM version (Ethereum, Base, Arbitrum)
- [ ] API: hosted verification service for Web2 integrations
- [ ] Enterprise: custom deployment for institutional clients

### Community
- [x] Open-source all components (MIT license)
- [ ] Developer documentation site
- [ ] Discord community
- [ ] Ambassador program for dApp integrations
- [ ] Hackathon bounties: "Build with IntentGuard"

---

## Key Metrics

| Milestone | Target | Status |
|---|---|---|
| Foundation complete | Week 0 | ✅ |
| CLI + Devnet deploy | Week 1 | ✅ |
| Mobile app MVP | Week 2 | ✅ |
| npm + crates.io publish | Week 2 | ✅ |
| CI/CD + Landing page | Week 2 | ✅ |
| First integration (ACELaunch) | Week 2 | ✅ |
| Mobile app TestFlight | Week 5 | |
| Browser extension MVP | Week 7 | |
| Audit complete | Week 13 | |
| Mainnet launch | Week 16 | |
| 10 integrated dApps | Week 20 | |
| 1,000 daily active users | Week 24 | |

## Revenue Model

| Stream | When | Description |
|---|---|---|
| **Free tier** | Launch | Unlimited commits + verifies (adoption priority) |
| **Premium API** | Month 3 | Hosted verification, analytics, webhooks |
| **Enterprise** | Month 6 | Custom deployment, SLA, dedicated support |
| **Protocol fee** | Month 9+ | Optional per-verify fee (governance vote to enable) |
| **Grants** | Ongoing | Solana Foundation, ecosystem funds |

## Competitive Advantage

No one else is building this for Solana. The closest alternatives:

| Solution | Limitation |
|---|---|
| Wallet simulation | Frontend can spoof simulation results |
| Hardware wallet display | Shows hex, not human-readable params |
| Multisig (Squads) | Too heavy for individual users, adds latency |
| Transaction firewall (Blowfish) | Centralized service, single point of failure |

IntentGuard is **on-chain, permissionless, and device-separated** — the only solution where a compromised browser literally cannot change your transaction.
