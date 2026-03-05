# intentguard-cpi

CPI helpers for integrating [IntentGuard](https://github.com/selcuk07/intentguard) into your Solana program.

IntentGuard is a 2FA protocol for Solana — users commit intent from a trusted device, then your program verifies the hash before executing.

## Install

```toml
[dependencies]
intentguard-cpi = "0.1.0"
```

## Usage

```rust
use intentguard_cpi::{verify_intent_cpi, VerifyIntentAccounts};

pub fn my_protected_instruction(ctx: Context<MyInstruction>, intent_hash: [u8; 32]) -> Result<()> {
    // Step 1: Verify intent — reverts if hash doesn't match
    verify_intent_cpi(
        VerifyIntentAccounts {
            intent_commit: ctx.accounts.intent_commit.to_account_info(),
            config: ctx.accounts.intent_config.to_account_info(),
            user: ctx.accounts.user.to_account_info(),
            intent_guard_program: ctx.accounts.intent_guard_program.to_account_info(),
        },
        intent_hash,
    )?;

    // Step 2: Your logic — only runs if intent was verified
    msg!("Intent verified, proceeding with action");
    Ok(())
}
```

## API

| Function | Description |
|----------|-------------|
| `verify_intent_cpi()` | Verify intent hash via CPI (closes PDA on success) |
| `commit_intent_cpi()` | Commit intent hash via CPI (creates PDA) |
| `revoke_intent_cpi()` | Cancel pending intent via CPI (closes PDA) |
| `find_intent_commit_pda()` | Derive IntentCommit PDA address |
| `find_config_pda()` | Derive GuardConfig PDA address |

## License

MIT
