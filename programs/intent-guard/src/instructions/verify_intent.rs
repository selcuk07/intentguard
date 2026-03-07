use anchor_lang::prelude::*;
use anchor_lang::system_program;

use crate::errors::GuardError;
use crate::state::{GuardConfig, IntentCommit};

#[derive(Accounts)]
pub struct VerifyIntent<'info> {
    #[account(
        mut,
        close = user,
        seeds = [b"intent", user.key().as_ref(), intent_commit.app_id.as_ref()],
        bump = intent_commit.bump,
        has_one = user,
    )]
    pub intent_commit: Account<'info, IntentCommit>,

    #[account(
        mut,
        seeds = [b"config"],
        bump = config.bump,
    )]
    pub config: Account<'info, GuardConfig>,

    #[account(mut)]
    pub user: Signer<'info>,

    pub system_program: Program<'info, System>,
}

/// Verify an intent hash against the on-chain commit, then close the PDA.
///
/// This is called in TX2 (from the browser/dApp). The program checks:
/// 1. The commit hasn't expired
/// 2. The provided hash matches the committed hash
/// 3. Collects protocol fee (if verify_fee > 0)
/// 4. Closes the IntentCommit account (rent refund to user)
///
/// If verification passes, the dApp can proceed knowing the user's intent
/// was confirmed from a trusted device.
pub fn handler(ctx: Context<VerifyIntent>, intent_hash: [u8; 32]) -> Result<()> {
    let commit = &ctx.accounts.intent_commit;
    let fee = ctx.accounts.config.verify_fee;

    require!(!ctx.accounts.config.is_paused, GuardError::ProtocolPaused);

    // Check expiry
    let clock = Clock::get()?;
    require!(clock.unix_timestamp <= commit.expires_at, GuardError::IntentExpired);

    // Verify hash match
    require!(commit.intent_hash == intent_hash, GuardError::IntentMismatch);

    // Collect protocol fee (if enabled)
    if fee > 0 {
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.user.to_account_info(),
                    to: ctx.accounts.config.to_account_info(),
                },
            ),
            fee,
        )?;
    }

    // Update counters
    let config = &mut ctx.accounts.config;
    if fee > 0 {
        config.total_fees_collected = config.total_fees_collected
            .checked_add(fee)
            .ok_or(GuardError::ArithmeticOverflow)?;
    }
    config.total_verifies = config.total_verifies
        .checked_add(1)
        .ok_or(GuardError::ArithmeticOverflow)?;

    msg!(
        "Intent verified: user={}, app={}, fee={}, verified_at={}",
        commit.user,
        commit.app_id,
        fee,
        clock.unix_timestamp,
    );

    // Account closed via `close = user` in Accounts struct — rent refunded
    Ok(())
}
