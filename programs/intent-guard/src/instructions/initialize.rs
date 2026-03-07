use anchor_lang::prelude::*;

use crate::state::{GuardConfig, DEFAULT_MIN_BALANCE};

#[derive(Accounts)]
pub struct InitializeGuard<'info> {
    #[account(
        init,
        payer = admin,
        space = GuardConfig::SPACE,
        seeds = [b"config"],
        bump,
    )]
    pub config: Account<'info, GuardConfig>,

    #[account(mut)]
    pub admin: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<InitializeGuard>) -> Result<()> {
    let config = &mut ctx.accounts.config;
    config.admin = ctx.accounts.admin.key();
    config.is_paused = false;
    config.total_commits = 0;
    config.total_verifies = 0;
    config.min_balance = DEFAULT_MIN_BALANCE;
    config.verify_fee = 0;
    config.total_fees_collected = 0;
    config.bump = ctx.bumps.config;

    msg!("IntentGuard initialized");
    Ok(())
}
