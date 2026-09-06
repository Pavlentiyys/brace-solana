use anchor_lang::prelude::*;

use crate::{
    adapter::{kamino::Kamino, PositionState},
    errors::GuardError,
    math::{
        adjusted_repay_value, adjusted_value_for_borrow_reduction, ltv_bps, repay_value_for_target,
    },
    state::{GuardConfig, MAX_OBLIGATION_STALENESS_SLOTS},
};

/// What a repay has to prove about the position, on either side of the CPI.
///
/// Split out of `execute_action` once repaying stopped meaning only one thing. The
/// invariants that hold for every repay — collateral untouched, debt strictly down,
/// LTV never worse — live here once, so a second caller cannot quietly ship with a
/// weaker version of them.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RepayMode {
    /// The agent acting on the LTV rule. It may only fire at or above the trigger,
    /// and it may not overshoot the target: this is somebody else spending the
    /// reserve, so the size of the action is bounded on both ends.
    Trigger,
    /// A repay the owner asked for, whether on a schedule they set or on the spot.
    ///
    /// The health invariants still apply, but there is no LTV window to stay
    /// inside. Paying down a healthy loan is the point rather than an overshoot,
    /// and the trigger has nothing to say about it.
    Planned,
}

pub fn validate_freshness(
    current_slot: u64,
    last_update_slot: u64,
    stale: bool,
    price_status: u8,
) -> Result<()> {
    require!(!stale, GuardError::StaleObligation);
    let elapsed = current_slot
        .checked_sub(last_update_slot)
        .ok_or(GuardError::StaleObligation)?;
    require!(
        elapsed <= MAX_OBLIGATION_STALENESS_SLOTS,
        GuardError::StaleObligation
    );
    require!(
        Kamino::oracle_checks_pass(price_status),
        GuardError::StaleOracle
    );
    Ok(())
}

pub fn validate_pre_cpi_health(
    guard: &GuardConfig,
    position: &PositionState,
    amount: u64,
    mode: RepayMode,
) -> Result<u16> {
    // Applies in every mode. It is the guard's own coherence check, and it doubles
    // as proof that the obligation was refreshed: an un-refreshed one carries a
    // sentinel threshold that `checked_liquidation_ltv_bps` rejects.
    require!(
        guard.trigger_ltv_bps < position.checked_liquidation_ltv_bps()?,
        GuardError::InvalidPolicy
    );
    let ltv_before = map_math(ltv_bps(
        position.collateral_value_sf,
        position.debt_value_sf,
    ))?;
    if mode == RepayMode::Trigger {
        require!(
            ltv_before >= guard.trigger_ltv_bps,
            GuardError::TriggerNotMet
        );
    }

    let requested_repay_value = map_math(adjusted_repay_value(
        position.debt_borrowed_amount_sf,
        position.debt_adjusted_market_value_sf,
        amount,
    ))?;
    require!(requested_repay_value > 0, GuardError::ActionWouldNotImprove);

    if mode == RepayMode::Trigger {
        let required_repay_value = map_math(repay_value_for_target(
            position.collateral_value_sf,
            position.debt_value_sf,
            guard.target_ltv_bps,
        ))?;
        require!(
            requested_repay_value <= required_repay_value,
            GuardError::Overcorrection
        );
    }
    Ok(ltv_before)
}

pub fn validate_post_cpi_health(
    guard: &GuardConfig,
    before: &PositionState,
    after: &PositionState,
    ltv_before: u16,
    mode: RepayMode,
) -> Result<u16> {
    require!(
        after.collateral_value_sf == before.collateral_value_sf,
        GuardError::PostCpiInvariant
    );
    let borrow_reduction_sf = before
        .debt_borrowed_amount_sf
        .checked_sub(after.debt_borrowed_amount_sf)
        .ok_or(GuardError::PostCpiInvariant)?;
    require!(borrow_reduction_sf > 0, GuardError::ActionWouldNotImprove);
    let adjusted_reduction_sf = map_math(adjusted_value_for_borrow_reduction(
        before.debt_borrowed_amount_sf,
        before.debt_adjusted_market_value_sf,
        borrow_reduction_sf,
    ))?;
    let debt_after_sf = before
        .debt_value_sf
        .checked_sub(adjusted_reduction_sf)
        .ok_or(GuardError::PostCpiInvariant)?;

    // Improvement is asserted on the exact risk-adjusted debt value, not on the LTV
    // in basis points. `ltv_bps` clamps to BPS because it returns a `u16`, so an
    // underwater position — one whose true LTV is above 100%, which is exactly what a
    // sharp drop produces before liquidators arrive — reads as 10000 both before and
    // after any repay. A strict comparison on the clamped value can never hold there,
    // and the guard would refuse to act precisely when the position most needs it.
    //
    // With collateral pinned unchanged above, a strict fall in debt value is both
    // necessary and sufficient for the position to have improved, and it holds at
    // every magnitude. A repay too small to move the risk-adjusted value fails here,
    // which is correct: it would spend a rate-limit slot and buy nothing.
    require!(
        debt_after_sf < before.debt_value_sf,
        GuardError::ActionWouldNotImprove
    );

    let ltv_after = map_math(ltv_bps(after.collateral_value_sf, debt_after_sf))?;
    // Non-strict: the reported LTV must never get worse, but it is allowed to be
    // unchanged where the clamp hides a real improvement.
    require!(ltv_after <= ltv_before, GuardError::ActionWouldNotImprove);
    if mode == RepayMode::Trigger {
        require!(ltv_after >= guard.target_ltv_bps, GuardError::Overcorrection);
    }
    Ok(ltv_after)
}

pub fn map_math<T>(result: core::result::Result<T, crate::math::MathError>) -> Result<T> {
    result.map_err(|_| error!(GuardError::MathOverflow))
}
