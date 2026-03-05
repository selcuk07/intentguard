use anchor_lang::prelude::*;

use crate::errors::GuardError;
use crate::state::{GuardConfig, IntentCommit, DEFAULT_TTL, MAX_TTL, MIN_TTL};

#[derive(Accounts)]
#[instruction(app_id: Pubkey)]
pub struct CommitIntent<'info> {
    #[account(
        init,
        payer = user,
        space = IntentCommit::SPACE,
        seeds = [b"intent", user.key().as_ref(), app_id.as_ref()],
        bump,
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

/// Commit an intent hash from a trusted device.
///
/// Parameters:
/// - `app_id`: Target program/dApp identifier (e.g., Jupiter program ID)
/// - `intent_hash`: SHA-256 hash of the intent parameters (app-defined)
/// - `ttl`: Time-to-live in seconds (0 = default 300s)
pub fn handler(
    ctx: Context<CommitIntent>,
    app_id: Pubkey,
    intent_hash: [u8; 32],
    ttl: i64,
) -> Result<()> {
    let config = &mut ctx.accounts.config;
    require!(!config.is_paused, GuardError::ProtocolPaused);

    let effective_ttl = if ttl == 0 { DEFAULT_TTL } else { ttl };
    require!(effective_ttl >= MIN_TTL, GuardError::InvalidTtl);
    require!(effective_ttl <= MAX_TTL, GuardError::InvalidTtl);

    let clock = Clock::get()?;

    let commit = &mut ctx.accounts.intent_commit;
    commit.user = ctx.accounts.user.key();
    commit.app_id = app_id;
    commit.intent_hash = intent_hash;
    commit.committed_at = clock.unix_timestamp;
    commit.expires_at = clock.unix_timestamp
        .checked_add(effective_ttl)
        .ok_or(GuardError::ArithmeticOverflow)?;
    commit.bump = ctx.bumps.intent_commit;

    // Update global counter
    config.total_commits = config.total_commits
        .checked_add(1)
        .ok_or(GuardError::ArithmeticOverflow)?;

    msg!(
        "Intent committed: user={}, app={}, expires_at={}, ttl={}s",
        commit.user,
        app_id,
        commit.expires_at,
        effective_ttl,
    );

    Ok(())
}
