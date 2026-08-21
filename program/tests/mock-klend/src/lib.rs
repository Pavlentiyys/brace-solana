//! A stand-in for KLend, deployed inside LiteSVM at the real `KLEND_PROGRAM_ID`.
//!
//! The guard hardcodes that address, which is what makes this possible: LiteSVM
//! will load any ELF at any address, so the guard's CPI reaches this program
//! believing it is Kamino.
//!
//! It implements exactly as much of `repay_obligation_liquidity_v2` as the guard's
//! pre- and post-CPI invariants can observe:
//!
//!   * the same instruction discriminator and `u64` amount encoding,
//!   * the same account order (see `RepayObligationLiquidityV2` upstream),
//!   * an SPL-token transfer `user_source_liquidity -> reserve_destination_liquidity`
//!     authorised by the signer in slot 0,
//!   * the same *partial* obligation update real KLend performs.
//!
//! That last point matters more than it looks. On repay, KLend decrements the borrow
//! entry and marks the obligation stale, but does **not** recompute the aggregate
//! `borrow_factor_adjusted_debt_value_sf` until the next refresh. The guard's
//! `validate_post_cpi_health` is written against that behaviour — it derives the new
//! LTV from the observed borrow reduction rather than reading the stale aggregate. A
//! mock that helpfully updated the aggregate would make a broken guard pass.

#![allow(unexpected_cfgs)]

use solana_program::{
    account_info::AccountInfo,
    entrypoint::ProgramResult,
    instruction::{AccountMeta, Instruction},
    program::invoke,
    program_error::ProgramError,
    pubkey::Pubkey,
};

#[cfg(not(feature = "no-entrypoint"))]
solana_program::entrypoint!(process_instruction);

/// `repay_obligation_liquidity_v2`, same value the guard's adapter sends.
pub const REPAY_V2_DISCRIMINATOR: [u8; 8] = [116, 174, 213, 76, 180, 53, 210, 144];

// Obligation offsets, mirroring `adapter/kamino.rs`. Duplicated rather than shared:
// this crate must stay independent of the guard's dependency graph, and a mock that
// imported the constants it is meant to test would validate nothing.
const OBLIGATION_LAST_UPDATE_OFFSET: usize = 8 + 8;
const OBLIGATION_STALE_OFFSET: usize = OBLIGATION_LAST_UPDATE_OFFSET + 8;
const OBLIGATION_DEPOSITED_VALUE_OFFSET: usize = 8 + 1_184;
const OBLIGATION_BORROWS_OFFSET: usize = 8 + 1_200;
const OBLIGATION_BORROW_ENTRY_SIZE: usize = 200;
const OBLIGATION_BORROW_COUNT: usize = 5;
const BORROW_RESERVE_OFFSET: usize = 0;
const BORROWED_AMOUNT_OFFSET: usize = 88;
const BORROW_ADJUSTED_VALUE_OFFSET: usize = 120;

/// Last byte of the account, deep inside `padding_3`. The guard's adapter never
/// reads past `borrow_factor_adjusted_debt_value_sf` at 2216, so parking test
/// control here cannot influence anything the guard actually parses.
pub const MOCK_MODE_OFFSET: usize = 8 + 3_335;

/// Behave like KLend: move the tokens, decrement the borrow, mark stale.
pub const MODE_NORMAL: u8 = 0;
/// Take the tokens but leave the obligation untouched. Drives the guard's post-CPI
/// "the position did not actually improve" path.
pub const MODE_NO_POSITION_CHANGE: u8 = 1;
/// Move the tokens and also shrink the collateral. Drives the guard's post-CPI
/// "collateral must not change" invariant.
pub const MODE_STEAL_COLLATERAL: u8 = 2;

const FRACTIONAL_BITS: u32 = 60;
const SPL_TOKEN_TRANSFER_TAG: u8 = 3;

pub fn process_instruction(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    // Hand-rolled rather than `split_at_checked`, which the 1.79 SBF toolchain
    // does not have.
    if data.get(..8) != Some(REPAY_V2_DISCRIMINATOR.as_slice()) {
        return Err(ProgramError::InvalidInstructionData);
    }
    let amount = u64::from_le_bytes(
        data.get(8..16)
            .ok_or(ProgramError::InvalidInstructionData)?
            .try_into()
            .map_err(|_| ProgramError::InvalidInstructionData)?,
    );

    // Same order as upstream `RepayObligationLiquidityV2`.
    let authority = accounts.first().ok_or(ProgramError::NotEnoughAccountKeys)?;
    let obligation = accounts.get(1).ok_or(ProgramError::NotEnoughAccountKeys)?;
    let repay_reserve = accounts.get(3).ok_or(ProgramError::NotEnoughAccountKeys)?;
    let destination = accounts.get(5).ok_or(ProgramError::NotEnoughAccountKeys)?;
    let source = accounts.get(6).ok_or(ProgramError::NotEnoughAccountKeys)?;
    let token_program = accounts.get(7).ok_or(ProgramError::NotEnoughAccountKeys)?;

    if !authority.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    let mode = {
        let data = obligation.try_borrow_data()?;
        *data
            .get(MOCK_MODE_OFFSET)
            .ok_or(ProgramError::AccountDataTooSmall)?
    };

    // The vault PDA signed the guard's `invoke_signed`, so its signer privilege is
    // already present in this instruction context and carries into a plain `invoke`.
    invoke(
        &Instruction {
            program_id: *token_program.key,
            accounts: vec![
                AccountMeta::new(*source.key, false),
                AccountMeta::new(*destination.key, false),
                AccountMeta::new_readonly(*authority.key, true),
            ],
            data: {
                let mut data = Vec::with_capacity(9);
                data.push(SPL_TOKEN_TRANSFER_TAG);
                data.extend_from_slice(&amount.to_le_bytes());
                data
            },
        },
        &[source.clone(), destination.clone(), authority.clone()],
    )?;

    if mode == MODE_NO_POSITION_CHANGE {
        return Ok(());
    }

    let mut data = obligation.try_borrow_mut_data()?;

    if mode == MODE_STEAL_COLLATERAL {
        let collateral = read_u128(&data, OBLIGATION_DEPOSITED_VALUE_OFFSET)?;
        write_u128(
            &mut data,
            OBLIGATION_DEPOSITED_VALUE_OFFSET,
            collateral / 2,
        )?;
    }

    apply_repay(&mut data, repay_reserve.key, amount)?;

    // KLend marks the obligation stale and leaves the aggregate debt value alone.
    *data
        .get_mut(OBLIGATION_STALE_OFFSET)
        .ok_or(ProgramError::AccountDataTooSmall)? = 1;
    Ok(())
}

/// Decrements the matching borrow entry the way KLend does: the Q60 principal falls
/// by the repaid amount, and the risk-adjusted market value falls in proportion.
fn apply_repay(data: &mut [u8], repay_reserve: &Pubkey, amount: u64) -> ProgramResult {
    for index in 0..OBLIGATION_BORROW_COUNT {
        let entry = OBLIGATION_BORROWS_OFFSET + index * OBLIGATION_BORROW_ENTRY_SIZE;
        let reserve = data
            .get(entry + BORROW_RESERVE_OFFSET..entry + BORROW_RESERVE_OFFSET + 32)
            .ok_or(ProgramError::AccountDataTooSmall)?;
        if reserve != repay_reserve.as_ref() {
            continue;
        }

        let borrowed = read_u128(data, entry + BORROWED_AMOUNT_OFFSET)?;
        let adjusted = read_u128(data, entry + BORROW_ADJUSTED_VALUE_OFFSET)?;
        let repaid = u128::from(amount) << FRACTIONAL_BITS;
        let remaining = borrowed.saturating_sub(repaid);

        // Scale the ratio down to whole units before multiplying. Both values are
        // Q60, so each is about 2^60 times its whole-unit magnitude and
        // `adjusted * remaining` overflows u128 for any realistic position. Doing
        // the reduction in whole units keeps the product small and is exact for the
        // whole-unit amounts the fixtures use — a mock has no business carrying a
        // 256-bit mul-div just to reproduce sub-unit dust.
        let borrowed_units = borrowed >> FRACTIONAL_BITS;
        let remaining_units = remaining >> FRACTIONAL_BITS;
        let adjusted_remaining = if borrowed_units == 0 {
            0
        } else {
            adjusted
                .checked_mul(remaining_units)
                .and_then(|value| value.checked_div(borrowed_units))
                .ok_or(ProgramError::ArithmeticOverflow)?
        };

        write_u128(data, entry + BORROWED_AMOUNT_OFFSET, remaining)?;
        write_u128(data, entry + BORROW_ADJUSTED_VALUE_OFFSET, adjusted_remaining)?;
        return Ok(());
    }
    Err(ProgramError::InvalidArgument)
}

fn read_u128(data: &[u8], offset: usize) -> Result<u128, ProgramError> {
    Ok(u128::from_le_bytes(
        data.get(offset..offset + 16)
            .ok_or(ProgramError::AccountDataTooSmall)?
            .try_into()
            .map_err(|_| ProgramError::AccountDataTooSmall)?,
    ))
}

fn write_u128(data: &mut [u8], offset: usize, value: u128) -> ProgramResult {
    data.get_mut(offset..offset + 16)
        .ok_or(ProgramError::AccountDataTooSmall)?
        .copy_from_slice(&value.to_le_bytes());
    Ok(())
}
