# IntentGuard Threat Model

## Overview

IntentGuard is a commit-reveal protocol with device separation. This document analyzes attack vectors, mitigations, and residual risks.

## Trust Assumptions

1. **The trusted device (mobile/CLI) is not compromised** — if both devices are compromised, no 2FA can help
2. **Solana runtime is correct** — PDA derivation, signature verification, and CPI work as documented
3. **SHA-256 is collision-resistant** — finding two different intents with the same hash is computationally infeasible
4. **RPC nodes return accurate data** — the browser correctly detects IntentCommit PDAs on-chain

## Attack Vectors

### A1. Frontend Compromise (Primary Threat — MITIGATED)

**Attack**: Attacker controls the browser/dApp and changes transaction parameters after user commits intent.

**Mitigation**: The intent hash is locked on-chain by the trusted device. Even if the attacker changes parameters in the browser, the hash won't match and `verify_intent` reverts.

**Residual risk**: None, by design. This is IntentGuard's core value proposition.

### A2. Mobile Device Compromise

**Attack**: Attacker controls the mobile app and commits a malicious intent hash.

**Mitigation**: If the mobile device is compromised, the attacker controls the "trusted" device — this is equivalent to the user approving the malicious transaction themselves. No 2FA system can protect against this.

**Residual risk**: Same as any 2FA — if the second factor is compromised, protection is lost. Biometric auth adds one more layer.

### A3. Replay Attack

**Attack**: Attacker observes a commit TX and tries to replay it to re-create the IntentCommit PDA after verification.

**Mitigation**:
- The PDA is derived from `[b"intent", user, app_id]` — only one can exist at a time
- `commit_intent` uses `init` constraint — fails if PDA already exists
- After `verify_intent`, the PDA is closed. Re-creating it requires a new signed TX from the user
- The `committed_at` timestamp changes, making old verify TXs invalid

**Residual risk**: None.

### A4. Stale Intent Attack

**Attack**: User commits an intent but forgets about it. Attacker later uses the stale commit to verify a different transaction.

**Mitigation**:
- TTL enforcement: intents expire after 30s–1h (configurable)
- `verify_intent` checks `expires_at` — expired intents cannot be verified
- Users can explicitly `revoke_intent` to cancel

**Residual risk**: Within the TTL window, a committed intent is valid. Users should use short TTLs for high-value transactions.

### A5. Cross-App Attack

**Attack**: User commits intent for App A (e.g., Jupiter). Attacker tries to use it to verify on App B (e.g., malicious program).

**Mitigation**: PDA seeds include `app_id` — `[b"intent", user, app_id]`. An intent committed for Jupiter cannot be used to verify on any other program. The PDA simply doesn't exist for the wrong app.

**Residual risk**: None.

### A6. Hash Preimage Attack

**Attack**: Attacker finds different parameters that produce the same SHA-256 hash as the user's intent.

**Mitigation**: SHA-256 is collision-resistant with 128-bit security. Finding a collision requires ~2^128 operations, which is computationally infeasible.

**Residual risk**: None with current cryptographic assumptions.

### A7. Admin Key Compromise

**Attack**: Attacker gains control of the admin key and pauses the protocol or transfers admin.

**Mitigation**:
- Admin can only pause/unpause and transfer admin — cannot steal funds or modify intents
- Pausing blocks new commits but doesn't affect existing verified transactions
- `transfer_admin` instruction enables moving to multisig (Squads) for production
- Monitor alerts on `pause_protocol`, `unpause_protocol`, `transfer_admin` events

**Residual risk**: Temporary DoS if admin key is compromised and protocol is paused. Mitigated by multisig upgrade to Squads.

### A8. PDA Squatting / Griefing

**Attack**: Attacker creates IntentCommit PDAs for victim users to block them from committing.

**Mitigation**: `commit_intent` requires the `user` to be a signer — only the user themselves can create their IntentCommit PDA. An attacker cannot create PDAs for other users.

**Residual risk**: None.

### A9. Rent Drain Attack

**Attack**: Attacker repeatedly creates and revokes intents to drain SOL through rent.

**Mitigation**:
- `revoke_intent` closes the PDA and returns rent to the user — no SOL is lost
- `verify_intent` also closes the PDA with `close = user`
- The only cost is transaction fees (~5000 lamports), which the attacker pays

**Residual risk**: None. The attacker spends their own SOL on transaction fees.

### A10. RPC Manipulation

**Attack**: Attacker runs a malicious RPC node that hides IntentCommit PDAs from the browser, causing the dApp to proceed without verification.

**Mitigation**:
- dApps should use multiple RPC endpoints for PDA detection
- The `verify_intent` instruction must be included in the same transaction — the program itself validates the PDA exists, not the frontend
- If the PDA is hidden, the dApp simply doesn't proceed (safe default)

**Residual risk**: If the dApp doesn't require IntentGuard verification (optional mode), a hidden PDA means the transaction proceeds without 2FA. dApps in mandatory mode are safe.

### A11. Protocol Pause DoS

**Attack**: A compromised admin pauses the protocol to prevent all commits.

**Mitigation**:
- Pause only blocks new `commit_intent` calls
- Existing intents can still be verified and revoked
- Production deployment should use Squads multisig for admin
- Monitor detects pause events and alerts immediately

**Residual risk**: Temporary inability to create new intents during pause. Existing workflows complete normally.

### A12. Transaction Ordering Attack

**Attack**: Attacker front-runs the verify transaction with their own verify using a different hash.

**Mitigation**:
- `verify_intent` has `has_one = user` constraint — only the PDA owner can verify
- The attacker cannot call verify on someone else's PDA
- Solana has no mempool, so traditional front-running is not possible

**Residual risk**: None.

## Security Properties Summary

| Property | Status | Notes |
|----------|--------|-------|
| Frontend compromise protection | ✅ Secure | Core design goal |
| Replay protection | ✅ Secure | PDA init + close pattern |
| Cross-app isolation | ✅ Secure | app_id in PDA seeds |
| TTL enforcement | ✅ Secure | On-chain expiry check |
| Access control | ✅ Secure | has_one + signer constraints |
| Rent safety | ✅ Secure | Close refunds to user |
| Admin safety | ⚠️ Adequate | Upgrade to multisig for production |
| Hash security | ✅ Secure | SHA-256, 128-bit security |

## Recommendations

1. **Use Squads multisig** for admin authority before mainnet
2. **Set up Helius webhooks** to monitor pause/admin events
3. **Short TTLs** for high-value transactions (60s recommended)
4. **Multiple RPC endpoints** for PDA detection in dApps
5. **External audit** before mainnet deployment
