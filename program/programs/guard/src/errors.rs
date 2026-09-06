use anchor_lang::prelude::*;

#[error_code]
pub enum GuardError {
    #[msg("Agent key does not match guard config")]
    UnauthorizedAgent,
    #[msg("Guard is paused")]
    GuardPaused,
    #[msg("Delegation expired")]
    GuardExpired,
    #[msg("Cooldown has not elapsed")]
    CooldownActive,
    #[msg("Action limit for the current window is exhausted")]
    RateLimitExceeded,
    #[msg("Action kind is not permitted by policy")]
    ActionNotAllowed,
    #[msg("Amount exceeds per-action limit or vault balance")]
    AmountExceedsLimit,
    #[msg("Obligation state was not refreshed in the current slot")]
    StaleObligation,
    #[msg("Oracle price is stale or confidence is too wide")]
    StaleOracle,
    #[msg("Current LTV is below the configured trigger")]
    TriggerNotMet,
    #[msg("Action would not improve position health")]
    ActionWouldNotImprove,
    #[msg("Amount overshoots the configured target LTV")]
    Overcorrection,
    #[msg("Policy parameters are inconsistent")]
    InvalidPolicy,
    #[msg("Arithmetic overflow")]
    MathOverflow,
    #[msg("Unexpected lending program")]
    UnexpectedProgram,
    #[msg("External Kamino account owner, discriminator, or layout is invalid")]
    InvalidExternalAccount,
    #[msg("Kamino account relationships do not match guard config")]
    InvalidMarketRelationship,
    #[msg("Configured debt reserve is not present in the obligation")]
    MissingDebtPosition,
    #[msg("Remaining deposit reserve accounts are missing, reordered, or invalid")]
    InvalidRemainingAccounts,
    #[msg("Amount must be greater than zero")]
    InvalidAmount,
    #[msg("Clock moved backwards relative to guard state")]
    ClockMovedBackwards,
    #[msg("Post-CPI balance or health invariant failed")]
    PostCpiInvariant,
    #[msg("Scheduled repay interval has not elapsed")]
    ScheduleNotDue,
    #[msg("Policy does not configure a repayment schedule")]
    ScheduleNotConfigured,
    #[msg("Owner key does not match guard config")]
    UnauthorizedOwner,
}
