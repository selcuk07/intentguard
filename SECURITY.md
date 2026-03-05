# Security Policy

## Bug Bounty Program

IntentGuard runs a bug bounty program to reward security researchers who find vulnerabilities in the protocol.

### Scope

**In scope:**

| Component | Repository | Technology |
|-----------|-----------|------------|
| On-chain program | `programs/intent-guard/` | Rust / Anchor 0.32.1 |
| TypeScript SDK | `packages/sdk/` | TypeScript |
| CPI crate | `packages/cpi/` | Rust |

**Out of scope:**
- Landing page (`landing/`)
- Chrome extension (`extension/`) — MVP, not production
- Mobile app (`mobile/`) — prototype
- CLI tool (`cli/`) — developer tooling
- Test files, scripts, CI/CD configuration
- Third-party dependencies (report upstream)

### Severity & Rewards

| Severity | Description | Reward |
|----------|-------------|--------|
| **Critical** | Loss of funds, unauthorized intent verification, bypass of hash check | Up to $50,000 |
| **High** | Protocol DoS (permanent), admin key bypass, counter manipulation | Up to $10,000 |
| **Medium** | Temporary DoS, griefing attacks with cost > $100, information leak | Up to $2,000 |
| **Low** | Best practice violations, gas optimization, cosmetic issues | Up to $500 |

### Critical Vulnerabilities (Examples)

- Verifying an intent with a different hash than what was committed
- Verifying/revoking another user's intent without their signature
- Bypassing the pause mechanism to commit while paused
- Re-using a closed IntentCommit PDA without a new commit
- Manipulating PDA seeds to achieve cross-app or cross-user access
- Integer overflow/underflow leading to incorrect expiry or counters

### High Vulnerabilities (Examples)

- Permanently bricking the GuardConfig PDA
- Bypassing `min_balance` spam protection
- Non-admin calling admin-only instructions
- Causing `total_commits` or `total_verifies` to decrease or overflow
- Making the protocol permanently unusable

### What We Are NOT Looking For

- Attacks requiring admin key compromise (documented in THREAT-MODEL.md A7)
- Attacks requiring compromised trusted device (documented in THREAT-MODEL.md A2)
- Theoretical attacks requiring > 2^128 hash operations
- Frontend-only issues (the protocol is designed to protect against frontend compromise)
- Issues already documented in THREAT-MODEL.md

### Program Details

| Detail | Value |
|--------|-------|
| Program ID | `4etWfDJNHhjYdv7fuGe236GDPguwUXVk9WhbEpQsPix7` |
| Network | Solana Devnet (mainnet deployment pending) |
| Language | Rust (Anchor 0.32.1) |
| Lines of code | ~350 (on-chain program) |
| Test coverage | 29 integration tests + Trident fuzzing (1M+ instructions) |
| IDL | On-chain at `Dvn2qXEn4cvPW4fGEwjJ723gcvSdfooS2AVyqmyZxRKW` |

### Rules

1. **Do not** test against mainnet or disrupt devnet for other users
2. **Do not** access other users' data or accounts
3. **Do not** publicly disclose before fix is deployed
4. Provide clear reproduction steps (localnet preferred)
5. One report per vulnerability
6. First reporter wins in case of duplicates

### How to Report

**Email:** security@intentguard.dev

Include:
- Vulnerability description
- Step-by-step reproduction (localnet test preferred)
- Impact assessment
- Suggested fix (optional)

We will acknowledge receipt within 48 hours and provide an initial assessment within 7 days.

### Safe Harbor

We consider security research conducted in good faith to be authorized. We will not pursue legal action against researchers who:

- Act in good faith and avoid privacy violations, data destruction, and service disruption
- Only interact with accounts they own or have explicit permission to test
- Report vulnerabilities promptly and do not exploit them beyond what is necessary for the report
- Do not publicly disclose before we have had reasonable time to address the issue (90 days)

### Response Timeline

| Phase | Timeline |
|-------|----------|
| Acknowledgment | 48 hours |
| Initial assessment | 7 days |
| Fix development | 14 days (critical), 30 days (high/medium) |
| Reward payment | 14 days after fix deployment |

### Audit Status

- **Trident fuzzing:** 8 flows, 5,000 iterations, ~1M instructions — 0 violations
- **Integration tests:** 29 tests covering all instructions and attack vectors
- **Threat model:** 12 attack vectors analyzed (see THREAT-MODEL.md)
- **External audit:** Pending (pre-mainnet requirement)

## Supported Versions

| Version | Supported |
|---------|-----------|
| Devnet (current) | ✅ Active bounty |
| Mainnet (future) | ✅ Will be covered |

## Contact

- Security reports: security@intentguard.dev
- General questions: [GitHub Issues](https://github.com/selcuk07/intentguard/issues)
