use anchor_lang::prelude::*;

#[event]
pub struct GuardInitialized {
    pub guard: Pubkey,
    pub owner: Pubkey,
    pub agent: Pubkey,
    pub obligation: Pubkey,
    pub vault: Pubkey,
    pub expires_at: i64,
}

#[event]
pub struct ReserveDeposited {
    pub guard: Pubkey,
    pub owner: Pubkey,
    pub amount: u64,
}

#[event]
pub struct ReserveWithdrawn {
    pub guard: Pubkey,
    pub owner: Pubkey,
    pub amount: u64,
}

#[event]
pub struct PolicyUpdated {
    pub guard: Pubkey,
    pub owner: Pubkey,
    pub agent: Pubkey,
    pub trigger_ltv_bps: u16,
    pub target_ltv_bps: u16,
    pub expires_at: i64,
    pub paused: bool,
}

#[event]
pub struct GuardRevoked {
    pub guard: Pubkey,
    pub owner: Pubkey,
    pub revoked_at: i64,
}

#[event]
pub struct ActionExecuted {
    pub guard: Pubkey,
    pub agent: Pubkey,
    pub obligation: Pubkey,
    pub requested_amount: u64,
    pub repaid_amount: u64,
    pub ltv_before_bps: u16,
    pub ltv_after_bps: u16,
    pub slot: u64,
    /// Which grant this repay was made under, as an `ACTION_*` bit.
    ///
    /// Appended rather than split into a second event, so the history keeps one
    /// shape and a reader that ignores this field still gets the amounts right.
    /// It matters because "the agent repaid because your position was in danger"
    /// and "the agent made your weekly payment" are not the same sentence.
    pub action_kind: u8,
}

/// The owner spending their own reserve on their own debt.
///
/// Separate from [`ActionExecuted`] because no delegation was exercised: this one
/// carries an owner signature, so it is not part of the record of what the agent
/// did while nobody was looking.
#[event]
pub struct OwnerRepaid {
    pub guard: Pubkey,
    pub owner: Pubkey,
    pub obligation: Pubkey,
    pub requested_amount: u64,
    pub repaid_amount: u64,
    pub ltv_before_bps: u16,
    pub ltv_after_bps: u16,
    pub slot: u64,
}
