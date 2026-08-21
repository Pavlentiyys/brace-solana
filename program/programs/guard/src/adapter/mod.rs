use anchor_lang::prelude::*;

pub mod kamino;

use crate::{errors::GuardError, math::BPS};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PositionState {
    pub owner: Pubkey,
    pub lending_market: Pubkey,
    pub collateral_value_sf: u128,
    pub debt_value_sf: u128,
    pub debt_borrowed_amount_sf: u128,
    pub debt_adjusted_market_value_sf: u128,
    pub liquidation_ltv_bps: u16,
    pub deposit_reserves: [Pubkey; 8],
    pub deposit_reserve_count: u8,
    pub last_update_slot: u64,
    pub stale: bool,
    pub price_status: u8,
}

impl PositionState {
    /// The liquidation threshold, rejected unless it is a plausible percentage.
    ///
    /// KLend only populates `lowest_reserve_deposit_liquidation_ltv` during
    /// `refresh_obligation`. On mainnet an un-refreshed obligation carries the
    /// sentinel 255, which this adapter would otherwise read as 25500 bps — and every
    /// "the trigger must sit below the liquidation threshold" comparison would pass
    /// vacuously, silently disarming the one check that keeps a policy from being
    /// configured above the point of no return.
    ///
    /// A value outside 1..=BPS therefore means the obligation was not refreshed, and
    /// that is what the error says. Callers that legitimately read a post-repay
    /// obligation do not use this value at all and are unaffected.
    pub fn checked_liquidation_ltv_bps(&self) -> Result<u16> {
        require!(
            self.liquidation_ltv_bps > 0 && u64::from(self.liquidation_ltv_bps) <= BPS,
            GuardError::StaleObligation
        );
        Ok(self.liquidation_ltv_bps)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
/// Deliberately carries no liquidation threshold. The guard compares against the
/// obligation's `lowest_reserve_deposit_liquidation_ltv`, which is the conservative
/// bound over the deposit side; the debt reserve's own threshold says nothing about
/// when this position gets liquidated. Parsing it anyway would only widen the
/// layout surface — `liquidation_threshold_pct` has already moved within
/// `ReserveConfig` across KLend releases.
pub struct ReserveState {
    pub lending_market: Pubkey,
    pub liquidity_mint: Pubkey,
    pub liquidity_supply: Pubkey,
    pub token_program: Pubkey,
    pub last_update_slot: u64,
    pub stale: bool,
    pub price_status: u8,
}

/// The address half of [`RepayAccounts`], separated so the CPI instruction can be
/// built — and property-tested — without a runtime. ТЗ §10 asks for proof that funds
/// never move anywhere but `reserve_liquidity_supply`; that is a statement about
/// these keys and the metas derived from them, so the derivation has to be reachable
/// from a plain unit test.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RepayKeys {
    pub vault_authority: Pubkey,
    pub obligation: Pubkey,
    pub lending_market: Pubkey,
    pub debt_reserve: Pubkey,
    pub reserve_liquidity_mint: Pubkey,
    pub reserve_liquidity_supply: Pubkey,
    pub vault: Pubkey,
    pub token_program: Pubkey,
    pub instruction_sysvar: Pubkey,
    pub lending_market_authority: Pubkey,
    pub deposit_reserves: Vec<Pubkey>,
}

pub struct RepayAccounts<'a, 'info> {
    pub vault_authority: &'a AccountInfo<'info>,
    pub obligation: &'a AccountInfo<'info>,
    pub lending_market: &'a AccountInfo<'info>,
    pub debt_reserve: &'a AccountInfo<'info>,
    pub reserve_liquidity_mint: &'a AccountInfo<'info>,
    pub reserve_liquidity_supply: &'a AccountInfo<'info>,
    pub vault: &'a AccountInfo<'info>,
    pub token_program: &'a AccountInfo<'info>,
    pub instruction_sysvar: &'a AccountInfo<'info>,
    pub lending_market_authority: &'a AccountInfo<'info>,
    pub lending_program: &'a AccountInfo<'info>,
    pub farms_program: &'a AccountInfo<'info>,
    pub remaining_deposit_reserves: &'a [AccountInfo<'info>],
}

impl RepayAccounts<'_, '_> {
    pub fn keys(&self) -> RepayKeys {
        RepayKeys {
            vault_authority: *self.vault_authority.key,
            obligation: *self.obligation.key,
            lending_market: *self.lending_market.key,
            debt_reserve: *self.debt_reserve.key,
            reserve_liquidity_mint: *self.reserve_liquidity_mint.key,
            reserve_liquidity_supply: *self.reserve_liquidity_supply.key,
            vault: *self.vault.key,
            token_program: *self.token_program.key,
            instruction_sysvar: *self.instruction_sysvar.key,
            lending_market_authority: *self.lending_market_authority.key,
            deposit_reserves: self
                .remaining_deposit_reserves
                .iter()
                .map(|account| *account.key)
                .collect(),
        }
    }
}

pub trait MarketAdapter {
    fn read_position(obligation: &AccountInfo<'_>, debt_reserve: &Pubkey) -> Result<PositionState>;

    fn read_reserve(reserve: &AccountInfo<'_>) -> Result<ReserveState>;

    fn validate_remaining_deposits(
        position: &PositionState,
        remaining_accounts: &[AccountInfo<'_>],
        lending_market: &Pubkey,
    ) -> Result<()>;

    fn repay_cpi<'info>(
        accounts: RepayAccounts<'_, 'info>,
        amount: u64,
        signer_seeds: &[&[&[u8]]],
    ) -> Result<()>;
}
