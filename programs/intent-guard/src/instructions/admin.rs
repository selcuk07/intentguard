use anchor_lang::prelude::*;
use crate::state::GuardConfig;
use crate::errors::GuardError;

/// Pause the protocol — blocks new commits.
pub fn handler_pause(ctx: Context<AdminAction>) -> Result<()> {
    let config = &mut ctx.accounts.config;
    require!(
        config.admin == ctx.accounts.admin.key(),
        GuardError::Unauthorized
    );
    config.is_paused = true;
    msg!("IntentGuard: protocol PAUSED by {}", ctx.accounts.admin.key());
    Ok(())
}

/// Unpause the protocol — resumes normal operation.
pub fn handler_unpause(ctx: Context<AdminAction>) -> Result<()> {
    let config = &mut ctx.accounts.config;
    require!(
        config.admin == ctx.accounts.admin.key(),
        GuardError::Unauthorized
    );
    config.is_paused = false;
    msg!("IntentGuard: protocol UNPAUSED by {}", ctx.accounts.admin.key());
    Ok(())
}

/// Transfer admin authority to a new address.
pub fn handler_transfer_admin(ctx: Context<AdminAction>, new_admin: Pubkey) -> Result<()> {
    let config = &mut ctx.accounts.config;
    require!(
        config.admin == ctx.accounts.admin.key(),
        GuardError::Unauthorized
    );
    let old_admin = config.admin;
    config.admin = new_admin;
    msg!(
        "IntentGuard: admin transferred from {} to {}",
        old_admin,
        new_admin
    );
    Ok(())
}

#[derive(Accounts)]
pub struct AdminAction<'info> {
    #[account(
        mut,
        seeds = [b"config"],
        bump = config.bump,
    )]
    pub config: Account<'info, GuardConfig>,

    #[account(mut)]
    pub admin: Signer<'info>,
}
