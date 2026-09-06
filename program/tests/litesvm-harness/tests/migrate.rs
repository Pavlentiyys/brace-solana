//! Growing an account the previous program wrote.
//!
//! The schedule added twenty bytes to `GuardConfig`, and an account written before
//! it cannot be deserialized at the new offsets. Refusing to read it is correct;
//! leaving it unreadable forever is not, because `init_guard` cannot replace an
//! occupied PDA and the owner would be locked out of a live authorization.
//!
//! These tests are about the one property that matters: after the migration the
//! account still says exactly what it said before, and the program can act on it.

use guard_litesvm_tests::{
    assert_guard_error,
    guard::{scheduled_policy, GuardConfigFixture, GUARD_CONFIG_LEN, PREVIOUS_GUARD_CONFIG_LEN},
    ids::err,
    SignedBy, TestEnv, HEALTHY_REPAY,
};
use solana_signer::Signer;

#[test]
fn a_previous_layout_account_is_grown_without_losing_anything() {
    let mut env = TestEnv::new();
    env.config.total_actions = 7;
    env.config.total_repaid = 1_234;
    env.config.actions_in_window = 1;
    env.install_previous_layout();

    assert_eq!(env.account_data(&env.guard).len(), PREVIOUS_GUARD_CONFIG_LEN);

    let ix = env.migrate_ix();
    env.send(ix, SignedBy::Owner).expect("the owner may migrate their own guard");

    let data = env.account_data(&env.guard);
    assert_eq!(data.len(), GUARD_CONFIG_LEN);

    // Everything that was there is still there, at its new offset.
    let (actions, repaid) = GuardConfigFixture::read_counters(&data);
    assert_eq!(actions, 7);
    assert_eq!(repaid, 1_234);

    let budgets = GuardConfigFixture::read_budgets(&data);
    assert_eq!(budgets.last_action_at, env.config.last_action_at);
    assert_eq!(budgets.window_started_at, env.config.window_started_at);
    assert_eq!(budgets.actions_in_window, 1);
    // The one field that could not be recovered, started at now rather than at zero.
    assert_eq!(budgets.last_scheduled_at, env.unix_timestamp);
}

/// The point of the whole exercise: the authorization keeps working.
#[test]
fn the_agent_can_act_on_a_migrated_guard() {
    let mut env = TestEnv::new();
    env.install_previous_layout();

    let ix = env.migrate_ix();
    env.send(ix, SignedBy::Owner).expect("migration must succeed");

    let vault_before = env.vault_amount();
    env.repay(HEALTHY_REPAY).expect("a migrated guard is a working guard");
    assert_eq!(env.vault_amount(), vault_before - HEALTHY_REPAY);
}

/// The migration writes zeros into the schedule fields, so a guard that predates the
/// feature comes out with the feature switched off rather than with an interval read
/// from whatever bytes happened to be next.
#[test]
fn a_migrated_guard_has_no_schedule() {
    let mut env = TestEnv::new();
    env.install_previous_layout();

    let ix = env.migrate_ix();
    env.send(ix, SignedBy::Owner).expect("migration must succeed");

    assert_guard_error(
        env.scheduled_repay(50),
        err::ACTION_NOT_ALLOWED,
    );
}

#[test]
fn migrating_twice_is_refused_rather_than_shifting_the_bytes_again() {
    let mut env = TestEnv::new();
    env.install_previous_layout();

    let first = env.migrate_ix();
    env.send(first, SignedBy::Owner).expect("migration must succeed");

    // Same instruction, same payer, same blockhash: without this the runtime rejects
    // the resend as a duplicate signature and the test proves nothing about the
    // program.
    env.svm.expire_blockhash();

    let second = env.migrate_ix();
    assert_guard_error(env.send(second, SignedBy::Owner), err::INVALID_EXTERNAL_ACCOUNT);
}

/// An account already at the current length was never the previous layout, so the
/// same length check refuses it. Nothing else in the suite would notice if this
/// re-shifted a healthy account into nonsense.
#[test]
fn a_current_account_is_not_migrated() {
    let mut env = TestEnv::new();
    scheduled_policy(&mut env.config);
    env.install();

    let ix = env.migrate_ix();
    assert_guard_error(env.send(ix, SignedBy::Owner), err::INVALID_EXTERNAL_ACCOUNT);
}

#[test]
fn only_the_owner_may_migrate() {
    let mut env = TestEnv::new();
    env.config.owner = env.agent.pubkey();
    env.install_previous_layout();

    // The account now names the agent as its owner, so the real owner signing is a
    // mismatch — and the PDA no longer derives from this signer either.
    let ix = env.migrate_ix();
    assert!(env.send(ix, SignedBy::Owner).is_err());
}
