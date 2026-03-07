use anchor_lang::prelude::*;

#[error_code]
pub enum GuardError {
    #[msg("Protocol is paused")]
    ProtocolPaused,

    #[msg("Intent hash mismatch — transaction parameters differ from committed intent")]
    IntentMismatch,

    #[msg("Intent has expired — commit again from your trusted device")]
    IntentExpired,

    #[msg("TTL must be between MIN_TTL and MAX_TTL seconds")]
    InvalidTtl,

    #[msg("Arithmetic overflow")]
    ArithmeticOverflow,

    #[msg("Unauthorized — only the admin can perform this action")]
    Unauthorized,

    #[msg("Insufficient SOL balance to commit intent")]
    InsufficientBalance,

    #[msg("Config value out of allowed range")]
    ConfigValueOutOfRange,

    #[msg("Invalid admin address — cannot transfer to zero address or program ID")]
    InvalidAdmin,

    #[msg("Fee exceeds maximum allowed (0.1 SOL)")]
    FeeExceedsMaximum,

    #[msg("Insufficient fee balance in config PDA for withdrawal")]
    InsufficientFeeBalance,
}
