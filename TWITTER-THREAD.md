# Twitter Announcement Thread

## Tweet 1 (Hook)
Introducing IntentGuard — 2FA for Solana transactions.

Your browser gets hacked? Your funds stay safe.

Here's how it works (thread)

## Tweet 2 (Problem)
The problem: Solana dApp frontends are a single point of failure.

A compromised frontend shows "Swap 10 USDC" but actually signs "Swap 10,000 USDC".

Wallet simulation? Spoofable.
Hardware wallet? Raw hex.

One hacked frontend = drained wallet.

## Tweet 3 (Solution)
The fix: commit-reveal with device separation.

1. You see the intent on your PHONE (trusted)
2. You confirm → hash goes on-chain
3. Browser executes → program checks hash
4. Hash match? TX goes through
5. Hash mismatch? TX REVERTS

Even if your browser is fully compromised after step 2, the attacker can't change the parameters.

## Tweet 4 (How it works visual)
```
Phone (trusted)          Browser (untrusted)
     |                         |
  Confirm                      |
  commit_intent ──hash──►  detect commit
                           verify_intent + swap
                           ✅ match → success
                           ❌ mismatch → revert
```

Think Google Authenticator, but for blockchain transactions.

## Tweet 5 (What we shipped)
What we shipped today:

- On-chain program (Anchor) → deployed on devnet
- TypeScript SDK → npm install intentguard-sdk
- Rust CPI crate → cargo add intentguard-cpi
- React component → drop-in <IntentGuardButton />
- Mobile app → QR scan + biometric auth
- 14 tests, CI/CD, landing page

## Tweet 6 (Developer integration)
Integration takes 3 lines:

```js
const verifyIx = createVerifyIntentInstruction(user, appId, hash);
const tx = new Transaction().add(verifyIx).add(swapIx);
await sendTransaction(tx);
```

No program changes needed. Works with Jupiter, Raydium, any Solana dApp.

## Tweet 7 (Technical details)
Technical details:
- PDA per user per app → cross-app isolation
- TTL enforcement (30s–1h) → no stale intents
- PDA auto-closes on verify → rent refunded
- Zero token, zero governance → pure infrastructure
- CPI composable → other programs can call verify_intent

## Tweet 8 (Links + CTA)
Try it:

npm install intentguard-sdk
cargo add intentguard-cpi

GitHub: github.com/selcuk07/intentguard
Landing: selcuk07.github.io/intentguard
npm: npmjs.com/package/intentguard-sdk
crates.io: crates.io/crates/intentguard-cpi

Built by the team behind @ACELaunch_xyz

Solana deserves 2FA. Let's make it happen.
