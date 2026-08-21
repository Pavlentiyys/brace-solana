//! The exit guarantee of ТЗ §10.
//!
//! These three are the product's central promise: nothing the delegation does — not
//! pausing, not expiring, not revoking — can stand between the owner and their own
//! money. Proving it with pure functions would prove nothing, because the risk lives
//! in the account constraints, so each of these is a real signed withdrawal.

use guard_litesvm_tests::{SignedBy, TestEnv};

fn funded() -> TestEnv {
    let mut env = TestEnv::new();
    env.install();
    env
}

#[track_caller]
fn assert_full_withdrawal(env: &mut TestEnv) {
    let vault_before = env.vault_amount();
    assert!(vault_before > 0, "the vault must hold something to withdraw");

    let ix = env.withdraw_ix(u64::MAX);
    env.send(ix, SignedBy::Owner).expect("withdrawal must succeed");

    assert_eq!(env.vault_amount(), 0);
    assert_eq!(env.owner_amount(), vault_before);
}

#[test]
fn withdraw_works_when_revoked() {
    let mut env = funded();
    let revoke = env.revoke_ix();
    env.send(revoke, SignedBy::Owner).expect("revoke must succeed");
    assert_full_withdrawal(&mut env);
}

#[test]
fn withdraw_works_when_expired() {
    let mut env = TestEnv::new();
    env.config.expires_at = env.unix_timestamp - 1;
    env.install();
    assert_full_withdrawal(&mut env);
}

#[test]
fn withdraw_works_when_paused() {
    let mut env = TestEnv::new();
    env.config.paused = true;
    env.install();
    assert_full_withdrawal(&mut env);
}

#[test]
fn revoked_guard_stops_the_agent() {
    let mut env = funded();
    let revoke = env.revoke_ix();
    env.send(revoke, SignedBy::Owner).expect("revoke must succeed");

    // Revocation pauses, expires and clears the allowed actions all at once; the
    // pause check runs first, so that is the error the agent sees.
    guard_litesvm_tests::assert_guard_error(
        env.repay(guard_litesvm_tests::HEALTHY_REPAY),
        guard_litesvm_tests::ids::err::GUARD_PAUSED,
    );
}

#[test]
fn partial_withdrawal_leaves_the_remainder() {
    let mut env = funded();
    let vault_before = env.vault_amount();

    let ix = env.withdraw_ix(vault_before / 4);
    env.send(ix, SignedBy::Owner).expect("withdrawal must succeed");

    assert_eq!(env.vault_amount(), vault_before - vault_before / 4);
    assert_eq!(env.owner_amount(), vault_before / 4);
}

#[test]
fn withdrawal_over_the_vault_balance_is_rejected() {
    let mut env = funded();
    let ix = env.withdraw_ix(env.vault_amount() + 1);
    let result = env.send(ix, SignedBy::Owner);
    guard_litesvm_tests::assert_guard_error(
        result,
        guard_litesvm_tests::ids::err::AMOUNT_EXCEEDS_LIMIT,
    );
}
