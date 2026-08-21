//! The `execute_action` half of ТЗ §10, as real transactions against the compiled
//! program. Every test mutates exactly one thing away from a scenario that is
//! otherwise known to succeed — the happy path below is what makes the negatives
//! meaningful, because it proves they are not all failing for some shared setup
//! reason.

use guard_litesvm_tests::{
    assert_guard_error,
    ids::{err, ACTION_REPAY, ACTION_TOP_UP, SPL_TOKEN_ID},
    kamino::{q60, ObligationFixture, PRICE_STATUS_ALL_CHECKS},
    TestEnv, HEALTHY_REPAY,
};
use solana_pubkey::Pubkey;

fn env() -> TestEnv {
    let mut env = TestEnv::new();
    env.install();
    env
}

#[test]
fn healthy_repay_moves_funds_and_improves_the_position() {
    let mut env = env();
    let vault_before = env.vault_amount();
    let supply_before = env.supply_amount();

    env.repay(HEALTHY_REPAY).expect("repay must succeed");

    // Funds went to the reserve's liquidity supply and nowhere else.
    assert_eq!(env.vault_amount(), vault_before - HEALTHY_REPAY);
    assert_eq!(env.supply_amount(), supply_before + HEALTHY_REPAY);

    // The borrow shrank by the repaid amount, in Q60.
    let obligation = env.account_data(&env.obligation);
    let (borrowed, adjusted) =
        ObligationFixture::read_borrow(&obligation, &env.debt_reserve).unwrap();
    assert_eq!(borrowed, q60(750));
    assert_eq!(adjusted, q60(750));

    // Collateral is untouched: repaying never moves the denominator.
    assert_eq!(ObligationFixture::read_deposited_value(&obligation), q60(1_000));

    let (actions, repaid) =
        guard_litesvm_tests::guard::GuardConfigFixture::read_counters(&env.account_data(&env.guard));
    assert_eq!(actions, 2);
    assert_eq!(repaid, u64::from(HEALTHY_REPAY as u32));
}

#[test]
fn agent_mismatch_rejected() {
    let mut env = TestEnv::new();
    env.config.agent = Pubkey::new_unique();
    env.install();
    assert_guard_error(env.repay(HEALTHY_REPAY), err::UNAUTHORIZED_AGENT);
}

#[test]
fn paused_rejected() {
    let mut env = TestEnv::new();
    env.config.paused = true;
    env.install();
    assert_guard_error(env.repay(HEALTHY_REPAY), err::GUARD_PAUSED);
}

#[test]
fn expired_rejected() {
    let mut env = TestEnv::new();
    // Expiry is exclusive: `now < expires_at` must hold.
    env.config.expires_at = env.unix_timestamp;
    env.install();
    assert_guard_error(env.repay(HEALTHY_REPAY), err::GUARD_EXPIRED);
}

#[test]
fn cooldown_rejected() {
    let mut env = TestEnv::new();
    env.config.last_action_at = env.unix_timestamp - i64::from(env.config.cooldown_seconds) + 1;
    env.install();
    assert_guard_error(env.repay(HEALTHY_REPAY), err::COOLDOWN_ACTIVE);
}

#[test]
fn window_limit_rejected() {
    let mut env = TestEnv::new();
    env.config.actions_in_window = env.config.max_actions_per_window;
    env.config.window_started_at = env.unix_timestamp - 60;
    env.install();
    assert_guard_error(env.repay(HEALTHY_REPAY), err::RATE_LIMIT_EXCEEDED);
}

#[test]
fn window_rolls_over_once_the_window_has_elapsed() {
    let mut env = TestEnv::new();
    env.config.actions_in_window = env.config.max_actions_per_window;
    env.config.window_started_at =
        env.unix_timestamp - i64::from(env.config.window_seconds) - 1;
    env.install();
    env.repay(HEALTHY_REPAY)
        .expect("a fresh window must accept the action");
}

#[test]
fn disallowed_action_rejected() {
    let mut env = env();
    let ix = env.execute_action_ix(ACTION_TOP_UP, HEALTHY_REPAY);
    let result = env.send(ix, guard_litesvm_tests::SignedBy::Agent);
    assert_guard_error(result, err::ACTION_NOT_ALLOWED);
}

#[test]
fn amount_over_limit_rejected() {
    let mut env = env();
    let over = env.config.max_action_amount + 1;
    assert_guard_error(env.repay(over), err::AMOUNT_EXCEEDS_LIMIT);
}

#[test]
fn amount_over_vault_rejected() {
    let mut env = TestEnv::new();
    // Under the per-action cap but over what the vault actually holds.
    env.vault_balance = HEALTHY_REPAY - 1;
    env.install();
    assert_guard_error(env.repay(HEALTHY_REPAY), err::AMOUNT_EXCEEDS_LIMIT);
}

#[test]
fn zero_amount_rejected() {
    let mut env = env();
    assert_guard_error(env.repay(0), err::INVALID_AMOUNT);
}

#[test]
fn stale_obligation_rejected() {
    let mut env = TestEnv::new();
    env.obligation_state.stale = true;
    env.install();
    assert_guard_error(env.repay(HEALTHY_REPAY), err::STALE_OBLIGATION);
}

#[test]
fn obligation_refreshed_too_many_slots_ago_rejected() {
    let mut env = TestEnv::new();
    // MAX_OBLIGATION_STALENESS_SLOTS is 2; three slots of drift must not pass.
    env.obligation_state.slot = env.slot - 3;
    env.install();
    assert_guard_error(env.repay(HEALTHY_REPAY), err::STALE_OBLIGATION);
}

#[test]
fn stale_oracle_rejected() {
    let mut env = TestEnv::new();
    // One preventive check short of the full set.
    env.obligation_state.price_status = PRICE_STATUS_ALL_CHECKS ^ 1;
    env.install();
    assert_guard_error(env.repay(HEALTHY_REPAY), err::STALE_ORACLE);
}

#[test]
fn unrefreshed_liquidation_threshold_rejected() {
    let mut env = TestEnv::new();
    // The sentinel a real mainnet obligation carries before `refresh_obligation`
    // runs — see tests/mainnet_layout.rs, where it is observed on live bytes.
    env.obligation_state.liquidation_ltv_pct = 255;
    env.install();
    assert_guard_error(env.repay(HEALTHY_REPAY), err::STALE_OBLIGATION);
}

#[test]
fn ltv_below_trigger_rejected() {
    let mut env = TestEnv::new();
    // 700 / 1000 = 7000 bps, below the 8000 bps trigger.
    env.obligation_state.debt_value_sf = q60(700);
    env.install();
    assert_guard_error(env.repay(HEALTHY_REPAY), err::TRIGGER_NOT_MET);
}

#[test]
fn overcorrection_rejected() {
    // Reaching the 7000 bps target needs 150; 151 overshoots it.
    let mut over = env();
    assert_guard_error(over.repay(151), err::OVERCORRECTION);

    // And 150 exactly is still allowed, which is what makes 151 the boundary
    // rather than just a number that happens to fail.
    let mut exact = env();
    exact.repay(150).expect("repaying exactly to target must pass");
}

#[test]
fn no_improvement_rejected() {
    let mut env = TestEnv::new();
    // The mock takes the tokens but leaves the obligation alone.
    env.obligation_state.mock_mode = 1;
    env.install();
    assert_guard_error(env.repay(HEALTHY_REPAY), err::ACTION_WOULD_NOT_IMPROVE);
}

#[test]
fn collateral_change_during_cpi_rejected() {
    let mut env = TestEnv::new();
    // The mock repays but also shrinks the collateral. A repay must never move the
    // LTV denominator, so the post-CPI invariant has to catch it.
    env.obligation_state.mock_mode = 2;
    env.install();
    assert_guard_error(env.repay(HEALTHY_REPAY), err::POST_CPI_INVARIANT);
}

#[test]
fn foreign_lending_program_rejected() {
    let mut env = TestEnv::new();
    // An executable program that simply is not KLend.
    env.lending_program = SPL_TOKEN_ID;
    env.install();
    assert_guard_error(env.repay(HEALTHY_REPAY), err::UNEXPECTED_PROGRAM);
}

#[test]
fn durable_nonce_replay_rejected() {
    let mut env = TestEnv::new();
    env.install();

    // Signed while the position is over its trigger and the action is legitimate.
    let ix = env.execute_action_ix(ACTION_REPAY, HEALTHY_REPAY);
    let pre_signed = env.build_tx(ix, guard_litesvm_tests::SignedBy::Agent);

    // The price recovers before the transaction is submitted. A durable-nonce
    // transaction stays valid indefinitely, so the only thing standing between a
    // held signature and an unwanted repay is re-reading live state at execution.
    env.obligation_state.debt_value_sf = q60(700);
    env.slot += 1;
    env.obligation_state.slot = env.slot;
    env.debt_reserve_state.slot = env.slot;
    env.collateral_reserve_state.slot = env.slot;
    env.unix_timestamp += 1;
    env.install();

    assert_guard_error(env.send_tx(pre_signed), err::TRIGGER_NOT_MET);
}

#[test]
fn rejected_action_leaves_guard_counters_untouched() {
    let mut env = TestEnv::new();
    env.config.paused = true;
    env.install();
    let before = guard_litesvm_tests::guard::GuardConfigFixture::read_counters(
        &env.account_data(&env.guard),
    );

    assert_guard_error(env.repay(HEALTHY_REPAY), err::GUARD_PAUSED);

    let after = guard_litesvm_tests::guard::GuardConfigFixture::read_counters(
        &env.account_data(&env.guard),
    );
    assert_eq!(before, after);
    assert_eq!(env.vault_amount(), env.vault_balance);
}
