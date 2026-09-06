//! `GuardConfig` account bytes and instruction builders.
//!
//! The struct is all fixed-width primitives, so Borsh is just concatenation in
//! declaration order — no need to pull Anchor into this workspace.

use solana_pubkey::Pubkey;

use crate::ids::{ACTION_REPAY, GUARD_PROGRAM_ID, SEED_GUARD, SEED_VAULT};

pub const GUARD_CONFIG_DISCRIMINATOR: [u8; 8] = [95, 175, 118, 50, 193, 113, 37, 250];

/// 7 pubkeys (224) + 82 bytes of scalars, matching `#[derive(InitSpace)]`.
///
/// Grew by 20 when the repayment schedule landed: `schedule_seconds` (4),
/// `schedule_amount` (8) and `last_scheduled_at` (8). The number is restated here
/// rather than imported, so a layout change that this harness has not been taught
/// about fails the `to_bytes` assertion instead of silently packing garbage.
pub const GUARD_CONFIG_INIT_SPACE: usize = 306;
pub const GUARD_CONFIG_LEN: usize = 8 + GUARD_CONFIG_INIT_SPACE;

#[derive(Clone, Debug)]
pub struct GuardConfigFixture {
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

    pub schedule_seconds: u32,
    pub schedule_amount: u64,

    pub expires_at: i64,
    pub paused: bool,

    pub last_action_at: i64,
    pub window_started_at: i64,
    pub actions_in_window: u8,
    pub last_scheduled_at: i64,
    pub total_actions: u32,
    pub total_repaid: u64,

    pub bump: u8,
    pub vault_bump: u8,
}

impl GuardConfigFixture {
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut data = Vec::with_capacity(GUARD_CONFIG_LEN);
        data.extend_from_slice(&GUARD_CONFIG_DISCRIMINATOR);
        for key in [
            &self.owner,
            &self.agent,
            &self.obligation,
            &self.lending_market,
            &self.debt_reserve,
            &self.vault,
            &self.vault_mint,
        ] {
            data.extend_from_slice(key.as_ref());
        }
        data.extend_from_slice(&self.trigger_ltv_bps.to_le_bytes());
        data.extend_from_slice(&self.target_ltv_bps.to_le_bytes());
        data.extend_from_slice(&self.max_action_amount.to_le_bytes());
        data.push(self.max_actions_per_window);
        data.extend_from_slice(&self.window_seconds.to_le_bytes());
        data.extend_from_slice(&self.cooldown_seconds.to_le_bytes());
        data.push(self.allowed_actions);
        data.extend_from_slice(&self.schedule_seconds.to_le_bytes());
        data.extend_from_slice(&self.schedule_amount.to_le_bytes());
        data.extend_from_slice(&self.expires_at.to_le_bytes());
        data.push(u8::from(self.paused));
        data.extend_from_slice(&self.last_action_at.to_le_bytes());
        data.extend_from_slice(&self.window_started_at.to_le_bytes());
        data.push(self.actions_in_window);
        data.extend_from_slice(&self.last_scheduled_at.to_le_bytes());
        data.extend_from_slice(&self.total_actions.to_le_bytes());
        data.extend_from_slice(&self.total_repaid.to_le_bytes());
        data.push(self.bump);
        data.push(self.vault_bump);
        assert_eq!(data.len(), GUARD_CONFIG_LEN, "GuardConfig layout drifted");
        data
    }

    /// Reads `total_actions` and `total_repaid` back out, so tests can assert that a
    /// rejected action left no trace in guard state.
    pub fn read_counters(data: &[u8]) -> (u32, u64) {
        let base = 8 + 224 + 2 + 2 + 8 + 1 + 4 + 4 + 1 + 4 + 8 + 8 + 1 + 8 + 8 + 1 + 8;
        (
            u32::from_le_bytes(data[base..base + 4].try_into().unwrap()),
            u64::from_le_bytes(data[base + 4..base + 12].try_into().unwrap()),
        )
    }
}

impl GuardConfigFixture {
    /// The emergency budget and the schedule clock, so a test can assert that one
    /// path left the other's counters alone without having to land a second
    /// transaction (which the mock obligation's slot would read as stale).
    ///
    /// Offsets restated from the layout above rather than derived from it, for the
    /// same reason the layout is restated from the program.
    pub fn read_budgets(data: &[u8]) -> Budgets {
        let last_action_at = 8 + 224 + 2 + 2 + 8 + 1 + 4 + 4 + 1 + 4 + 8 + 8 + 1;
        let window_started_at = last_action_at + 8;
        let actions_in_window = window_started_at + 8;
        let last_scheduled_at = actions_in_window + 1;
        Budgets {
            last_action_at: i64::from_le_bytes(
                data[last_action_at..last_action_at + 8].try_into().unwrap(),
            ),
            window_started_at: i64::from_le_bytes(
                data[window_started_at..window_started_at + 8]
                    .try_into()
                    .unwrap(),
            ),
            actions_in_window: data[actions_in_window],
            last_scheduled_at: i64::from_le_bytes(
                data[last_scheduled_at..last_scheduled_at + 8]
                    .try_into()
                    .unwrap(),
            ),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Budgets {
    pub last_action_at: i64,
    pub window_started_at: i64,
    pub actions_in_window: u8,
    pub last_scheduled_at: i64,
}

/// The account as the previous program wrote it: no schedule fields, 294 bytes.
///
/// Kept as a second encoder rather than derived from the current one, because its
/// whole job is to be the layout `migrate_guard` has to cope with. Deriving it from
/// `to_bytes` would make it agree with whatever that becomes.
pub const PREVIOUS_GUARD_CONFIG_LEN: usize = 294;

impl GuardConfigFixture {
    pub fn to_previous_bytes(&self) -> Vec<u8> {
        let mut data = Vec::with_capacity(PREVIOUS_GUARD_CONFIG_LEN);
        data.extend_from_slice(&GUARD_CONFIG_DISCRIMINATOR);
        for key in [
            &self.owner,
            &self.agent,
            &self.obligation,
            &self.lending_market,
            &self.debt_reserve,
            &self.vault,
            &self.vault_mint,
        ] {
            data.extend_from_slice(key.as_ref());
        }
        data.extend_from_slice(&self.trigger_ltv_bps.to_le_bytes());
        data.extend_from_slice(&self.target_ltv_bps.to_le_bytes());
        data.extend_from_slice(&self.max_action_amount.to_le_bytes());
        data.push(self.max_actions_per_window);
        data.extend_from_slice(&self.window_seconds.to_le_bytes());
        data.extend_from_slice(&self.cooldown_seconds.to_le_bytes());
        data.push(self.allowed_actions);
        data.extend_from_slice(&self.expires_at.to_le_bytes());
        data.push(u8::from(self.paused));
        data.extend_from_slice(&self.last_action_at.to_le_bytes());
        data.extend_from_slice(&self.window_started_at.to_le_bytes());
        data.push(self.actions_in_window);
        data.extend_from_slice(&self.total_actions.to_le_bytes());
        data.extend_from_slice(&self.total_repaid.to_le_bytes());
        data.push(self.bump);
        data.push(self.vault_bump);
        assert_eq!(data.len(), PREVIOUS_GUARD_CONFIG_LEN, "previous layout drifted");
        data
    }
}

pub fn migrate_guard_data() -> Vec<u8> {
    crate::ids::ix::MIGRATE_GUARD.to_vec()
}

pub fn guard_pda(owner: &Pubkey, obligation: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[SEED_GUARD, owner.as_ref(), obligation.as_ref()],
        &GUARD_PROGRAM_ID,
    )
}

pub fn vault_pda(guard: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[SEED_VAULT, guard.as_ref()], &GUARD_PROGRAM_ID)
}

pub fn execute_action_data(action_kind: u8, amount: u64) -> Vec<u8> {
    let mut data = Vec::with_capacity(17);
    data.extend_from_slice(&crate::ids::ix::EXECUTE_ACTION);
    data.push(action_kind);
    data.extend_from_slice(&amount.to_le_bytes());
    data
}

pub fn withdraw_reserve_data(amount: u64) -> Vec<u8> {
    let mut data = Vec::with_capacity(16);
    data.extend_from_slice(&crate::ids::ix::WITHDRAW_RESERVE);
    data.extend_from_slice(&amount.to_le_bytes());
    data
}

pub fn owner_repay_data(amount: u64) -> Vec<u8> {
    let mut data = Vec::with_capacity(16);
    data.extend_from_slice(&crate::ids::ix::OWNER_REPAY);
    data.extend_from_slice(&amount.to_le_bytes());
    data
}

pub fn revoke_data() -> Vec<u8> {
    crate::ids::ix::REVOKE.to_vec()
}

/// A policy that triggers at 80% and aims for 70%, with limits loose enough that a
/// test has to opt in to hitting any one of them.
pub fn default_policy(config: &mut GuardConfigFixture) {
    config.trigger_ltv_bps = 8_000;
    config.target_ltv_bps = 7_000;
    config.max_action_amount = 200;
    config.max_actions_per_window = 2;
    config.window_seconds = 3_600;
    config.cooldown_seconds = 30;
    config.allowed_actions = ACTION_REPAY;
    config.schedule_seconds = 0;
    config.schedule_amount = 0;
}

/// The same policy with a weekly schedule armed, capped well below the emergency
/// limit so the two budgets stay distinguishable in assertions.
pub fn scheduled_policy(config: &mut GuardConfigFixture) {
    default_policy(config);
    config.allowed_actions = ACTION_REPAY | crate::ids::ACTION_SCHEDULED_REPAY;
    config.schedule_seconds = 7 * 24 * 60 * 60;
    config.schedule_amount = 50;
}
