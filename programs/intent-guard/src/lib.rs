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

    pub fn pause_protocol(ctx: Context<AdminAction>) -> Result<()> {
        instructions::admin::handler_pause(ctx)
    }

    pub fn unpause_protocol(ctx: Context<AdminAction>) -> Result<()> {
        instructions::admin::handler_unpause(ctx)
    }

    pub fn transfer_admin(ctx: Context<AdminAction>, new_admin: Pubkey) -> Result<()> {
        instructions::admin::handler_transfer_admin(ctx, new_admin)
    }

    pub fn update_config(ctx: Context<AdminAction>, new_min_balance: u64) -> Result<()> {
        instructions::admin::handler_update_config(ctx, new_min_balance)
    }

    pub fn migrate_config(ctx: Context<MigrateConfig>) -> Result<()> {
        instructions::admin::handler_migrate_config(ctx)
    }
}
