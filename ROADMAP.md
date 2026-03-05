# IntentGuard Roadmap

## Phase 0 — Foundation (DONE)

- [x] On-chain program: `commit_intent`, `verify_intent`, `revoke_intent`, `initialize`
- [x] PDA design: per-user per-app isolation (`[b"intent", user, app_id]`)
- [x] TTL system: configurable 30s–1h, default 5min
- [x] Global counters: `total_commits`, `total_verifies`
- [x] Protocol admin: `GuardConfig` with pause capability
- [x] TypeScript SDK: `computeIntentHash`, `findIntentCommitPda`, `getIntentCommit`
- [x] Test suite: 14 tests covering full flow, access control, TTL, multi-app
- [x] README with integration guide
- [x] BPF build: 231KB .so, IDL generated

## Phase 1 — CLI + Devnet (Week 1–2)

### CLI Commit Tool
- [ ] `intentguard commit` — commit intent from terminal with keypair
- [ ] `intentguard status` — check pending intents for a wallet
- [ ] `intentguard revoke` — cancel pending intent
- [ ] JSON config file support (app presets: Jupiter, Raydium, etc.)
- [ ] Keypair file + Ledger hardware wallet support

### Devnet Deployment
- [ ] Deploy program to Solana devnet
- [ ] Update program ID in Anchor.toml, SDK constants, README
- [ ] Publish IDL on-chain (`anchor idl init`)
- [ ] SDK points to devnet by default

### Integration Example
- [ ] Example: IntentGuard + SPL Token transfer (simplest possible demo)
- [ ] Example: IntentGuard + Jupiter swap (real-world use case)
- [ ] Step-by-step integration tutorial in docs

## Phase 2 — Mobile App MVP (Week 3–5)

### React Native App (Expo)
- [ ] QR code scanner screen
- [ ] Intent confirmation screen (human-readable params)
- [ ] Wallet connection (Solana Mobile Wallet Adapter)
- [ ] Alternative: embedded keypair with biometric unlock
- [ ] TX signing + submission to Solana RPC
- [ ] Push notification when intent is verified or expires

### QR Protocol
- [ ] Deep link format: `intentguard://commit?app=<id>&hash=<hex>&params=<json>`
- [ ] QR contains: app name, human-readable action, amount, destination
- [ ] Anti-phishing: app registry with verified names + icons
- [ ] Expiry encoded in QR (prevents stale scans)

### Frontend Widget
- [ ] `<IntentGuardButton />` React component for dApp integration
- [ ] States: idle → show QR → waiting for commit → verified → proceed
- [ ] WebSocket/polling for IntentCommit PDA detection
- [ ] Fallback: manual hash entry for CLI users

## Phase 3 — Browser Extension (Week 6–7)

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

## Phase 4 — CPI Framework + Partner Integrations (Week 8–10)

### CPI SDK (Rust)
- [ ] `intentguard-cpi` crate on crates.io
- [ ] `verify_intent_cpi()` helper function
- [ ] Anchor constraint macro: `#[intent_guard(hash = ...)]`
- [ ] Optional vs mandatory mode (dApps choose enforcement level)

### Partner Integrations
- [ ] Jupiter: swap intent verification
- [ ] Raydium: LP add/remove intent verification
- [ ] Tensor/Magic Eden: NFT purchase intent verification
- [ ] Marinade: stake/unstake intent verification
- [ ] ACELaunch: auction bid intent verification (dogfooding)

### App Registry
- [ ] On-chain registry of verified app names + metadata
- [ ] Mobile app resolves `app_id` → human-readable name + icon
- [ ] Governance for registry additions (prevent spoofing)

## Phase 5 — Security + Audit (Week 11–13)

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

## Phase 6 — Mainnet + SDK Launch (Week 14–16)

### Mainnet Deployment
- [ ] Deploy program to Solana mainnet-beta
- [ ] Multisig upgrade authority (Squads)
- [ ] Monitor: Helius webhooks for commit/verify events
- [ ] Dashboard: real-time stats (commits, verifies, unique users)

### SDK v1.0
- [ ] `@intentguard/sdk` on npm
- [ ] `intentguard-cpi` on crates.io
- [ ] Full API docs (TypeDoc)
- [ ] Integration examples repo
- [ ] Video tutorial: "Add 2FA to your Solana dApp in 10 minutes"

### Mobile App v1.0
- [ ] iOS App Store submission
- [ ] Google Play Store submission
- [ ] Onboarding flow: wallet connect → first intent → tutorial
- [ ] Analytics: anonymous usage metrics

## Phase 7 — Growth + Protocol Revenue (Week 17+)

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
- [ ] Open-source all components (MIT license)
- [ ] Developer documentation site
- [ ] Discord community
- [ ] Ambassador program for dApp integrations
- [ ] Hackathon bounties: "Build with IntentGuard"

---

## Key Metrics

| Milestone | Target |
|---|---|
| Devnet deploy | Week 2 |
| First external integration | Week 5 |
| Mobile app testflight | Week 5 |
| Audit complete | Week 13 |
| Mainnet launch | Week 16 |
| 10 integrated dApps | Week 20 |
| 1,000 daily active users | Week 24 |
| 10,000 daily intents | Week 30 |

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
