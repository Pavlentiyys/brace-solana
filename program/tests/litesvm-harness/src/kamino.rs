//! Byte-exact KLend `Obligation` and `Reserve` blobs.
//!
//! The offsets here were read off KLend `master` field by field and are written out
//! independently of `adapter/kamino.rs`. Because the two are derived separately, the
//! tests that round-trip a fixture through the adapter are a genuine layout
//! regression check: if either side drifts, they disagree.
//!
//! `Fraction` in KLend is `U68F60`, so every `_sf` field is a `u128` with 60
//! fractional bits — hence [`q60`].

use solana_pubkey::Pubkey;

pub const OBLIGATION_DISCRIMINATOR: [u8; 8] = [168, 206, 141, 106, 88, 76, 172, 167];
pub const RESERVE_DISCRIMINATOR: [u8; 8] = [43, 242, 204, 202, 26, 247, 59, 127];

pub const OBLIGATION_LEN: usize = 8 + 3_336;
pub const RESERVE_LEN: usize = 8 + 8_616;

pub const FRACTIONAL_BITS: u32 = 60;

/// Whole units into KLend's `U68F60` fixed-point representation.
pub fn q60(value: u64) -> u128 {
    u128::from(value) << FRACTIONAL_BITS
}

// --- Obligation -------------------------------------------------------------
// tag u64 @8, last_update{slot u64, stale u8, price_status u8, _pad[6]} @16,
// lending_market @32, owner @64, deposits[8] @96 (136 each),
// lowest_reserve_deposit_liquidation_ltv u64 @1184, deposited_value_sf u128 @1192,
// borrows[5] @1208 (200 each), borrow_factor_adjusted_debt_value_sf u128 @2208.
const O_SLOT: usize = 16;
const O_STALE: usize = 24;
const O_PRICE_STATUS: usize = 25;
const O_LENDING_MARKET: usize = 32;
const O_OWNER: usize = 64;
const O_DEPOSITS: usize = 96;
const O_DEPOSIT_ENTRY: usize = 136;
const O_DEPOSIT_MARKET_VALUE: usize = 40;
const O_LIQUIDATION_LTV: usize = 1_184;
const O_DEPOSITED_VALUE: usize = 1_192;
const O_BORROWS: usize = 1_208;
const O_BORROW_ENTRY: usize = 200;
const O_BORROW_CUMULATIVE_RATE: usize = 32;
const O_BORROWED_AMOUNT: usize = 88;
const O_BORROW_MARKET_VALUE: usize = 104;
const O_BORROW_ADJUSTED_VALUE: usize = 120;
const O_DEBT_VALUE: usize = 2_208;
/// `has_debt` @2288, past everything the guard reads but checked by real KLend.
const O_HAS_DEBT: usize = 8 + 2_280;

/// `ReserveLiquidity::cumulative_borrow_rate_bsf`, the value a borrow entry has to
/// match for KLend's interest accrual to be a no-op.
pub const RESERVE_CUMULATIVE_BORROW_RATE_OFFSET: usize = R_LIQUIDITY + 168;

/// Must match `MOCK_MODE_OFFSET` in `tests/mock-klend`: the final byte of the
/// account, deep inside `padding_3` and far past anything the adapter parses.
const O_MOCK_MODE: usize = 8 + 3_335;

// --- Reserve ----------------------------------------------------------------
// version u64 @8, last_update @16, lending_market @32, farm_collateral @64,
// farm_debt @96, liquidity @128 (mint @+0, supply_vault @+32, token_program @+280).
const R_SLOT: usize = 16;
const R_STALE: usize = 24;
const R_PRICE_STATUS: usize = 25;
const R_LENDING_MARKET: usize = 32;
const R_LIQUIDITY: usize = 128;
const R_LIQUIDITY_MINT: usize = R_LIQUIDITY;
const R_LIQUIDITY_SUPPLY: usize = R_LIQUIDITY + 32;
const R_TOKEN_PROGRAM: usize = R_LIQUIDITY + 280;

/// Every oracle preventive check passed, which is what the guard demands.
pub const PRICE_STATUS_ALL_CHECKS: u8 = 0b0011_1111;

#[derive(Clone, Debug)]
pub struct BorrowFixture {
    pub reserve: Pubkey,
    pub borrowed_amount_sf: u128,
    pub adjusted_market_value_sf: u128,
    /// `ObligationLiquidity::cumulative_borrow_rate_bsf`, a `BigFractionBytes`.
    ///
    /// The guard never reads it, so the default of zero is fine for guard-only
    /// tests. Real KLend divides by it when accruing interest, so any test running
    /// the actual program must copy the matching value out of the reserve.
    pub cumulative_borrow_rate_bsf: [u8; 48],
}

impl BorrowFixture {
    pub fn new(reserve: Pubkey, borrowed_amount_sf: u128, adjusted_market_value_sf: u128) -> Self {
        Self {
            reserve,
            borrowed_amount_sf,
            adjusted_market_value_sf,
            cumulative_borrow_rate_bsf: [0; 48],
        }
    }
}

#[derive(Clone, Debug)]
pub struct ObligationFixture {
    pub owner: Pubkey,
    pub lending_market: Pubkey,
    pub slot: u64,
    pub stale: bool,
    pub price_status: u8,
    /// Deposit reserves, in the slot order KLend keeps them.
    pub deposits: Vec<Pubkey>,
    pub deposited_value_sf: u128,
    pub borrows: Vec<BorrowFixture>,
    /// `borrow_factor_adjusted_debt_value_sf` — the risk-adjusted aggregate the
    /// guard uses as the LTV numerator.
    pub debt_value_sf: u128,
    /// `lowest_reserve_deposit_liquidation_ltv`, in whole percent as KLend stores it.
    pub liquidation_ltv_pct: u64,
    pub mock_mode: u8,
}

impl ObligationFixture {
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut data = vec![0_u8; OBLIGATION_LEN];
        data[..8].copy_from_slice(&OBLIGATION_DISCRIMINATOR);
        put_u64(&mut data, O_SLOT, self.slot);
        data[O_STALE] = u8::from(self.stale);
        data[O_PRICE_STATUS] = self.price_status;
        put_key(&mut data, O_LENDING_MARKET, &self.lending_market);
        put_key(&mut data, O_OWNER, &self.owner);

        assert!(self.deposits.len() <= 8, "KLend holds at most 8 deposits");
        for (index, reserve) in self.deposits.iter().enumerate() {
            let entry = O_DEPOSITS + index * O_DEPOSIT_ENTRY;
            put_key(&mut data, entry, reserve);
            // A non-zero market value keeps the entry plausible; the guard reads the
            // aggregate `deposited_value_sf`, not the per-deposit values.
            put_u128(&mut data, entry + O_DEPOSIT_MARKET_VALUE, q60(1));
        }

        put_u64(&mut data, O_LIQUIDATION_LTV, self.liquidation_ltv_pct);
        put_u128(&mut data, O_DEPOSITED_VALUE, self.deposited_value_sf);

        assert!(self.borrows.len() <= 5, "KLend holds at most 5 borrows");
        for (index, borrow) in self.borrows.iter().enumerate() {
            let entry = O_BORROWS + index * O_BORROW_ENTRY;
            put_key(&mut data, entry, &borrow.reserve);
            data[entry + O_BORROW_CUMULATIVE_RATE..entry + O_BORROW_CUMULATIVE_RATE + 48]
                .copy_from_slice(&borrow.cumulative_borrow_rate_bsf);
            put_u128(&mut data, entry + O_BORROWED_AMOUNT, borrow.borrowed_amount_sf);
            // `market_value_sf` sits between the principal and the risk-adjusted
            // value; KLend keeps both, so a fixture that only set one would be
            // internally inconsistent.
            put_u128(
                &mut data,
                entry + O_BORROW_MARKET_VALUE,
                borrow.adjusted_market_value_sf,
            );
            put_u128(
                &mut data,
                entry + O_BORROW_ADJUSTED_VALUE,
                borrow.adjusted_market_value_sf,
            );
        }

        put_u128(&mut data, O_DEBT_VALUE, self.debt_value_sf);
        data[O_HAS_DEBT] = u8::from(!self.borrows.is_empty());
        data[O_MOCK_MODE] = self.mock_mode;
        data
    }

    /// Reads back the borrow entry for `reserve`, so tests can assert what the mock
    /// KLend actually did to the account.
    pub fn read_borrow(data: &[u8], reserve: &Pubkey) -> Option<(u128, u128)> {
        (0..5).find_map(|index| {
            let entry = O_BORROWS + index * O_BORROW_ENTRY;
            (&data[entry..entry + 32] == reserve.as_ref()).then(|| {
                (
                    get_u128(data, entry + O_BORROWED_AMOUNT),
                    get_u128(data, entry + O_BORROW_ADJUSTED_VALUE),
                )
            })
        })
    }

    pub fn read_deposited_value(data: &[u8]) -> u128 {
        get_u128(data, O_DEPOSITED_VALUE)
    }
}

#[derive(Clone, Debug)]
pub struct ReserveFixture {
    pub lending_market: Pubkey,
    pub liquidity_mint: Pubkey,
    pub liquidity_supply: Pubkey,
    pub token_program: Pubkey,
    pub slot: u64,
    pub stale: bool,
    pub price_status: u8,
}

impl ReserveFixture {
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut data = vec![0_u8; RESERVE_LEN];
        data[..8].copy_from_slice(&RESERVE_DISCRIMINATOR);
        put_u64(&mut data, R_SLOT, self.slot);
        data[R_STALE] = u8::from(self.stale);
        data[R_PRICE_STATUS] = self.price_status;
        put_key(&mut data, R_LENDING_MARKET, &self.lending_market);
        put_key(&mut data, R_LIQUIDITY_MINT, &self.liquidity_mint);
        put_key(&mut data, R_LIQUIDITY_SUPPLY, &self.liquidity_supply);
        put_key(&mut data, R_TOKEN_PROGRAM, &self.token_program);
        data
    }
}

fn put_key(data: &mut [u8], offset: usize, key: &Pubkey) {
    data[offset..offset + 32].copy_from_slice(key.as_ref());
}

fn put_u64(data: &mut [u8], offset: usize, value: u64) {
    data[offset..offset + 8].copy_from_slice(&value.to_le_bytes());
}

fn put_u128(data: &mut [u8], offset: usize, value: u128) {
    data[offset..offset + 16].copy_from_slice(&value.to_le_bytes());
}

fn get_u128(data: &[u8], offset: usize) -> u128 {
    u128::from_le_bytes(data[offset..offset + 16].try_into().unwrap())
}
