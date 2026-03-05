# Immunefi Bug Bounty Submission

> This document contains the information needed to submit the IntentGuard bug bounty to [immunefi.com](https://immunefi.com).

## Project Information

- **Project Name:** IntentGuard
- **Project Type:** Solana Smart Contract (Anchor)
- **Website:** https://selcuk07.github.io/intentguard/
- **GitHub:** https://github.com/selcuk07/intentguard
- **Documentation:** https://github.com/selcuk07/intentguard/blob/master/README.md
- **Threat Model:** https://github.com/selcuk07/intentguard/blob/master/THREAT-MODEL.md

## One-liner

On-chain 2FA for Solana — cryptographic intent verification that prevents frontend compromise attacks.

## Project Description

IntentGuard is a commit-reveal protocol with device separation that adds two-factor authentication to any Solana transaction. Users commit an intent hash from a trusted device (mobile/CLI), then the browser dApp verifies the hash on-chain before executing. If the frontend is compromised and changes transaction parameters, the hash mismatch causes the entire transaction to revert.

## Assets in Scope

### Smart Contracts

| Asset | Type | Severity | Link |
|-------|------|----------|------|
| IntentGuard Program | Solana Program | Critical | https://github.com/selcuk07/intentguard/tree/master/programs/intent-guard/src |
| Program ID | `4etWfDJNHhjYdv7fuGe236GDPguwUXVk9WhbEpQsPix7` | - | Devnet |

### SDKs

| Asset | Type | Severity | Link |
|-------|------|----------|------|
| TypeScript SDK | npm package | High | https://github.com/selcuk07/intentguard/tree/master/packages/sdk |
| Rust CPI Crate | crates.io | High | https://github.com/selcuk07/intentguard/tree/master/packages/cpi |

## Reward Tiers

| Severity | Smart Contract | SDK |
|----------|---------------|-----|
| Critical | $50,000 | $10,000 |
| High | $10,000 | $5,000 |
| Medium | $2,000 | $1,000 |
| Low | $500 | $200 |

## Impacts in Scope

### Critical

- Theft or permanent loss of user funds (SOL rent deposits)
- Unauthorized verification of another user's intent
- Bypassing hash verification (verifying with wrong hash succeeds)
- Re-using a closed IntentCommit PDA without a new commit transaction
- Cross-user or cross-app PDA access manipulation

### High

- Permanent protocol denial of service (bricking GuardConfig)
- Admin access control bypass (non-admin executing admin instructions)
- Counter manipulation (total_commits/total_verifies decrease or overflow)
- Bypassing pause mechanism
- Bypassing min_balance spam protection

### Medium

- Temporary protocol denial of service (> 1 hour)
- Griefing attacks costing victims > $100
- Incorrect TTL enforcement (expired intents being verified)
- Information leakage from on-chain data

### Low

- Gas optimization issues (> 10% CU reduction possible)
- Best practice violations that don't lead to exploitable vulnerabilities
- Minor SDK issues that don't affect on-chain security

## Out of Scope

- Attacks requiring compromised trusted device (mobile/CLI) — by design assumption
- Attacks requiring compromised admin key — documented risk, mitigated by future multisig
- Frontend/landing page vulnerabilities
- Chrome extension vulnerabilities (MVP/prototype)
- Issues already documented in THREAT-MODEL.md
- Theoretical attacks requiring > 2^128 operations
- Issues in test files, scripts, or CI/CD
- Third-party dependency vulnerabilities (report upstream)

## Program Overview

### Instructions (9 total)

| Instruction | Description | Access |
|-------------|-------------|--------|
| `initialize` | One-time protocol setup | Anyone (first caller) |
| `commit_intent` | Lock intent hash on-chain | Any user (when unpaused) |
| `verify_intent` | Verify hash match, close PDA | Intent owner only |
| `revoke_intent` | Cancel pending intent | Intent owner only |
| `pause_protocol` | Block new commits | Admin only |
| `unpause_protocol` | Resume commits | Admin only |
| `transfer_admin` | Change admin authority | Admin only |
| `update_config` | Update min_balance | Admin only |
| `migrate_config` | Resize config PDA | Admin only |

### PDA Structure

- **IntentCommit:** `[b"intent", user, app_id]` — one per user per app
- **GuardConfig:** `[b"config"]` — singleton, global state

### Key Security Properties

1. Hash integrity: `verify_intent` checks `commit.intent_hash == provided_hash`
2. Access control: PDAs derived from user pubkey, `has_one = user` constraint
3. TTL enforcement: `Clock::get().unix_timestamp <= commit.expires_at`
4. Pause enforcement: `require!(!config.is_paused, ...)`
5. Spam protection: `require!(user.lamports() >= config.min_balance, ...)`
6. PDA uniqueness: `init` constraint prevents duplicate commits

### Testing

- 29 integration tests (Anchor/Mocha)
- Trident fuzzing: 8 flows, 5,000 iterations, ~1,000,000 instructions, 0 violations
- Threat model: 12 attack vectors analyzed

## KYC / Contact

- **Primary contact:** security@intentguard.dev
- **GitHub:** @selcuk07
- **Response SLA:** 48h acknowledgment, 7d initial assessment

## Submission Steps

1. Go to https://immunefi.com/get-started/
2. Click "List a Bug Bounty"
3. Fill in project details from this document
4. Upload SECURITY.md as the security policy
5. Set reward tiers as listed above
6. Submit for review

## Alternative: Self-hosted Bug Bounty

If Immunefi listing is pending, the SECURITY.md in the repo serves as the self-hosted bug bounty policy. Researchers can email security@intentguard.dev directly.
