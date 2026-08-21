use anchor_lang::prelude::*;

use crate::errors::GuardError;

pub use crate::math::BPS;
pub const MIN_COOLDOWN_SECONDS: u32 = 30;
pub const MAX_DELEGATION_SECONDS: i64 = 90 * 24 * 60 * 60;
pub const MAX_OBLIGATION_STALENESS_SLOTS: u64 = 2;

pub const ACTION_REPAY: u8 = 1 << 0;
pub const ACTION_TOP_UP: u8 = 1 << 1;

pub const SEED_GUARD: &[u8] = b"guard";
pub const SEED_VAULT: &[u8] = b"vault";

pub const KLEND_PROGRAM_ID: Pubkey = pubkey!("KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD");
pub const FARMS_PROGRAM_ID: Pubkey = pubkey!("FarmsPZpWu9i7Kky8tPN37rs2TpmMrAZrC7S7vJa91Hr");
pub const LENDING_MARKET_AUTH_SEED: &[u8] = b"lma";

#[account]
#[derive(InitSpace)]
pub struct GuardConfig {
    pub owner: Pubkey,
    pub agent: Pubkey,
    pub obligation: Pubkey,
    pub lending_market: Pubkey,
    pub debt_reserve: Pubkey,
    pub vault: Pubkey,
    pub vault_mint: Pubkey,

    pub trigger_ltv_bps: u16,
    pub target_ltv_bps: u16,
    pub max_action_amount: u64,
    pub max_actions_per_window: u8,
    pub window_seconds: u32,
    pub cooldown_seconds: u32,
    pub allowed_actions: u8,

    pub expires_at: i64,
    pub paused: bool,

    pub last_action_at: i64,
    pub window_started_at: i64,
    pub actions_in_window: u8,
    pub total_actions: u32,
    pub total_repaid: u64,

    pub bump: u8,
    pub vault_bump: u8,
}

impl GuardConfig {
    pub fn next_window(&self, now: i64) -> Result<WindowState> {
        require!(
            now >= self.window_started_at,
            GuardError::ClockMovedBackwards
        );

        let elapsed = now
            .checked_sub(self.window_started_at)
            .ok_or(GuardError::MathOverflow)?;
        if elapsed >= i64::from(self.window_seconds) {
            Ok(WindowState {
                started_at: now,
                actions: 0,
            })
        } else {
            Ok(WindowState {
                started_at: self.window_started_at,
                actions: self.actions_in_window,
            })
        }
    }

    pub fn record_action(&mut self, now: i64, window: WindowState, amount: u64) -> Result<()> {
        self.last_action_at = now;
        self.window_started_at = window.started_at;
        self.actions_in_window = window
            .actions
            .checked_add(1)
            .ok_or(GuardError::MathOverflow)?;
        self.total_actions = self
            .total_actions
            .checked_add(1)
            .ok_or(GuardError::MathOverflow)?;
        self.total_repaid = self
            .total_repaid
            .checked_add(amount)
            .ok_or(GuardError::MathOverflow)?;
        Ok(())
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub struct PolicyParams {
    pub trigger_ltv_bps: u16,
    pub target_ltv_bps: u16,
    pub max_action_amount: u64,
    pub max_actions_per_window: u8,
    pub window_seconds: u32,
    pub cooldown_seconds: u32,
    pub allowed_actions: u8,
    pub expires_at: i64,
}

impl PolicyParams {
    pub fn validate(&self, now: i64) -> Result<()> {
        require!(
            self.trigger_ltv_bps <= BPS as u16 && self.target_ltv_bps < self.trigger_ltv_bps,
            GuardError::InvalidPolicy
        );
        require!(self.max_action_amount > 0, GuardError::InvalidPolicy);
        require!(self.max_actions_per_window > 0, GuardError::InvalidPolicy);
        require!(self.window_seconds > 0, GuardError::InvalidPolicy);
        require!(
            self.cooldown_seconds >= MIN_COOLDOWN_SECONDS,
            GuardError::InvalidPolicy
        );
        require!(
            self.allowed_actions == ACTION_REPAY,
            GuardError::InvalidPolicy
        );

        let max_expiry = now
            .checked_add(MAX_DELEGATION_SECONDS)
            .ok_or(GuardError::MathOverflow)?;
        require!(
            self.expires_at > now && self.expires_at <= max_expiry,
            GuardError::InvalidPolicy
        );
        Ok(())
    }

    pub fn apply_to(&self, guard: &mut GuardConfig) {
        guard.trigger_ltv_bps = self.trigger_ltv_bps;
        guard.target_ltv_bps = self.target_ltv_bps;
        guard.max_action_amount = self.max_action_amount;
        guard.max_actions_per_window = self.max_actions_per_window;
        guard.window_seconds = self.window_seconds;
        guard.cooldown_seconds = self.cooldown_seconds;
        guard.allowed_actions = self.allowed_actions;
        guard.expires_at = self.expires_at;
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct WindowState {
    pub started_at: i64,
    pub actions: u8,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid_policy(now: i64) -> PolicyParams {
        PolicyParams {
            trigger_ltv_bps: 8_000,
            target_ltv_bps: 7_000,
            max_action_amount: 1_000_000,
            max_actions_per_window: 3,
            window_seconds: 3_600,
            cooldown_seconds: MIN_COOLDOWN_SECONDS,
            allowed_actions: ACTION_REPAY,
            expires_at: now + 86_400,
        }
    }

    #[test]
    fn valid_repay_policy_is_accepted() {
        assert!(valid_policy(1_000).validate(1_000).is_ok());
    }

    #[test]
    fn top_up_is_rejected_in_v1() {
        let mut policy = valid_policy(1_000);
        policy.allowed_actions |= ACTION_TOP_UP;
        assert!(policy.validate(1_000).is_err());
    }

    #[test]
    fn target_must_be_below_trigger() {
        let mut policy = valid_policy(1_000);
        policy.target_ltv_bps = policy.trigger_ltv_bps;
        assert!(policy.validate(1_000).is_err());
    }

    #[test]
    fn delegation_cannot_exceed_ninety_days() {
        let mut policy = valid_policy(1_000);
        policy.expires_at = 1_000 + MAX_DELEGATION_SECONDS + 1;
        assert!(policy.validate(1_000).is_err());
    }
}
