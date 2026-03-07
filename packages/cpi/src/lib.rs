//! # intentguard-cpi
//!
//! CPI helpers for integrating IntentGuard into your Solana program.
//!
//! IntentGuard is a 2FA protocol for Solana — users commit intent from a
//! trusted device, then your program verifies the hash before executing.
//!
//! ## Usage
//!
//! ```rust,ignore
//! use intentguard_cpi::{verify_intent_cpi, VerifyIntentAccounts};
//!
//! // In your instruction handler:
//! verify_intent_cpi(
//!     VerifyIntentAccounts {
//!         intent_commit: ctx.accounts.intent_commit.to_account_info(),
//!         config: ctx.accounts.intent_config.to_account_info(),
//!         user: ctx.accounts.user.to_account_info(),
//!         intent_guard_program: ctx.accounts.intent_guard_program.to_account_info(),
//!     },
//!     intent_hash,
//! )?;
//! // If we reach here, intent was verified!
//! ```

use anchor_lang::prelude::*;
use solana_program::instruction::Instruction;

/// IntentGuard program ID (devnet & mainnet)
pub const INTENT_GUARD_PROGRAM_ID: Pubkey =
    pubkey!("4etWfDJNHhjYdv7fuGe236GDPguwUXVk9WhbEpQsPix7");

/// Anchor discriminator for `verify_intent` instruction
const VERIFY_INTENT_DISCRIMINATOR: [u8; 8] = [240, 198, 213, 223, 94, 7, 247, 247];

/// Anchor discriminator for `commit_intent` instruction
const COMMIT_INTENT_DISCRIMINATOR: [u8; 8] = [175, 152, 13, 10, 40, 234, 201, 8];

/// Anchor discriminator for `revoke_intent` instruction
const REVOKE_INTENT_DISCRIMINATOR: [u8; 8] = [42, 248, 79, 132, 107, 96, 193, 153];

/// Anchor discriminator for `pause_protocol` instruction
const PAUSE_PROTOCOL_DISCRIMINATOR: [u8; 8] = [144, 95, 0, 107, 119, 39, 248, 141];

/// Anchor discriminator for `unpause_protocol` instruction
const UNPAUSE_PROTOCOL_DISCRIMINATOR: [u8; 8] = [183, 154, 5, 183, 105, 76, 87, 18];

/// Anchor discriminator for `transfer_admin` instruction
const TRANSFER_ADMIN_DISCRIMINATOR: [u8; 8] = [42, 242, 66, 106, 228, 10, 111, 156];

/// Anchor discriminator for `update_fee` instruction
const UPDATE_FEE_DISCRIMINATOR: [u8; 8] = [232, 253, 195, 247, 148, 212, 73, 222];

/// Anchor discriminator for `withdraw_fees` instruction
const WITHDRAW_FEES_DISCRIMINATOR: [u8; 8] = [198, 212, 171, 109, 144, 215, 174, 89];

/// Accounts required for `verify_intent` CPI.
pub struct VerifyIntentAccounts<'info> {
    /// IntentCommit PDA — `[b"intent", user, app_id]`
    pub intent_commit: AccountInfo<'info>,
    /// GuardConfig PDA — `[b"config"]`
    pub config: AccountInfo<'info>,
    /// User wallet (signer, must match IntentCommit.user)
    pub user: AccountInfo<'info>,
    /// IntentGuard program
    pub intent_guard_program: AccountInfo<'info>,
}

/// Accounts required for `commit_intent` CPI.
pub struct CommitIntentAccounts<'info> {
    /// IntentCommit PDA — will be created
    pub intent_commit: AccountInfo<'info>,
    /// GuardConfig PDA — `[b"config"]`
    pub config: AccountInfo<'info>,
    /// User wallet (signer, payer)
    pub user: AccountInfo<'info>,
    /// System program
    pub system_program: AccountInfo<'info>,
    /// IntentGuard program
    pub intent_guard_program: AccountInfo<'info>,
}

/// Accounts required for `revoke_intent` CPI.
pub struct RevokeIntentAccounts<'info> {
    /// IntentCommit PDA — will be closed
    pub intent_commit: AccountInfo<'info>,
    /// User wallet (signer, receives rent refund)
    pub user: AccountInfo<'info>,
    /// IntentGuard program
    pub intent_guard_program: AccountInfo<'info>,
}

/// Accounts required for admin CPI calls (pause/unpause/transfer).
pub struct AdminAccounts<'info> {
    /// GuardConfig PDA — `[b"config"]`
    pub config: AccountInfo<'info>,
    /// Admin wallet (signer, must match config.admin)
    pub admin: AccountInfo<'info>,
    /// IntentGuard program
    pub intent_guard_program: AccountInfo<'info>,
}

/// Derive the IntentCommit PDA address.
///
/// Seeds: `[b"intent", user, app_id]`
pub fn find_intent_commit_pda(user: &Pubkey, app_id: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[b"intent", user.as_ref(), app_id.as_ref()],
        &INTENT_GUARD_PROGRAM_ID,
    )
}

/// Derive the GuardConfig PDA address.
///
/// Seeds: `[b"config"]`
pub fn find_config_pda() -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"config"], &INTENT_GUARD_PROGRAM_ID)
}

/// Verify an intent via CPI to IntentGuard.
///
/// This checks the on-chain IntentCommit hash matches `intent_hash`.
/// On success, the IntentCommit PDA is closed and rent refunded to user.
/// On failure (mismatch, expired, not found), the entire TX reverts.
///
/// # Arguments
/// * `accounts` — The required accounts for verification
/// * `intent_hash` — 32-byte SHA-256 hash to verify against
pub fn verify_intent_cpi(
    accounts: VerifyIntentAccounts,
    intent_hash: [u8; 32],
) -> Result<()> {
    let mut data = Vec::with_capacity(8 + 32);
    data.extend_from_slice(&VERIFY_INTENT_DISCRIMINATOR);
    data.extend_from_slice(&intent_hash);

    let ix = Instruction {
        program_id: INTENT_GUARD_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(accounts.intent_commit.key(), false),
            AccountMeta::new(accounts.config.key(), false),
            AccountMeta::new(accounts.user.key(), true),
        ],
        data,
    };

    solana_program::program::invoke(
        &ix,
        &[
            accounts.intent_commit,
            accounts.config,
            accounts.user,
            accounts.intent_guard_program,
        ],
    )?;

    Ok(())
}

/// Commit an intent via CPI to IntentGuard.
///
/// Creates an IntentCommit PDA with the given hash and TTL.
///
/// # Arguments
/// * `accounts` — The required accounts
/// * `app_id` — Target application program ID
/// * `intent_hash` — 32-byte SHA-256 hash of intent parameters
/// * `ttl` — Time to live in seconds (30–3600)
pub fn commit_intent_cpi(
    accounts: CommitIntentAccounts,
    app_id: Pubkey,
    intent_hash: [u8; 32],
    ttl: i64,
) -> Result<()> {
    let mut data = Vec::with_capacity(8 + 32 + 32 + 8);
    data.extend_from_slice(&COMMIT_INTENT_DISCRIMINATOR);
    data.extend_from_slice(app_id.as_ref());
    data.extend_from_slice(&intent_hash);
    data.extend_from_slice(&ttl.to_le_bytes());

    let ix = Instruction {
        program_id: INTENT_GUARD_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(accounts.intent_commit.key(), false),
            AccountMeta::new(accounts.config.key(), false),
            AccountMeta::new(accounts.user.key(), true),
            AccountMeta::new_readonly(accounts.system_program.key(), false),
        ],
        data,
    };

    solana_program::program::invoke(
        &ix,
        &[
            accounts.intent_commit,
            accounts.config,
            accounts.user,
            accounts.system_program,
            accounts.intent_guard_program,
        ],
    )?;

    Ok(())
}

/// Revoke (cancel) a pending intent via CPI to IntentGuard.
///
/// Closes the IntentCommit PDA and refunds rent to user.
///
/// # Arguments
/// * `accounts` — The required accounts
/// * `app_id` — Target application program ID
pub fn revoke_intent_cpi(
    accounts: RevokeIntentAccounts,
    app_id: Pubkey,
) -> Result<()> {
    let mut data = Vec::with_capacity(8 + 32);
    data.extend_from_slice(&REVOKE_INTENT_DISCRIMINATOR);
    data.extend_from_slice(app_id.as_ref());

    let ix = Instruction {
        program_id: INTENT_GUARD_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(accounts.intent_commit.key(), false),
            AccountMeta::new(accounts.user.key(), true),
        ],
        data,
    };

    solana_program::program::invoke(
        &ix,
        &[
            accounts.intent_commit,
            accounts.user,
            accounts.intent_guard_program,
        ],
    )?;

    Ok(())
}

/// Pause the IntentGuard protocol via CPI (admin only).
///
/// Blocks new `commit_intent` calls until unpaused.
pub fn pause_protocol_cpi(accounts: AdminAccounts) -> Result<()> {
    let ix = Instruction {
        program_id: INTENT_GUARD_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(accounts.config.key(), false),
            AccountMeta::new(accounts.admin.key(), true),
        ],
        data: PAUSE_PROTOCOL_DISCRIMINATOR.to_vec(),
    };

    solana_program::program::invoke(
        &ix,
        &[accounts.config, accounts.admin, accounts.intent_guard_program],
    )?;

    Ok(())
}

/// Unpause the IntentGuard protocol via CPI (admin only).
pub fn unpause_protocol_cpi(accounts: AdminAccounts) -> Result<()> {
    let ix = Instruction {
        program_id: INTENT_GUARD_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(accounts.config.key(), false),
            AccountMeta::new(accounts.admin.key(), true),
        ],
        data: UNPAUSE_PROTOCOL_DISCRIMINATOR.to_vec(),
    };

    solana_program::program::invoke(
        &ix,
        &[accounts.config, accounts.admin, accounts.intent_guard_program],
    )?;

    Ok(())
}

// ─── Convenience Macros ─────────────────────────────────────────────────

/// Verify an intent inline with minimal boilerplate.
///
/// Usage inside an Anchor instruction handler:
///
/// ```rust,ignore
/// use intentguard_cpi::intent_guard_verify;
///
/// pub fn my_protected_action(ctx: Context<MyAction>, intent_hash: [u8; 32]) -> Result<()> {
///     intent_guard_verify!(
///         ctx.accounts.intent_commit,
///         ctx.accounts.intent_config,
///         ctx.accounts.user,
///         ctx.accounts.intent_guard_program,
///         intent_hash
///     );
///     // Intent verified — proceed with your logic
///     Ok(())
/// }
/// ```
#[macro_export]
macro_rules! intent_guard_verify {
    ($intent_commit:expr, $config:expr, $user:expr, $program:expr, $hash:expr) => {
        $crate::verify_intent_cpi(
            $crate::VerifyIntentAccounts {
                intent_commit: $intent_commit.to_account_info(),
                config: $config.to_account_info(),
                user: $user.to_account_info(),
                intent_guard_program: $program.to_account_info(),
            },
            $hash,
        )?
    };
}

/// Generate IntentGuard account fields for an Anchor `#[derive(Accounts)]` struct.
///
/// This generates the three required unchecked accounts plus the program account
/// that IntentGuard CPI needs. Add this macro's output to your Accounts struct.
///
/// Usage:
///
/// ```rust,ignore
/// use intentguard_cpi::{intent_guard_accounts, INTENT_GUARD_PROGRAM_ID};
///
/// #[derive(Accounts)]
/// pub struct MyProtectedAction<'info> {
///     #[account(mut)]
///     pub user: Signer<'info>,
///
///     // Your other accounts...
///
///     intent_guard_accounts!();
/// }
/// ```
///
/// Since Rust macros cannot expand inside derive structs directly, use the
/// helper function pattern instead:
///
/// ```rust,ignore
/// #[derive(Accounts)]
/// pub struct MyAction<'info> {
///     #[account(mut)]
///     pub user: Signer<'info>,
///
///     /// IntentCommit PDA: [b"intent", user, app_id]
///     /// CHECK: Validated by IntentGuard program via CPI
///     #[account(mut)]
///     pub intent_commit: UncheckedAccount<'info>,
///
///     /// GuardConfig PDA: [b"config"]
///     /// CHECK: Validated by IntentGuard program via CPI
///     #[account(mut)]
///     pub intent_config: UncheckedAccount<'info>,
///
///     /// IntentGuard program
///     /// CHECK: Verified by address constraint
///     #[account(address = intentguard_cpi::INTENT_GUARD_PROGRAM_ID)]
///     pub intent_guard_program: UncheckedAccount<'info>,
/// }
///
/// // Then in your handler:
/// intent_guard_verify!(
///     ctx.accounts.intent_commit,
///     ctx.accounts.intent_config,
///     ctx.accounts.user,
///     ctx.accounts.intent_guard_program,
///     intent_hash
/// );
/// ```

/// Update the protocol verify fee via CPI (admin only).
///
/// # Arguments
/// * `accounts` — Admin accounts
/// * `new_fee` — New fee in lamports (0 = free, max 0.1 SOL)
pub fn update_fee_cpi(accounts: AdminAccounts, new_fee: u64) -> Result<()> {
    let mut data = Vec::with_capacity(8 + 8);
    data.extend_from_slice(&UPDATE_FEE_DISCRIMINATOR);
    data.extend_from_slice(&new_fee.to_le_bytes());

    let ix = Instruction {
        program_id: INTENT_GUARD_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(accounts.config.key(), false),
            AccountMeta::new(accounts.admin.key(), true),
        ],
        data,
    };

    solana_program::program::invoke(
        &ix,
        &[accounts.config, accounts.admin, accounts.intent_guard_program],
    )?;

    Ok(())
}

/// Withdraw accumulated protocol fees via CPI (admin only).
///
/// # Arguments
/// * `accounts` — Admin accounts
/// * `amount` — Amount in lamports to withdraw
pub fn withdraw_fees_cpi(accounts: AdminAccounts, amount: u64) -> Result<()> {
    let mut data = Vec::with_capacity(8 + 8);
    data.extend_from_slice(&WITHDRAW_FEES_DISCRIMINATOR);
    data.extend_from_slice(&amount.to_le_bytes());

    let ix = Instruction {
        program_id: INTENT_GUARD_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(accounts.config.key(), false),
            AccountMeta::new(accounts.admin.key(), true),
        ],
        data,
    };

    solana_program::program::invoke(
        &ix,
        &[accounts.config, accounts.admin, accounts.intent_guard_program],
    )?;

    Ok(())
}

/// Transfer admin authority via CPI (admin only).
///
/// # Arguments
/// * `accounts` — Admin accounts
/// * `new_admin` — The new admin public key
pub fn transfer_admin_cpi(accounts: AdminAccounts, new_admin: Pubkey) -> Result<()> {
    let mut data = Vec::with_capacity(8 + 32);
    data.extend_from_slice(&TRANSFER_ADMIN_DISCRIMINATOR);
    data.extend_from_slice(new_admin.as_ref());

    let ix = Instruction {
        program_id: INTENT_GUARD_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(accounts.config.key(), false),
            AccountMeta::new(accounts.admin.key(), true),
        ],
        data,
    };

    solana_program::program::invoke(
        &ix,
        &[accounts.config, accounts.admin, accounts.intent_guard_program],
    )?;

    Ok(())
}
