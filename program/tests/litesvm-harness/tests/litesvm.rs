//! Harness smoke tests and the §9 compute-budget measurement.

use guard_litesvm_tests::{artifacts_available, TestEnv, HEALTHY_REPAY};
use litesvm::LiteSVM;

#[test]
fn litesvm_runtime_boots_with_rent_and_spl_programs() {
    let svm = LiteSVM::new();
    assert!(svm.minimum_balance_for_rent_exemption(165) > 0);
}

#[test]
fn compiled_artifacts_are_present() {
    assert!(
        artifacts_available(),
        "build both programs first:\n  \
         cargo build-sbf --manifest-path programs/guard/Cargo.toml\n  \
         cargo build-sbf --manifest-path tests/mock-klend/Cargo.toml"
    );
}

/// ТЗ §9 asks for the compute budget of the cycle. This measures the guard's own
/// share — its validation plus the CPI — against a mock KLend. The real refresh
/// instructions are measured separately on a mainnet fork; the number here is the
/// floor, and it is the part this repository controls.
#[test]
fn execute_action_compute_budget_is_reported() {
    let mut env = TestEnv::new();
    env.install();
    let units = env.repay_compute_units(HEALTHY_REPAY);

    println!("execute_action consumed {units} compute units (guard + mock CPI)");
    assert!(
        units < 200_000,
        "the guard alone must fit in a default compute budget, used {units}"
    );
}
