use anchor_lang::prelude::*;
use crate::state::GuardConfig;
use crate::errors::GuardError;

/// Maximum min_balance admin can set (1 SOL — prevents lockout)
pub const MAX_MIN_BALANCE: u64 = 1_000_000_000;

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

/// Update protocol configuration (admin only).
pub fn handler_update_config(
    ctx: Context<AdminAction>,
    new_min_balance: u64,
) -> Result<()> {
    let config = &mut ctx.accounts.config;
    require!(
        config.admin == ctx.accounts.admin.key(),
        GuardError::Unauthorized
    );
    require!(new_min_balance <= MAX_MIN_BALANCE, GuardError::ConfigValueOutOfRange);
    config.min_balance = new_min_balance;
    msg!(
        "IntentGuard: config updated by {} — min_balance={}",
        ctx.accounts.admin.key(),
        new_min_balance,
    );
    Ok(())
}

/// Migrate GuardConfig to new size (adds min_balance field).
/// Only needed once after program upgrade. Uses UncheckedAccount
/// because the old account can't deserialize into the new struct.
pub fn handler_migrate_config(ctx: Context<MigrateConfig>) -> Result<()> {
    let config_info = &ctx.accounts.config;
    let admin_key = ctx.accounts.admin.key();

    // Read admin pubkey from raw data (offset 8 = discriminator, 32 bytes)
    let data = config_info.try_borrow_data()?;
    require!(data.len() >= 40, GuardError::Unauthorized); // 8 disc + 32 admin
    let stored_admin = Pubkey::try_from(&data[8..40]).map_err(|_| GuardError::Unauthorized)?;
    require!(stored_admin == admin_key, GuardError::Unauthorized);
    drop(data);

    // Realloc to new size
    let new_size = GuardConfig::SPACE;
    let rent = Rent::get()?;
    let new_min_rent = rent.minimum_balance(new_size);
    let current_lamports = config_info.lamports();

    // Transfer additional rent if needed (before realloc)
    if current_lamports < new_min_rent {
        let diff = new_min_rent.checked_sub(current_lamports).unwrap();
        anchor_lang::system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                anchor_lang::system_program::Transfer {
                    from: ctx.accounts.admin.to_account_info(),
                    to: config_info.to_account_info(),
                },
            ),
            diff,
        )?;
    }

    config_info.realloc(new_size, false)?;

    msg!(
        "IntentGuard: config migrated by {}, new size={}",
        admin_key,
        new_size,
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

#[derive(Accounts)]
pub struct MigrateConfig<'info> {
    /// CHECK: Raw account — we manually validate admin and realloc
    #[account(
        mut,
        seeds = [b"config"],
        bump,
    )]
    pub config: UncheckedAccount<'info>,

    #[account(mut)]
    pub admin: Signer<'info>,

    pub system_program: Program<'info, System>,
}
