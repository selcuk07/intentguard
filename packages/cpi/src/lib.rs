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
