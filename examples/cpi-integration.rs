/// Example: CPI integration — how a Solana program calls IntentGuard
///
/// This shows the pattern for verifying intent inside your own program
/// before executing a sensitive action (swap, transfer, etc).
///
/// The user commits intent from their mobile → your program verifies
/// the hash via CPI → then executes the action atomically.

use anchor_lang::prelude::*;

// IntentGuard program ID (devnet)
const INTENT_GUARD_ID: Pubkey = pubkey!("4etWfDJNHhjYdv7fuGe236GDPguwUXVk9WhbEpQsPix7");

#[program]
pub mod my_protected_dex {
    use super::*;

    /// Swap with IntentGuard verification.
    /// The intent hash binds: (this_program + user + input_mint + output_mint + amount)
    pub fn protected_swap(
        ctx: Context<ProtectedSwap>,
        amount: u64,
        min_out: u64,
        intent_hash: [u8; 32],
    ) -> Result<()> {
        // ── Step 1: Verify intent via CPI ──────────────────────────
        //
        // This calls IntentGuard's verify_intent instruction.
        // If the hash doesn't match what the user committed from their
        // mobile device, this CPI will fail and revert the entire TX.

        let verify_accounts = vec![
            AccountMeta::new(ctx.accounts.intent_commit.key(), false),
            AccountMeta::new(ctx.accounts.intent_config.key(), false),
            AccountMeta::new(ctx.accounts.user.key(), true),
        ];

        // Anchor discriminator for verify_intent
        let discriminator: [u8; 8] = [240, 198, 213, 223, 94, 7, 247, 247];
        let mut data = Vec::with_capacity(8 + 32);
        data.extend_from_slice(&discriminator);
        data.extend_from_slice(&intent_hash);

        let ix = solana_program::instruction::Instruction {
            program_id: INTENT_GUARD_ID,
            accounts: verify_accounts,
            data,
        };

        solana_program::program::invoke(
            &ix,
            &[
                ctx.accounts.intent_commit.to_account_info(),
                ctx.accounts.intent_config.to_account_info(),
                ctx.accounts.user.to_account_info(),
            ],
        )?;

        // If we reach here, intent was verified successfully!
        // The IntentCommit PDA is now closed (rent refunded to user).

        // ── Step 2: Execute swap logic ─────────────────────────────
        msg!(
            "Intent verified! Swapping {} tokens (min out: {})",
            amount,
            min_out
        );

        // ... your actual swap logic here ...

        Ok(())
    }
}

#[derive(Accounts)]
pub struct ProtectedSwap<'info> {
    /// The user performing the swap (must be signer)
    #[account(mut)]
    pub user: Signer<'info>,

    // ── IntentGuard accounts (for CPI) ─────────────────────────
    /// IntentCommit PDA: [b"intent", user, this_program_id]
    /// CHECK: Validated by IntentGuard program via CPI
    #[account(mut)]
    pub intent_commit: UncheckedAccount<'info>,

    /// GuardConfig PDA: [b"config"]
    /// CHECK: Validated by IntentGuard program via CPI
    #[account(mut)]
    pub intent_config: UncheckedAccount<'info>,

    /// IntentGuard program
    /// CHECK: Verified by address constraint
    #[account(address = INTENT_GUARD_ID)]
    pub intent_guard_program: UncheckedAccount<'info>,

    // ── Your program's accounts ────────────────────────────────
    // pub input_token_account: Account<'info, TokenAccount>,
    // pub output_token_account: Account<'info, TokenAccount>,
    // ... etc
}
