use anchor_lang::prelude::*;

pub mod errors;
pub mod instructions;
pub mod state;

use instructions::*;

declare_id!("4etWfDJNHhjYdv7fuGe236GDPguwUXVk9WhbEpQsPix7");

#[program]
pub mod intent_guard {
    use super::*;

    pub fn initialize(ctx: Context<InitializeGuard>) -> Result<()> {
        instructions::initialize::handler(ctx)
    }

    pub fn commit_intent(
        ctx: Context<CommitIntent>,
        app_id: Pubkey,
        intent_hash: [u8; 32],
        ttl: i64,
    ) -> Result<()> {
        instructions::commit_intent::handler(ctx, app_id, intent_hash, ttl)
    }

    pub fn verify_intent(
        ctx: Context<VerifyIntent>,
        intent_hash: [u8; 32],
    ) -> Result<()> {
        instructions::verify_intent::handler(ctx, intent_hash)
    }

    pub fn revoke_intent(
        ctx: Context<RevokeIntent>,
        app_id: Pubkey,
    ) -> Result<()> {
        instructions::revoke_intent::handler(ctx, app_id)
    }
}
