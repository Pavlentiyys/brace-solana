use anchor_lang::{
    prelude::*,
    solana_program::{
        instruction::{AccountMeta, Instruction},
        program::invoke_signed,
    },
};

use super::{MarketAdapter, PositionState, RepayAccounts, RepayKeys, ReserveState};
use crate::{
    errors::GuardError,
    state::{FARMS_PROGRAM_ID, KLEND_PROGRAM_ID},
};

pub struct Kamino;

/// Raw offsets below are pinned to the audited upstream KLend account layout.
/// Owner, discriminator and minimum-size checks make incompatible upgrades fail
/// closed in most cases; a same-size field reorder still requires a new release.
pub const KLEND_LAYOUT_VERSION: &str = "1.25.0";

const OBLIGATION_DISCRIMINATOR: [u8; 8] = [168, 206, 141, 106, 88, 76, 172, 167];
const RESERVE_DISCRIMINATOR: [u8; 8] = [43, 242, 204, 202, 26, 247, 59, 127];
const REPAY_V2_DISCRIMINATOR: [u8; 8] = [116, 174, 213, 76, 180, 53, 210, 144];

const OBLIGATION_ACCOUNT_LEN: usize = 8 + 3_336;
const OBLIGATION_LAST_UPDATE_OFFSET: usize = 8 + 8;
const OBLIGATION_LENDING_MARKET_OFFSET: usize = 8 + 24;
const OBLIGATION_OWNER_OFFSET: usize = 8 + 56;
const OBLIGATION_DEPOSIT_RESERVES_OFFSET: usize = 8 + 88;
const OBLIGATION_DEPOSIT_ENTRY_SIZE: usize = 136;
const OBLIGATION_LIQUIDATION_LTV_OFFSET: usize = 8 + 1_176;
const OBLIGATION_DEPOSITED_VALUE_OFFSET: usize = 8 + 1_184;
const OBLIGATION_BORROWS_OFFSET: usize = 8 + 1_200;
const OBLIGATION_BORROW_ENTRY_SIZE: usize = 200;
const OBLIGATION_BORROWED_AMOUNT_OFFSET: usize = 88;
const OBLIGATION_BORROW_ADJUSTED_VALUE_OFFSET: usize = 120;
const OBLIGATION_DEBT_VALUE_OFFSET: usize = 8 + 2_200;

const RESERVE_ACCOUNT_LEN: usize = 8 + 8_616;
const RESERVE_LAST_UPDATE_OFFSET: usize = 8 + 8;
const RESERVE_LENDING_MARKET_OFFSET: usize = 8 + 24;
const RESERVE_LIQUIDITY_OFFSET: usize = 8 + 120;
const RESERVE_LIQUIDITY_MINT_OFFSET: usize = RESERVE_LIQUIDITY_OFFSET;
const RESERVE_LIQUIDITY_SUPPLY_OFFSET: usize = RESERVE_LIQUIDITY_OFFSET + 32;
const RESERVE_TOKEN_PROGRAM_OFFSET: usize = RESERVE_LIQUIDITY_OFFSET + 280;

const LAST_UPDATE_STALE_OFFSET: usize = 8;
const LAST_UPDATE_PRICE_STATUS_OFFSET: usize = 9;
const PRICE_STATUS_ALL_CHECKS: u8 = 0b0011_1111;

impl MarketAdapter for Kamino {
    fn read_position(obligation: &AccountInfo<'_>, debt_reserve: &Pubkey) -> Result<PositionState> {
        read_position_impl(obligation, debt_reserve, true)
    }

    fn read_reserve(reserve: &AccountInfo<'_>) -> Result<ReserveState> {
        require_keys_eq!(
            *reserve.owner,
            KLEND_PROGRAM_ID,
            GuardError::InvalidExternalAccount
        );

        let data = reserve.try_borrow_data()?;
        validate_account_data(&data, RESERVE_ACCOUNT_LEN, &RESERVE_DISCRIMINATOR)?;

        Ok(ReserveState {
            lending_market: read_pubkey(&data, RESERVE_LENDING_MARKET_OFFSET)?,
            liquidity_mint: read_pubkey(&data, RESERVE_LIQUIDITY_MINT_OFFSET)?,
            liquidity_supply: read_pubkey(&data, RESERVE_LIQUIDITY_SUPPLY_OFFSET)?,
            token_program: read_pubkey(&data, RESERVE_TOKEN_PROGRAM_OFFSET)?,
            last_update_slot: read_u64(&data, RESERVE_LAST_UPDATE_OFFSET)?,
            stale: read_u8(&data, RESERVE_LAST_UPDATE_OFFSET + LAST_UPDATE_STALE_OFFSET)? != 0,
            price_status: read_u8(
                &data,
                RESERVE_LAST_UPDATE_OFFSET + LAST_UPDATE_PRICE_STATUS_OFFSET,
            )?,
        })
    }

    fn validate_remaining_deposits(
        position: &PositionState,
        remaining_accounts: &[AccountInfo<'_>],
        lending_market: &Pubkey,
    ) -> Result<()> {
        require!(
            remaining_accounts.len() == usize::from(position.deposit_reserve_count),
            GuardError::InvalidRemainingAccounts
        );

        let expected = position
            .deposit_reserves
            .iter()
            .filter(|key| **key != Pubkey::default());

        for (expected_key, account) in expected.zip(remaining_accounts.iter()) {
            require_keys_eq!(
                *account.key,
                *expected_key,
                GuardError::InvalidRemainingAccounts
            );
            require!(account.is_writable, GuardError::InvalidRemainingAccounts);
            let reserve = Self::read_reserve(account)?;
            require_keys_eq!(
                reserve.lending_market,
                *lending_market,
                GuardError::InvalidRemainingAccounts
            );
        }
        Ok(())
    }

    fn repay_cpi<'info>(
        accounts: RepayAccounts<'_, 'info>,
        amount: u64,
        signer_seeds: &[&[&[u8]]],
    ) -> Result<()> {
        validate_program_accounts(
            *accounts.lending_program.key,
            accounts.lending_program.executable,
            *accounts.farms_program.key,
            accounts.farms_program.executable,
        )?;

        let instruction = build_repay_instruction(&accounts.keys(), amount);

        let mut infos = vec![
            accounts.vault_authority.clone(),
            accounts.obligation.clone(),
            accounts.lending_market.clone(),
            accounts.debt_reserve.clone(),
            accounts.reserve_liquidity_mint.clone(),
            accounts.reserve_liquidity_supply.clone(),
            accounts.vault.clone(),
            accounts.token_program.clone(),
            accounts.instruction_sysvar.clone(),
            accounts.lending_program.clone(),
            accounts.lending_program.clone(),
            accounts.lending_market_authority.clone(),
            accounts.farms_program.clone(),
        ];
        infos.extend(accounts.remaining_deposit_reserves.iter().cloned());
        infos.push(accounts.lending_program.clone());

        invoke_signed(&instruction, &infos, signer_seeds).map_err(Into::into)
    }
}

/// Builds the `repay_obligation_liquidity_v2` instruction.
///
/// The meta order mirrors upstream `RepayObligationLiquidityV2` field for field:
/// the flattened `RepayObligationLiquidity` accounts, then the two optional farm
/// slots, then `lending_market_authority` and `farms_program`, then the obligation's
/// deposit reserves as remaining accounts — which KLend's repay handler does consume.
///
/// Kept pure so ТЗ §10's "never moves funds past `reserve_liquidity_supply`" can be
/// asserted directly on the metas.
pub fn build_repay_instruction(keys: &RepayKeys, amount: u64) -> Instruction {
    let mut data = Vec::with_capacity(16);
    data.extend_from_slice(&REPAY_V2_DISCRIMINATOR);
    data.extend_from_slice(&amount.to_le_bytes());

    let mut metas = vec![
        AccountMeta::new_readonly(keys.vault_authority, true),
        AccountMeta::new(keys.obligation, false),
        AccountMeta::new_readonly(keys.lending_market, false),
        AccountMeta::new(keys.debt_reserve, false),
        AccountMeta::new_readonly(keys.reserve_liquidity_mint, false),
        AccountMeta::new(keys.reserve_liquidity_supply, false),
        AccountMeta::new(keys.vault, false),
        AccountMeta::new_readonly(keys.token_program, false),
        AccountMeta::new_readonly(keys.instruction_sysvar, false),
        // Anchor optional-account convention: the invoked program ID means None.
        AccountMeta::new_readonly(KLEND_PROGRAM_ID, false),
        AccountMeta::new_readonly(KLEND_PROGRAM_ID, false),
        AccountMeta::new_readonly(keys.lending_market_authority, false),
        AccountMeta::new_readonly(FARMS_PROGRAM_ID, false),
    ];
    metas.extend(
        keys.deposit_reserves
            .iter()
            .map(|reserve| AccountMeta::new(*reserve, false)),
    );

    Instruction {
        program_id: KLEND_PROGRAM_ID,
        accounts: metas,
        data,
    }
}

/// Index of the destination token account in the metas built above.
pub const REPAY_DESTINATION_META_INDEX: usize = 5;
/// Index of the source token account (the guard vault) in the metas built above.
pub const REPAY_SOURCE_META_INDEX: usize = 6;

impl Kamino {
    /// KLend removes a borrow entry when it is fully repaid. The aggregate
    /// obligation values remain stale until refresh, so post-CPI validation
    /// needs a parser that accepts an absent configured borrow as a zero balance.
    pub fn read_position_after_repay(
        obligation: &AccountInfo<'_>,
        debt_reserve: &Pubkey,
    ) -> Result<PositionState> {
        read_position_impl(obligation, debt_reserve, false)
    }

    pub fn oracle_checks_pass(price_status: u8) -> bool {
        price_status & PRICE_STATUS_ALL_CHECKS == PRICE_STATUS_ALL_CHECKS
    }
}

fn read_position_impl(
    obligation: &AccountInfo<'_>,
    debt_reserve: &Pubkey,
    debt_must_exist: bool,
) -> Result<PositionState> {
    require_keys_eq!(
        *obligation.owner,
        KLEND_PROGRAM_ID,
        GuardError::InvalidExternalAccount
    );

    let data = obligation.try_borrow_data()?;
    validate_account_data(&data, OBLIGATION_ACCOUNT_LEN, &OBLIGATION_DISCRIMINATOR)?;

    let mut deposit_reserves = [Pubkey::default(); 8];
    let mut deposit_reserve_count = 0_u8;
    for (index, destination) in deposit_reserves.iter_mut().enumerate() {
        let offset = OBLIGATION_DEPOSIT_RESERVES_OFFSET
            .checked_add(
                index
                    .checked_mul(OBLIGATION_DEPOSIT_ENTRY_SIZE)
                    .ok_or(GuardError::MathOverflow)?,
            )
            .ok_or(GuardError::MathOverflow)?;
        let reserve = read_pubkey(&data, offset)?;
        *destination = reserve;
        if reserve != Pubkey::default() {
            deposit_reserve_count = deposit_reserve_count
                .checked_add(1)
                .ok_or(GuardError::MathOverflow)?;
        }
    }

    let mut debt_borrowed_amount_sf = None;
    let mut debt_adjusted_market_value_sf = None;
    for index in 0..5_usize {
        let entry_offset = OBLIGATION_BORROWS_OFFSET
            .checked_add(
                index
                    .checked_mul(OBLIGATION_BORROW_ENTRY_SIZE)
                    .ok_or(GuardError::MathOverflow)?,
            )
            .ok_or(GuardError::MathOverflow)?;

        if read_pubkey(&data, entry_offset)? == *debt_reserve {
            require!(
                debt_borrowed_amount_sf.is_none(),
                GuardError::InvalidExternalAccount
            );
            debt_borrowed_amount_sf = Some(read_u128(
                &data,
                entry_offset + OBLIGATION_BORROWED_AMOUNT_OFFSET,
            )?);
            debt_adjusted_market_value_sf = Some(read_u128(
                &data,
                entry_offset + OBLIGATION_BORROW_ADJUSTED_VALUE_OFFSET,
            )?);
        }
    }

    let borrowed_amount_sf = debt_borrowed_amount_sf.unwrap_or_default();
    let adjusted_market_value_sf = debt_adjusted_market_value_sf.unwrap_or_default();
    if debt_must_exist {
        require!(
            borrowed_amount_sf > 0 && adjusted_market_value_sf > 0,
            GuardError::MissingDebtPosition
        );
    }

    Ok(PositionState {
        owner: read_pubkey(&data, OBLIGATION_OWNER_OFFSET)?,
        lending_market: read_pubkey(&data, OBLIGATION_LENDING_MARKET_OFFSET)?,
        collateral_value_sf: read_u128(&data, OBLIGATION_DEPOSITED_VALUE_OFFSET)?,
        debt_value_sf: read_u128(&data, OBLIGATION_DEBT_VALUE_OFFSET)?,
        debt_borrowed_amount_sf: borrowed_amount_sf,
        debt_adjusted_market_value_sf: adjusted_market_value_sf,
        liquidation_ltv_bps: u16::try_from(
            read_u64(&data, OBLIGATION_LIQUIDATION_LTV_OFFSET)?
                .checked_mul(100)
                .ok_or(GuardError::MathOverflow)?,
        )
        .map_err(|_| error!(GuardError::InvalidExternalAccount))?,
        deposit_reserves,
        deposit_reserve_count,
        last_update_slot: read_u64(&data, OBLIGATION_LAST_UPDATE_OFFSET)?,
        stale: read_u8(
            &data,
            OBLIGATION_LAST_UPDATE_OFFSET + LAST_UPDATE_STALE_OFFSET,
        )? != 0,
        price_status: read_u8(
            &data,
            OBLIGATION_LAST_UPDATE_OFFSET + LAST_UPDATE_PRICE_STATUS_OFFSET,
        )?,
    })
}

fn validate_account_data(data: &[u8], min_len: usize, discriminator: &[u8; 8]) -> Result<()> {
    require!(data.len() >= min_len, GuardError::InvalidExternalAccount);
    require!(
        data.get(..8) == Some(discriminator.as_slice()),
        GuardError::InvalidExternalAccount
    );
    Ok(())
}

fn validate_program_accounts(
    lending_program: Pubkey,
    lending_executable: bool,
    farms_program: Pubkey,
    farms_executable: bool,
) -> Result<()> {
    require_keys_eq!(
        lending_program,
        KLEND_PROGRAM_ID,
        GuardError::UnexpectedProgram
    );
    require!(lending_executable, GuardError::UnexpectedProgram);
    require_keys_eq!(
        farms_program,
        FARMS_PROGRAM_ID,
        GuardError::UnexpectedProgram
    );
    require!(farms_executable, GuardError::UnexpectedProgram);
    Ok(())
}

fn read_u8(data: &[u8], offset: usize) -> Result<u8> {
    data.get(offset)
        .copied()
        .ok_or_else(|| error!(GuardError::InvalidExternalAccount))
}

fn read_u64(data: &[u8], offset: usize) -> Result<u64> {
    let bytes: [u8; 8] = read_array(data, offset)?;
    Ok(u64::from_le_bytes(bytes))
}

fn read_u128(data: &[u8], offset: usize) -> Result<u128> {
    let bytes: [u8; 16] = read_array(data, offset)?;
    Ok(u128::from_le_bytes(bytes))
}

fn read_pubkey(data: &[u8], offset: usize) -> Result<Pubkey> {
    let bytes: [u8; 32] = read_array(data, offset)?;
    Ok(Pubkey::new_from_array(bytes))
}

fn read_array<const N: usize>(data: &[u8], offset: usize) -> Result<[u8; N]> {
    let end = offset.checked_add(N).ok_or(GuardError::MathOverflow)?;
    data.get(offset..end)
        .ok_or_else(|| error!(GuardError::InvalidExternalAccount))?
        .try_into()
        .map_err(|_| error!(GuardError::InvalidExternalAccount))
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    fn keys(deposit_count: usize) -> RepayKeys {
        RepayKeys {
            vault_authority: Pubkey::new_unique(),
            obligation: Pubkey::new_unique(),
            lending_market: Pubkey::new_unique(),
            debt_reserve: Pubkey::new_unique(),
            reserve_liquidity_mint: Pubkey::new_unique(),
            reserve_liquidity_supply: Pubkey::new_unique(),
            vault: Pubkey::new_unique(),
            token_program: Pubkey::new_unique(),
            instruction_sysvar: Pubkey::new_unique(),
            lending_market_authority: Pubkey::new_unique(),
            deposit_reserves: (0..deposit_count).map(|_| Pubkey::new_unique()).collect(),
        }
    }

    proptest! {
        /// ТЗ §10: funds must never move anywhere but `reserve_liquidity_supply`.
        ///
        /// The guard only ever moves tokens through this one instruction, and the
        /// only token accounts it can name are the vault it controls and the
        /// destination — which `validate_relationships` has already pinned to the
        /// reserve's own `liquidity_supply`. So it is enough to show that no other
        /// writable account, for any input, is a token account of ours.
        #[test]
        fn repay_only_ever_debits_the_vault_and_credits_the_reserve_supply(
            deposit_count in 0_usize..=8,
            amount in 0_u64..=u64::MAX,
        ) {
            let keys = keys(deposit_count);
            let instruction = build_repay_instruction(&keys, amount);

            prop_assert_eq!(instruction.program_id, KLEND_PROGRAM_ID);
            prop_assert_eq!(
                instruction.accounts[REPAY_SOURCE_META_INDEX].pubkey,
                keys.vault
            );
            prop_assert_eq!(
                instruction.accounts[REPAY_DESTINATION_META_INDEX].pubkey,
                keys.reserve_liquidity_supply
            );

            // Nothing else is writable except accounts KLend owns: the obligation and
            // the reserves. In particular no second token account can appear.
            let writable: Vec<Pubkey> = instruction
                .accounts
                .iter()
                .filter(|meta| meta.is_writable)
                .map(|meta| meta.pubkey)
                .collect();
            let mut allowed = vec![
                keys.obligation,
                keys.debt_reserve,
                keys.reserve_liquidity_supply,
                keys.vault,
            ];
            allowed.extend(keys.deposit_reserves.iter().copied());
            for account in &writable {
                prop_assert!(allowed.contains(account), "unexpected writable {account}");
            }
            prop_assert_eq!(writable.len(), 4 + deposit_count);

            // Only the vault authority may sign, and it is a PDA the guard controls.
            let signers: Vec<Pubkey> = instruction
                .accounts
                .iter()
                .filter(|meta| meta.is_signer)
                .map(|meta| meta.pubkey)
                .collect();
            prop_assert_eq!(signers, vec![keys.vault_authority]);

            // The amount is carried verbatim; the guard cannot be made to repay more
            // than it checked.
            prop_assert_eq!(&instruction.data[..8], &REPAY_V2_DISCRIMINATOR);
            prop_assert_eq!(&instruction.data[8..], &amount.to_le_bytes());
        }
    }

    #[test]
    fn repay_meta_order_matches_upstream_account_struct() {
        // Pinned against KLend `RepayObligationLiquidityV2`: the flattened repay
        // accounts, two `None` farm slots, lending market authority, farms program.
        let keys = keys(1);
        let instruction = build_repay_instruction(&keys, 1);
        let actual: Vec<Pubkey> = instruction.accounts.iter().map(|m| m.pubkey).collect();
        assert_eq!(
            actual,
            vec![
                keys.vault_authority,
                keys.obligation,
                keys.lending_market,
                keys.debt_reserve,
                keys.reserve_liquidity_mint,
                keys.reserve_liquidity_supply,
                keys.vault,
                keys.token_program,
                keys.instruction_sysvar,
                KLEND_PROGRAM_ID,
                KLEND_PROGRAM_ID,
                keys.lending_market_authority,
                FARMS_PROGRAM_ID,
                keys.deposit_reserves[0],
            ]
        );
    }

    #[test]
    fn oracle_status_requires_every_preventive_check() {
        assert!(Kamino::oracle_checks_pass(PRICE_STATUS_ALL_CHECKS));
        assert!(!Kamino::oracle_checks_pass(PRICE_STATUS_ALL_CHECKS ^ 1));
    }

    #[test]
    fn rejects_short_or_wrongly_typed_data() {
        assert!(validate_account_data(&[0; 8], 16, &OBLIGATION_DISCRIMINATOR).is_err());
        assert!(validate_account_data(&[0; 16], 16, &OBLIGATION_DISCRIMINATOR).is_err());
    }

    #[test]
    fn foreign_lending_program_rejected() {
        assert!(
            validate_program_accounts(Pubkey::new_unique(), true, FARMS_PROGRAM_ID, true).is_err()
        );
    }
}
