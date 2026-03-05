# @intentguard/sdk

Solana 2FA SDK — Add cryptographic intent verification to any dApp.

## Install

```bash
npm install @intentguard/sdk @solana/web3.js
```

## Quick Start

```typescript
import {
  computeIntentHash,
  createCommitIntentInstruction,
  createVerifyIntentInstruction,
  findIntentCommitPda,
} from '@intentguard/sdk';

// 1. Compute hash from intent parameters
const hash = computeIntentHash([
  programId.toBuffer(),
  user.toBuffer(),
  Buffer.from('swap'),
  amountIn.toArrayLike(Buffer, 'le', 8),
]);

// 2. Commit from trusted device (mobile/CLI)
const commitIx = createCommitIntentInstruction(
  user,       // signer
  programId,  // target app
  hash,       // 32-byte hash
  300,        // TTL in seconds
);

// 3. Verify from browser (same transaction as your action)
const verifyIx = createVerifyIntentInstruction(user, programId, hash);
const tx = new Transaction().add(verifyIx).add(yourSwapIx);
```

## React Component

```tsx
import { IntentGuardButton } from '@intentguard/sdk/react';

<IntentGuardButton
  userPublicKey={wallet.publicKey}
  appId={PROGRAM_ID}
  action="swap"
  params={{ amount: "1000000", mint: "So11..." }}
  connection={connection}
  onVerified={(hash) => executeSwap(hash)}
/>
```

## API

| Function | Description |
|----------|-------------|
| `computeIntentHash(buffers)` | SHA-256 hash from buffer array |
| `createCommitIntentInstruction(...)` | Build commit TX (no Anchor needed) |
| `createVerifyIntentInstruction(...)` | Build verify TX (no Anchor needed) |
| `createRevokeIntentInstruction(...)` | Build revoke TX (no Anchor needed) |
| `findIntentCommitPda(user, appId)` | Derive IntentCommit PDA address |
| `findConfigPda()` | Derive GuardConfig PDA address |
| `getIntentCommit(connection, user, appId)` | Check if commit exists on-chain |

## License

MIT
