use anchor_lang::prelude::*;

/// Maximum TTL for an intent commit (1 hour)
pub const MAX_TTL: i64 = 3_600;

/// Minimum TTL for an intent commit
#[cfg(feature = "dev-testing")]
pub const MIN_TTL: i64 = 5;
#[cfg(not(feature = "dev-testing"))]
pub const MIN_TTL: i64 = 30;

/// Default TTL if none specified (5 minutes)
pub const DEFAULT_TTL: i64 = 300;

/// IntentCommit — on-chain record of a user's declared intent.
///
/// Created by `commit_intent` (TX1 from trusted device).
/// Consumed by `verify_intent` (TX2 from browser/dApp).
///
/// PDA seeds: [b"intent", user, app_id]
/// One active intent per user per app.
#[account]
pub struct IntentCommit {
    /// Wallet that committed the intent
    pub user: Pubkey,
    /// Target application/program identifier
    pub app_id: Pubkey,
    /// SHA-256 hash of the intent parameters
    pub intent_hash: [u8; 32],
    /// Unix timestamp when committed
    pub committed_at: i64,
    /// Unix timestamp when this commit expires
    pub expires_at: i64,
    /// PDA bump seed
    pub bump: u8,
}

impl IntentCommit {
    /// Account space: 8 (discriminator) + 32 + 32 + 32 + 8 + 8 + 1 = 121
    pub const SPACE: usize = 8 + 32 + 32 + 32 + 8 + 8 + 1;
}

/// Minimum SOL balance required to commit (lamports) — production default
#[cfg(not(feature = "dev-testing"))]
pub const DEFAULT_MIN_BALANCE: u64 = 10_000_000; // 0.01 SOL

/// Minimum SOL balance — dev-testing (no restriction)
#[cfg(feature = "dev-testing")]
pub const DEFAULT_MIN_BALANCE: u64 = 0;

/// Protocol configuration — global settings managed by admin.
///
/// PDA seeds: [b"config"]
#[account]
pub struct GuardConfig {
    /// Protocol admin (can pause, update config)
    pub admin: Pubkey,
    /// Whether the protocol is paused
    pub is_paused: bool,
    /// Total intents committed (lifetime counter)
    pub total_commits: u64,
    /// Total intents verified (lifetime counter)
    pub total_verifies: u64,
    /// Minimum SOL balance (lamports) required to commit an intent
    pub min_balance: u64,
    /// PDA bump seed
    pub bump: u8,
}

impl GuardConfig {
    /// Account space: 8 + 32 + 1 + 8 + 8 + 8 + 1 = 66
    pub const SPACE: usize = 8 + 32 + 1 + 8 + 8 + 8 + 1;
}
