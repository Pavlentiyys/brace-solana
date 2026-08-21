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
}
