#![allow(clippy::manual_div_ceil, clippy::assign_op_pattern)]

use core::fmt;

use uint::construct_uint;

pub const BPS: u64 = 10_000;

construct_uint! {
    struct U256(4);
}

pub const FRACTIONAL_BITS: u32 = 60;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MathError {
    DivisionByZero,
    Overflow,
    RepayExceedsBorrow,
}

impl fmt::Display for MathError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::DivisionByZero => formatter.write_str("division by zero"),
            Self::Overflow => formatter.write_str("arithmetic overflow"),
            Self::RepayExceedsBorrow => formatter.write_str("repay exceeds borrowed amount"),
        }
    }
}

/// Loan to value in integer basis points, truncated toward zero and clamped to BPS.
///
/// This is the cross-implementation contract of ТЗ §7; the shared cases live in
/// `vectors/ltv-bps.json` and are exercised by [`tests::shared_vectors_agree`].
///
/// Clamping is a storage decision, not a modelling one: the result is a `u16` and
/// every configured trigger is at most BPS, so a true ratio above BPS is above every
/// trigger and so is the clamped value. Off-chain implementations report the
/// unclamped number, which is why the vector file records both.
///
/// A position with no collateral and no debt is empty, not maximally unhealthy — it
/// reads as zero. With debt outstanding and nothing backing it, BPS is the correct
/// reading and keeps comparisons total.
pub fn ltv_bps(collateral: u128, debt: u128) -> Result<u16, MathError> {
    if collateral == 0 {
        return Ok(if debt > 0 { BPS as u16 } else { 0 });
    }

    let value = mul_div_floor(debt, u128::from(BPS), collateral)?;
    Ok(value.min(u128::from(BPS)) as u16)
}

/// Required risk-adjusted debt value reduction to reach the target LTV.
pub fn repay_value_for_target(
    collateral: u128,
    debt: u128,
    target_bps: u16,
) -> Result<u128, MathError> {
    let desired_debt = mul_div_floor(collateral, u128::from(target_bps), u128::from(BPS))?;
    Ok(debt.saturating_sub(desired_debt))
}

/// Converts a native-token repay amount into the obligation's risk-adjusted
/// quote-value scale using the refreshed borrow position itself.
pub fn adjusted_repay_value(
    borrowed_amount_sf: u128,
    adjusted_market_value_sf: u128,
    repay_amount: u64,
) -> Result<u128, MathError> {
    if borrowed_amount_sf == 0 {
        return Err(MathError::DivisionByZero);
    }

    let repay_amount_sf = u128::from(repay_amount)
        .checked_shl(FRACTIONAL_BITS)
        .ok_or(MathError::Overflow)?;
    if repay_amount_sf > borrowed_amount_sf {
        return Err(MathError::RepayExceedsBorrow);
    }

    adjusted_value_for_borrow_reduction(
        borrowed_amount_sf,
        adjusted_market_value_sf,
        repay_amount_sf,
    )
}

/// Converts an observed Q60 borrow-balance reduction into the obligation's
/// risk-adjusted quote-value scale. This is used after KLend CPI because repay
/// marks aggregate obligation values stale but immediately updates the borrow.
pub fn adjusted_value_for_borrow_reduction(
    borrowed_amount_sf: u128,
    adjusted_market_value_sf: u128,
    reduction_sf: u128,
) -> Result<u128, MathError> {
    if borrowed_amount_sf == 0 {
        return Err(MathError::DivisionByZero);
    }
    if reduction_sf > borrowed_amount_sf {
        return Err(MathError::RepayExceedsBorrow);
    }

    mul_div_floor(adjusted_market_value_sf, reduction_sf, borrowed_amount_sf)
}

fn mul_div_floor(left: u128, right: u128, denominator: u128) -> Result<u128, MathError> {
    if denominator == 0 {
        return Err(MathError::DivisionByZero);
    }

    let value = U256::from(left)
        .checked_mul(U256::from(right))
        .ok_or(MathError::Overflow)?
        / U256::from(denominator);

    if value > U256::from(u128::MAX) {
        return Err(MathError::Overflow);
    }
    Ok(value.low_u128())
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    #[test]
    fn zero_collateral_with_debt_is_max_ltv() {
        assert_eq!(ltv_bps(0, 1).unwrap(), BPS as u16);
    }

    #[test]
    fn an_empty_position_is_zero_not_max() {
        assert_eq!(ltv_bps(0, 0).unwrap(), 0);
    }

    /// ТЗ §7: the formula lives in four implementations and they must agree. This
    /// runs the canonical file; `frontend/lib/ltv/shared-vectors.test.ts` runs the
    /// same one. If either drifts, exactly one of the two goes red.
    #[test]
    fn shared_vectors_agree() {
        let raw = include_str!("../../../vectors/ltv-bps.json");
        let vectors: serde_json::Value = serde_json::from_str(raw).expect("valid vector file");

        let parse = |value: &serde_json::Value| -> u128 {
            value.as_str().expect("values are decimal strings").parse().unwrap()
        };

        let ltv_cases = vectors["ltvCases"].as_array().expect("ltvCases");
        assert!(!ltv_cases.is_empty(), "the vector file must not be empty");
        for case in ltv_cases {
            let name = case["name"].as_str().unwrap();
            let collateral = parse(&case["collateralValue"]);
            let debt = parse(&case["debtValue"]);
            let expected = case["clampedLtvBps"].as_u64().unwrap() as u16;
            assert_eq!(
                ltv_bps(collateral, debt).unwrap(),
                expected,
                "ltv vector: {name}"
            );
        }

        let repay_cases = vectors["repayCases"].as_array().expect("repayCases");
        assert!(!repay_cases.is_empty(), "the vector file must not be empty");
        for case in repay_cases {
            let name = case["name"].as_str().unwrap();
            let collateral = parse(&case["collateralValue"]);
            let debt = parse(&case["debtValue"]);
            let target = case["targetBps"].as_u64().unwrap() as u16;
            assert_eq!(
                repay_value_for_target(collateral, debt, target).unwrap(),
                parse(&case["repayValue"]),
                "repay vector: {name}"
            );
        }
    }

    #[test]
    fn zero_debt_is_zero_ltv() {
        assert_eq!(ltv_bps(1_000, 0).unwrap(), 0);
    }

    #[test]
    fn boundary_vector_is_exact() {
        assert_eq!(ltv_bps(1_000_000, 800_000).unwrap(), 8_000);
        assert_eq!(
            repay_value_for_target(1_000_000, 800_000, 7_000).unwrap(),
            100_000
        );
    }

    #[test]
    fn proportional_native_amount_conversion_uses_q60_scale() {
        let borrowed_amount_sf = u128::from(100_u64) << FRACTIONAL_BITS;
        let adjusted_value_sf = 250_u128 << FRACTIONAL_BITS;
        assert_eq!(
            adjusted_repay_value(borrowed_amount_sf, adjusted_value_sf, 10).unwrap(),
            25_u128 << FRACTIONAL_BITS
        );
    }

    #[test]
    fn amount_above_borrow_is_rejected() {
        let borrowed_amount_sf = u128::from(5_u64) << FRACTIONAL_BITS;
        assert_eq!(
            adjusted_repay_value(borrowed_amount_sf, 10_u128 << FRACTIONAL_BITS, 6),
            Err(MathError::RepayExceedsBorrow)
        );
    }

    #[test]
    fn observed_q60_reduction_maps_to_adjusted_value() {
        let borrowed_amount_sf = 100_u128 << FRACTIONAL_BITS;
        let adjusted_value_sf = 250_u128 << FRACTIONAL_BITS;
        let reduction_sf = 20_u128 << FRACTIONAL_BITS;
        assert_eq!(
            adjusted_value_for_borrow_reduction(
                borrowed_amount_sf,
                adjusted_value_sf,
                reduction_sf
            )
            .unwrap(),
            50_u128 << FRACTIONAL_BITS
        );
    }

    proptest! {
        #[test]
        fn repay_never_increases_ltv(
            collateral in 1_u128..=u64::MAX as u128,
            debt in 1_u128..=u64::MAX as u128,
            reduction in 0_u128..=u32::MAX as u128,
        ) {
            let applied = reduction.min(debt);
            let before = ltv_bps(collateral, debt).unwrap();
            let after = ltv_bps(collateral, debt - applied).unwrap();
            prop_assert!(after <= before);
        }

        #[test]
        fn target_repay_does_not_exceed_debt(
            collateral in 0_u128..=u64::MAX as u128,
            debt in 0_u128..=u64::MAX as u128,
            target in 0_u16..=BPS as u16,
        ) {
            let needed = repay_value_for_target(collateral, debt, target).unwrap();
            prop_assert!(needed <= debt);
        }
    }
}
