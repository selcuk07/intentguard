use anchor_lang::prelude::*;
use crate::state::{GuardConfig, DEFAULT_MIN_BALANCE, MAX_VERIFY_FEE};
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

    // Prevent permanent lockout — zero address and system program have no private key
    require!(
        new_admin != Pubkey::default(),
        GuardError::InvalidAdmin
    );
    require!(
        new_admin != anchor_lang::system_program::ID,
        GuardError::InvalidAdmin
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

/// Update the protocol fee charged per verify_intent.
///
/// Fee is in lamports. Set to 0 for free usage.
/// Maximum: 0.1 SOL (100_000_000 lamports) to prevent abuse.
pub fn handler_update_fee(
    ctx: Context<AdminAction>,
    new_fee: u64,
) -> Result<()> {
    let config = &mut ctx.accounts.config;
    require!(
        config.admin == ctx.accounts.admin.key(),
        GuardError::Unauthorized
    );
    require!(new_fee <= MAX_VERIFY_FEE, GuardError::FeeExceedsMaximum);
    let old_fee = config.verify_fee;
    config.verify_fee = new_fee;
    msg!(
        "IntentGuard: verify_fee updated by {} — {} -> {} lamports",
        ctx.accounts.admin.key(),
        old_fee,
        new_fee,
    );
    Ok(())
}

/// Withdraw accumulated protocol fees from the config PDA.
///
/// Transfers excess lamports (above rent-exempt minimum) to admin.
pub fn handler_withdraw_fees(
    ctx: Context<AdminAction>,
    amount: u64,
) -> Result<()> {
    let config = &ctx.accounts.config;
    require!(
        config.admin == ctx.accounts.admin.key(),
        GuardError::Unauthorized
    );

    let config_info = ctx.accounts.config.to_account_info();
    let rent = Rent::get()?;
    let min_rent = rent.minimum_balance(config_info.data_len());
    let available = config_info.lamports()
        .checked_sub(min_rent)
        .ok_or(GuardError::InsufficientFeeBalance)?;

    require!(amount <= available, GuardError::InsufficientFeeBalance);

    // Transfer from PDA to admin (PDA-owned lamports, no CPI needed)
    **config_info.try_borrow_mut_lamports()? -= amount;
    **ctx.accounts.admin.to_account_info().try_borrow_mut_lamports()? += amount;

    msg!(
        "IntentGuard: {} lamports withdrawn by {} (remaining={})",
        amount,
        ctx.accounts.admin.key(),
        config_info.lamports() - amount,
    );
    Ok(())
}

/// Migrate GuardConfig: realloc + fix data layout.
/// Handles the case where bump was at offset 57 (old layout without min_balance)
/// and needs to move to offset 65 (new layout with min_balance at 57-64).
pub fn handler_migrate_config(ctx: Context<MigrateConfig>) -> Result<()> {
    let config_info = &ctx.accounts.config;
    let admin_key = ctx.accounts.admin.key();

    // Validate GuardConfig discriminator (first 8 bytes)
    let data = config_info.try_borrow_data()?;
    require!(data.len() >= 40, GuardError::Unauthorized);
    require!(
        data[..8] == GuardConfig::DISCRIMINATOR[..],
        GuardError::Unauthorized
    );

    // Read admin pubkey from raw data (offset 8 = discriminator, 32 bytes)
    let stored_admin = Pubkey::try_from(&data[8..40]).map_err(|_| GuardError::Unauthorized)?;
    require!(stored_admin == admin_key, GuardError::Unauthorized);

    // Read bump from old offset (57) if new offset (65) is zero
    let old_bump = if data.len() > 57 { data[57] } else { 0 };
    let new_bump = if data.len() > 65 { data[65] } else { 0 };
    drop(data);

    // Realloc to new size
    let new_size = GuardConfig::SPACE;
    let rent = Rent::get()?;
    let new_min_rent = rent.minimum_balance(new_size);
    let current_lamports = config_info.lamports();

    if current_lamports < new_min_rent {
        let diff = new_min_rent.checked_sub(current_lamports)
            .ok_or(GuardError::ArithmeticOverflow)?;
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

    config_info.resize(new_size)?;

    // Fix data layout: if bump at new offset is 0 but old offset has a value,
    // move bump to correct position and set default min_balance
    if new_bump == 0 && old_bump != 0 {
        let mut data = config_info.try_borrow_mut_data()?;
        // Write default min_balance (0.01 SOL) at offset 57-64
        let min_bal = DEFAULT_MIN_BALANCE.to_le_bytes();
        data[57..65].copy_from_slice(&min_bal);
        // Write bump at offset 65
        data[65] = old_bump;
        msg!("IntentGuard: fixed bump {} from offset 57 -> 65", old_bump);
    }

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
        has_one = admin,
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
