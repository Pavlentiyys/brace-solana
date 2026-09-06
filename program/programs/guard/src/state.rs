use anchor_lang::prelude::*;

use crate::errors::GuardError;

pub use crate::math::BPS;
pub const MIN_COOLDOWN_SECONDS: u32 = 30;
pub const MAX_DELEGATION_SECONDS: i64 = 90 * 24 * 60 * 60;
pub const MAX_OBLIGATION_STALENESS_SLOTS: u64 = 2;

pub const ACTION_REPAY: u8 = 1 << 0;
pub const ACTION_TOP_UP: u8 = 1 << 1;
/// Repay on a fixed interval, whatever the LTV is doing.
///
/// A separate bit rather than a flag on `ACTION_REPAY`, because it is a separate
/// grant. `ACTION_REPAY` lets the agent spend the reserve only on a position that
/// has reached the trigger; this lets it spend on a healthy one. Nobody should be
/// able to widen the first into the second by editing a number.
pub const ACTION_SCHEDULED_REPAY: u8 = 1 << 2;

/// Shortest interval a schedule may be set to.
///
/// Not a safety bound — `schedule_amount` is what bounds the spend — but a
/// coherence one. Below an hour "on a schedule" stops being distinguishable from
/// "whenever the agent feels like it", and the whole point of this grant is that
/// the owner can say when.
pub const MIN_SCHEDULE_SECONDS: u32 = 60 * 60;

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

    /// Seconds between scheduled repays. Zero when there is no schedule.
    pub schedule_seconds: u32,
    /// Cap on one scheduled repay, in base units of the vault mint.
    ///
    /// Deliberately not `max_action_amount`. That one is sized for an emergency,
    /// where the right number is "enough to reach the target"; this one is sized
    /// for a routine payment, where the right number is a fraction of it.
    pub schedule_amount: u64,

    pub expires_at: i64,
    pub paused: bool,

    pub last_action_at: i64,
    pub window_started_at: i64,
    pub actions_in_window: u8,
    /// When the last scheduled repay ran. Its own clock, never the emergency one.
    pub last_scheduled_at: i64,
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
        self.record_repay(amount)
    }

    /// A scheduled repay, recorded against the schedule's own clock.
    ///
    /// It deliberately leaves `last_action_at` and the window counters alone. Those
    /// two are the emergency budget, and spending them here would mean a routine
    /// weekly payment could put the guard in cooldown at the moment a crash makes
    /// the emergency repay necessary. The schedule is rate limited by its own
    /// interval; it must not be rate limited by, or eat into, the other one.
    pub fn record_scheduled_action(&mut self, now: i64, amount: u64) -> Result<()> {
        self.last_scheduled_at = now;
        self.record_repay(amount)
    }

    /// Whether the schedule is armed and its interval has elapsed.
    ///
    /// Measured from the last scheduled run rather than from a fixed grid, so a
    /// tick that lands late pushes the next one out instead of letting a second
    /// one fire immediately behind it.
    pub fn schedule_due(&self, now: i64) -> Result<bool> {
        if self.schedule_seconds == 0 {
            return Ok(false);
        }
        require!(
            now >= self.last_scheduled_at,
            GuardError::ClockMovedBackwards
        );
        let elapsed = now
            .checked_sub(self.last_scheduled_at)
            .ok_or(GuardError::MathOverflow)?;
        Ok(elapsed >= i64::from(self.schedule_seconds))
    }

    /// Money that left the vault for the debt, however it was authorized.
    ///
    /// `total_actions` counts what the agent did, so an owner-signed repay adds to
    /// the money moved and not to the action count. Conflating the two would make
    /// the panel report the agent as busier than it was.
    pub fn record_repay(&mut self, amount: u64) -> Result<()> {
        self.total_actions = self
            .total_actions
            .checked_add(1)
            .ok_or(GuardError::MathOverflow)?;
        self.record_owner_repay(amount)
    }

    pub fn record_owner_repay(&mut self, amount: u64) -> Result<()> {
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
    pub schedule_seconds: u32,
    pub schedule_amount: u64,
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
        // Emergency repay is not optional. A policy that permits only the schedule
        // would be a standing payment order with no reaction to a crash, which is
        // the one thing this program exists to provide.
        require!(
            self.allowed_actions == ACTION_REPAY
                || self.allowed_actions == ACTION_REPAY | ACTION_SCHEDULED_REPAY,
            GuardError::InvalidPolicy
        );

        if self.allowed_actions & ACTION_SCHEDULED_REPAY != 0 {
            require!(
                self.schedule_seconds >= MIN_SCHEDULE_SECONDS,
                GuardError::InvalidPolicy
            );
            // A schedule longer than the longest delegation could never fire, and a
            // permission that can never be exercised should not be granted.
            require!(
                i64::from(self.schedule_seconds) <= MAX_DELEGATION_SECONDS,
                GuardError::InvalidPolicy
            );
            require!(self.schedule_amount > 0, GuardError::InvalidPolicy);
        } else {
            // Fail closed. Carrying schedule numbers the mask does not permit is
            // how a later edit to the mask silently arms a schedule nobody read.
            require!(
                self.schedule_seconds == 0 && self.schedule_amount == 0,
                GuardError::InvalidPolicy
            );
        }

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
        guard.schedule_seconds = self.schedule_seconds;
        guard.schedule_amount = self.schedule_amount;
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
            schedule_seconds: 0,
            schedule_amount: 0,
            expires_at: now + 86_400,
        }
    }

    fn scheduled_policy(now: i64) -> PolicyParams {
        PolicyParams {
            allowed_actions: ACTION_REPAY | ACTION_SCHEDULED_REPAY,
            schedule_seconds: 7 * 24 * 60 * 60,
            schedule_amount: 50_000,
            ..valid_policy(now)
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
    fn valid_scheduled_policy_is_accepted() {
        assert!(scheduled_policy(1_000).validate(1_000).is_ok());
    }

    #[test]
    fn schedule_only_policy_is_rejected() {
        let mut policy = scheduled_policy(1_000);
        policy.allowed_actions = ACTION_SCHEDULED_REPAY;
        assert!(policy.validate(1_000).is_err());
    }

    #[test]
    fn schedule_shorter_than_an_hour_is_rejected() {
        let mut policy = scheduled_policy(1_000);
        policy.schedule_seconds = MIN_SCHEDULE_SECONDS - 1;
        assert!(policy.validate(1_000).is_err());
    }

    #[test]
    fn schedule_longer_than_the_delegation_is_rejected() {
        let mut policy = scheduled_policy(1_000);
        policy.schedule_seconds = (MAX_DELEGATION_SECONDS + 1) as u32;
        assert!(policy.validate(1_000).is_err());
    }

    #[test]
    fn schedule_without_an_amount_is_rejected() {
        let mut policy = scheduled_policy(1_000);
        policy.schedule_amount = 0;
        assert!(policy.validate(1_000).is_err());
    }

    /// The mask is what grants the permission, so numbers it does not cover must
    /// not survive in the account. Otherwise flipping the bit later arms a schedule
    /// nobody agreed to.
    #[test]
    fn schedule_numbers_without_the_bit_are_rejected() {
        let mut policy = valid_policy(1_000);
        policy.schedule_seconds = 7 * 24 * 60 * 60;
        policy.schedule_amount = 50_000;
        assert!(policy.validate(1_000).is_err());
    }

    #[test]
    fn a_schedule_is_not_due_before_its_interval() {
        let mut config = GuardConfig {
            schedule_seconds: 3_600,
            last_scheduled_at: 1_000,
            ..guard_for_schedule()
        };
        assert!(!config.schedule_due(4_599).unwrap());
        assert!(config.schedule_due(4_600).unwrap());

        config.schedule_seconds = 0;
        assert!(!config.schedule_due(i64::MAX).unwrap());
    }

    /// A late tick moves the next one, rather than leaving a second one instantly
    /// due behind it.
    #[test]
    fn a_late_tick_does_not_leave_the_next_one_owing() {
        let mut config = GuardConfig {
            schedule_seconds: 3_600,
            last_scheduled_at: 1_000,
            ..guard_for_schedule()
        };
        config.record_scheduled_action(10_000, 5).unwrap();
        assert_eq!(config.last_scheduled_at, 10_000);
        assert!(!config.schedule_due(13_599).unwrap());
    }

    /// The two budgets are separate on purpose: a routine payment must not put the
    /// guard into cooldown, because the crash comes when it comes.
    #[test]
    fn a_scheduled_repay_does_not_spend_the_emergency_budget() {
        let mut config = guard_for_schedule();
        config.last_action_at = 500;
        config.actions_in_window = 1;

        config.record_scheduled_action(9_000, 42).unwrap();

        assert_eq!(config.last_action_at, 500);
        assert_eq!(config.actions_in_window, 1);
        assert_eq!(config.total_repaid, 42);
        assert_eq!(config.total_actions, 1);
    }

    #[test]
    fn an_owner_repay_is_money_moved_and_not_an_agent_action() {
        let mut config = guard_for_schedule();
        config.record_owner_repay(70).unwrap();
        assert_eq!(config.total_repaid, 70);
        assert_eq!(config.total_actions, 0);
    }

    fn guard_for_schedule() -> GuardConfig {
        GuardConfig {
            owner: Pubkey::default(),
            agent: Pubkey::default(),
            obligation: Pubkey::default(),
            lending_market: Pubkey::default(),
            debt_reserve: Pubkey::default(),
            vault: Pubkey::default(),
            vault_mint: Pubkey::default(),
            trigger_ltv_bps: 8_000,
            target_ltv_bps: 7_000,
            max_action_amount: 1_000,
            max_actions_per_window: 2,
            window_seconds: 3_600,
            cooldown_seconds: MIN_COOLDOWN_SECONDS,
            allowed_actions: ACTION_REPAY | ACTION_SCHEDULED_REPAY,
            schedule_seconds: 3_600,
            schedule_amount: 500,
            expires_at: i64::MAX,
            paused: false,
            last_action_at: 0,
            window_started_at: 0,
            actions_in_window: 0,
            last_scheduled_at: 0,
            total_actions: 0,
            total_repaid: 0,
            bump: 1,
            vault_bump: 1,
        }
    }

    #[test]
    fn delegation_cannot_exceed_ninety_days() {
        let mut policy = valid_policy(1_000);
        policy.expires_at = 1_000 + MAX_DELEGATION_SECONDS + 1;
        assert!(policy.validate(1_000).is_err());
    }
}
