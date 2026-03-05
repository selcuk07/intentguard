use anchor_lang::prelude::*;

use crate::state::IntentCommit;

#[derive(Accounts)]
#[instruction(app_id: Pubkey)]
pub struct RevokeIntent<'info> {
    #[account(
        mut,
        close = user,
        seeds = [b"intent", user.key().as_ref(), app_id.as_ref()],
        bump = intent_commit.bump,
        has_one = user,
    )]
    pub intent_commit: Account<'info, IntentCommit>,

    #[account(mut)]
    pub user: Signer<'info>,
}

/// Revoke a pending intent commit.
/// Closes the IntentCommit PDA and refunds rent to the user.
pub fn handler(ctx: Context<RevokeIntent>, _app_id: Pubkey) -> Result<()> {
    msg!(
        "Intent revoked: user={}, app={}",
        ctx.accounts.intent_commit.user,
        ctx.accounts.intent_commit.app_id,
    );

    // Account closed via `close = user` in Accounts struct
    Ok(())
}
