//! The two grants that repay a position nobody is about to liquidate.
//!
//! `execute_action(ACTION_SCHEDULED_REPAY, ..)` is the agent making a payment the
//! owner scheduled; `owner_repay` is the owner making one now. Both step outside the
//! trigger and the target, which are the two rules the rest of this suite exists to
//! enforce, so the tests here are mostly about what did *not* get relaxed with them.

use guard_litesvm_tests::{
    assert_guard_error,
    guard::{scheduled_policy, GuardConfigFixture},
    ids::{err, ACTION_SCHEDULED_REPAY},
    kamino::{q60, BorrowFixture, ObligationFixture},
    SignedBy, TestEnv, HEALTHY_REPAY,
};
use solana_pubkey::Pubkey;
use solana_signer::Signer;

/// A guard whose owner armed a weekly schedule capped at 50.
fn scheduled_env() -> TestEnv {
    let mut env = TestEnv::new();
    scheduled_policy(&mut env.config);
    env.install();
    env
}

/// The same, over a position at 50% LTV: healthy, well under the 80% trigger, and
/// therefore untouchable by every other path in this program.
fn healthy_scheduled_env() -> TestEnv {
    let mut env = TestEnv::new();
    scheduled_policy(&mut env.config);
    env.obligation_state.borrows =
        vec![BorrowFixture::new(env.debt_reserve, q60(500), q60(500))];
    env.obligation_state.debt_value_sf = q60(500);
    env.install();
    env
}

#[test]
fn a_scheduled_repay_pays_down_a_healthy_position() {
    let mut env = healthy_scheduled_env();
    let vault_before = env.vault_amount();
    let supply_before = env.supply_amount();

    // The emergency path refuses this exact position, which is the point of the
    // second grant existing at all.
    assert_guard_error(env.repay(HEALTHY_REPAY), err::TRIGGER_NOT_MET);

    env.scheduled_repay(50).expect("a due schedule must pay");

    assert_eq!(env.vault_amount(), vault_before - 50);
    assert_eq!(env.supply_amount(), supply_before + 50);

    let obligation = env.account_data(&env.obligation);
    let (borrowed, _) = ObligationFixture::read_borrow(&obligation, &env.debt_reserve).unwrap();
    assert_eq!(borrowed, q60(450));
    assert_eq!(
        ObligationFixture::read_deposited_value(&obligation),
        q60(1_000),
        "a repay never moves the collateral"
    );
}

#[test]
fn a_schedule_that_was_not_granted_is_refused() {
    let mut env = TestEnv::new();
    env.install();
    assert_guard_error(env.scheduled_repay(50), err::ACTION_NOT_ALLOWED);
}

#[test]
fn a_schedule_that_is_not_due_is_refused() {
    let mut env = TestEnv::new();
    scheduled_policy(&mut env.config);
    env.config.last_scheduled_at =
        env.unix_timestamp - i64::from(env.config.schedule_seconds) + 1;
    env.install();
    assert_guard_error(env.scheduled_repay(50), err::SCHEDULE_NOT_DUE);
}

/// The schedule's cap is its own, and it is the smaller one. A scheduled repay must
/// not be able to spend up to the emergency limit just because the same guard grants
/// both.
#[test]
fn a_scheduled_repay_cannot_spend_the_emergency_limit() {
    let mut env = scheduled_env();
    assert!(env.config.max_action_amount > env.config.schedule_amount);
    assert_guard_error(
        env.scheduled_repay(env.config.schedule_amount + 1),
        err::AMOUNT_EXCEEDS_LIMIT,
    );
}

/// The reason the two budgets are kept apart: a routine payment must not be able to
/// put the guard into cooldown, because the crash arrives when it arrives.
#[test]
fn a_scheduled_repay_leaves_the_emergency_budget_alone() {
    let mut env = scheduled_env();
    let before = GuardConfigFixture::read_budgets(&env.account_data(&env.guard));

    env.scheduled_repay(50).expect("a due schedule must pay");

    let after = GuardConfigFixture::read_budgets(&env.account_data(&env.guard));
    assert_eq!(
        after.last_action_at, before.last_action_at,
        "a scheduled payment must not start the emergency cooldown"
    );
    assert_eq!(
        after.actions_in_window, before.actions_in_window,
        "a scheduled payment must not spend a slot in the action window"
    );
    assert_eq!(after.window_started_at, before.window_started_at);
    assert_eq!(
        after.last_scheduled_at, env.unix_timestamp,
        "it moves its own clock and only its own"
    );
}

/// And the reverse: an exhausted action window is about emergencies, and says
/// nothing about the payment the owner scheduled.
#[test]
fn a_spent_action_window_does_not_stop_the_schedule() {
    let mut env = TestEnv::new();
    scheduled_policy(&mut env.config);
    env.config.actions_in_window = env.config.max_actions_per_window;
    env.config.window_started_at = env.unix_timestamp - 60;
    env.install();

    assert_guard_error(env.repay(HEALTHY_REPAY), err::RATE_LIMIT_EXCEEDED);
    env.scheduled_repay(50).expect("the schedule is not rate limited by the window");
}

#[test]
fn a_paused_or_expired_guard_still_refuses_the_schedule() {
    let mut paused = TestEnv::new();
    scheduled_policy(&mut paused.config);
    paused.config.paused = true;
    paused.install();
    assert_guard_error(paused.scheduled_repay(50), err::GUARD_PAUSED);

    let mut expired = TestEnv::new();
    scheduled_policy(&mut expired.config);
    expired.config.expires_at = expired.unix_timestamp;
    expired.install();
    assert_guard_error(expired.scheduled_repay(50), err::GUARD_EXPIRED);
}

#[test]
fn only_the_configured_agent_may_run_the_schedule() {
    let mut env = TestEnv::new();
    scheduled_policy(&mut env.config);
    env.config.agent = Pubkey::new_unique();
    env.install();
    assert_guard_error(env.scheduled_repay(50), err::UNAUTHORIZED_AGENT);
}

/// A scheduled payment is money moved by the agent, so it counts in both totals.
#[test]
fn a_scheduled_repay_is_recorded() {
    let mut env = healthy_scheduled_env();
    let (actions_before, repaid_before) =
        GuardConfigFixture::read_counters(&env.account_data(&env.guard));

    env.scheduled_repay(50).expect("a due schedule must pay");

    let (actions, repaid) = GuardConfigFixture::read_counters(&env.account_data(&env.guard));
    assert_eq!(actions, actions_before + 1);
    assert_eq!(repaid, repaid_before + 50);
}

#[test]
fn an_owner_repay_pays_down_a_healthy_position() {
    let mut env = healthy_scheduled_env();
    let vault_before = env.vault_amount();
    let supply_before = env.supply_amount();

    env.owner_repay(120).expect("the owner may repay their own debt");

    assert_eq!(env.vault_amount(), vault_before - 120);
    assert_eq!(env.supply_amount(), supply_before + 120);
}

/// "All" means the whole reserve, and it is allowed to take the position far below
/// the target. Overshooting is what was asked for.
#[test]
fn an_owner_repay_of_everything_empties_the_reserve() {
    let mut env = healthy_scheduled_env();
    let vault_before = env.vault_amount();
    assert!(vault_before > 0);

    env.owner_repay(u64::MAX).expect("all of it is a valid amount");

    assert_eq!(env.vault_amount(), 0);
    let obligation = env.account_data(&env.obligation);
    let (borrowed, _) = ObligationFixture::read_borrow(&obligation, &env.debt_reserve).unwrap();
    assert_eq!(borrowed, q60(500) - (u128::from(vault_before) << 60));
}

#[test]
fn an_owner_repay_of_more_than_the_reserve_is_refused() {
    let mut env = healthy_scheduled_env();
    let too_much = env.vault_amount() + 1;
    assert_guard_error(env.owner_repay(too_much), err::AMOUNT_EXCEEDS_LIMIT);
}

#[test]
fn an_owner_repay_of_nothing_is_refused() {
    let mut env = healthy_scheduled_env();
    assert_guard_error(env.owner_repay(0), err::INVALID_AMOUNT);
}

/// The agent holds a delegation to `execute_action` and nothing else. It must not
/// reach the unbounded path by signing the owner's instruction.
#[test]
fn the_agent_cannot_sign_an_owner_repay() {
    let mut env = healthy_scheduled_env();
    // The agent puts itself in the owner slot and signs. `has_one = owner` is what
    // stands between a delegation to `execute_action` and the unbounded path.
    let ix = env.owner_repay_ix_as(env.agent.pubkey(), 120);
    assert_guard_error(env.send(ix, SignedBy::Agent), err::UNAUTHORIZED_OWNER);
}

/// Pause and expiry restrict the agent. They are not locks on the owner's own money,
/// exactly as `withdraw_reserve` already treats them.
#[test]
fn a_paused_or_expired_guard_still_lets_the_owner_repay() {
    let mut paused = healthy_scheduled_env();
    paused.config.paused = true;
    paused.install();
    paused.owner_repay(50).expect("pause stops the agent, not the owner");

    let mut expired = healthy_scheduled_env();
    expired.config.expires_at = expired.unix_timestamp;
    expired.install();
    expired
        .owner_repay(50)
        .expect("an ended delegation is not a lock on the reserve");
}

/// Relaxing the LTV window did not relax the invariants. The guard still refuses a
/// repay it cannot prove improved the position.
#[test]
fn a_planned_repay_still_has_to_improve_the_position() {
    let mut env = healthy_scheduled_env();
    // Mock mode 1 makes the mock KLend take the funds and leave the borrow alone.
    env.obligation_state.mock_mode = 1;
    env.install();

    assert_guard_error(env.scheduled_repay(50), err::ACTION_WOULD_NOT_IMPROVE);
    assert_guard_error(env.owner_repay(50), err::ACTION_WOULD_NOT_IMPROVE);
}

#[test]
fn a_stale_obligation_still_blocks_both_paths() {
    let mut env = healthy_scheduled_env();
    env.obligation_state.stale = true;
    env.install();

    assert_guard_error(env.scheduled_repay(50), err::STALE_OBLIGATION);
    assert_guard_error(env.owner_repay(50), err::STALE_OBLIGATION);
}

/// The schedule bit is not a licence to take the reserve elsewhere. Every account
/// relationship the emergency path checks is checked here too.
#[test]
fn a_foreign_reserve_supply_is_refused_on_both_paths() {
    let mut env = healthy_scheduled_env();
    env.debt_reserve_state.liquidity_supply = Pubkey::new_unique();
    env.install();

    assert_guard_error(
        env.scheduled_repay(50),
        err::INVALID_MARKET_RELATIONSHIP,
    );
    assert_guard_error(env.owner_repay(50), err::INVALID_MARKET_RELATIONSHIP);
}

/// A scheduled repay is not permitted to reach `ACTION_TOP_UP`, or anything else the
/// program has no path for.
#[test]
fn an_unknown_action_kind_is_still_refused() {
    let mut env = scheduled_env();
    let ix = env.execute_action_ix(ACTION_SCHEDULED_REPAY | 1 << 4, 50);
    assert_guard_error(env.send(ix, SignedBy::Agent), err::ACTION_NOT_ALLOWED);
}
