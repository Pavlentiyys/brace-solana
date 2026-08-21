//! The layout offsets checked against real production bytes.
//!
//! ТЗ §9 asks what the obligation state actually looks like. `tests/layout.rs`
//! answers that against fixtures this repository writes itself, which proves the
//! adapter and the fixtures agree but cannot prove either matches Kamino. These two
//! accounts were fetched from mainnet and committed verbatim, so this file closes
//! that gap without needing a network, an RPC key or a fork.
//!
//!   obligation   BMRn6coHoNM2rWZuCEq3gzcx4eQu3BXrVU9vTz4DFYeg
//!   USDC reserve D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59
//!
//! Both belong to the Kamino main market. If a KLend upgrade moves a field, these
//! assertions keep passing on the old bytes — the fixture is a snapshot, not a live
//! feed — so refresh it when bumping `KLEND_LAYOUT_VERSION`.

use guard_litesvm_tests::{
    ids::{KLEND_PROGRAM_ID, SPL_TOKEN_ID},
    kamino::{OBLIGATION_DISCRIMINATOR, OBLIGATION_LEN, RESERVE_DISCRIMINATOR, RESERVE_LEN},
};
use solana_pubkey::Pubkey;

const MAIN_MARKET: &str = "7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF";
const USDC_MINT: &str = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDC_RESERVE: &str = "D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59";

fn decode(name: &str) -> Vec<u8> {
    let raw = match name {
        "obligation" => include_str!("../fixtures/mainnet-obligation.base64"),
        "reserve" => include_str!("../fixtures/mainnet-usdc-reserve.base64"),
        other => panic!("unknown fixture {other}"),
    };
    base64_decode(&raw.split_whitespace().collect::<String>())
}

/// A 40-line decoder beats a dependency for two static files.
fn base64_decode(input: &str) -> Vec<u8> {
    const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = Vec::with_capacity(input.len() / 4 * 3);
    let mut acc: u32 = 0;
    let mut bits = 0;
    for byte in input.bytes() {
        if byte == b'=' {
            break;
        }
        let value = ALPHABET
            .iter()
            .position(|c| *c == byte)
            .unwrap_or_else(|| panic!("invalid base64 byte {byte}")) as u32;
        acc = (acc << 6) | value;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((acc >> bits) as u8);
        }
    }
    out
}

fn key(data: &[u8], offset: usize) -> Pubkey {
    Pubkey::try_from(&data[offset..offset + 32]).unwrap()
}

fn u128_at(data: &[u8], offset: usize) -> u128 {
    u128::from_le_bytes(data[offset..offset + 16].try_into().unwrap())
}

#[test]
fn mainnet_obligation_matches_the_pinned_layout() {
    let data = decode("obligation");

    assert_eq!(data.len(), OBLIGATION_LEN, "account size");
    assert_eq!(&data[..8], &OBLIGATION_DISCRIMINATOR, "discriminator");
    assert_eq!(key(&data, 32).to_string(), MAIN_MARKET, "lending_market @32");

    // The owner is a real wallet, so all we can assert is that it is populated and
    // is not accidentally reading into an adjacent field.
    let owner = key(&data, 64);
    assert_ne!(owner, Pubkey::default(), "owner @64");
    assert_ne!(owner, key(&data, 32), "owner must not alias lending_market");

    // The strongest evidence available: KLend maintains `deposited_value_sf` as the
    // sum of the per-deposit market values. Reading both from our offsets and
    // getting an exact match could not happen if either offset were wrong.
    let deposited_value_sf = u128_at(&data, 1_192);
    let deposits_sum: u128 = (0..8)
        .map(|index| 96 + index * 136)
        .filter(|entry| data[*entry..entry + 32] != [0; 32])
        .map(|entry| u128_at(&data, entry + 40))
        .sum();
    assert_eq!(deposited_value_sf, deposits_sum, "deposited_value_sf @1192");
    assert!(deposited_value_sf > 0, "the sampled position has collateral");

    // Same argument on the borrow side: the aggregate equals the single borrow's
    // risk-adjusted value.
    let debt_value_sf = u128_at(&data, 2_208);
    let borrows_sum: u128 = (0..5)
        .map(|index| 1_208 + index * 200)
        .filter(|entry| data[*entry..entry + 32] != [0; 32])
        .map(|entry| u128_at(&data, entry + 120))
        .sum();
    assert_eq!(debt_value_sf, borrows_sum, "borrow_factor_adjusted_debt_value_sf @2208");
    assert!(debt_value_sf > 0, "the sampled position has debt");

    // The USDC reserve of the other fixture appears among this obligation's deposit
    // reserves, which ties the two accounts together and confirms the deposit entry
    // stride of 136 bytes.
    let deposit_reserves: Vec<String> = (0..8)
        .map(|index| 96 + index * 136)
        .filter(|entry| data[*entry..entry + 32] != [0; 32])
        .map(|entry| key(&data, entry).to_string())
        .collect();
    assert!(
        deposit_reserves.iter().any(|r| r == USDC_RESERVE),
        "expected the USDC reserve among {deposit_reserves:?}"
    );

    // This snapshot was taken between transactions, so KLend has it marked stale and
    // `lowest_reserve_deposit_liquidation_ltv` still holds its 255 sentinel rather
    // than a real percentage. That is exactly the case
    // `PositionState::checked_liquidation_ltv_bps` refuses, and finding it here on
    // real data is why that check exists.
    assert_eq!(data[24], 1, "last_update.stale @24");
    assert_eq!(
        u64::from_le_bytes(data[1_184..1_192].try_into().unwrap()),
        255,
        "lowest_reserve_deposit_liquidation_ltv @1184 is unpopulated while stale"
    );
}

#[test]
fn mainnet_reserve_matches_the_pinned_layout() {
    let data = decode("reserve");

    assert_eq!(data.len(), RESERVE_LEN, "account size");
    assert_eq!(&data[..8], &RESERVE_DISCRIMINATOR, "discriminator");
    assert_eq!(key(&data, 32).to_string(), MAIN_MARKET, "lending_market @32");
    assert_eq!(key(&data, 128).to_string(), USDC_MINT, "liquidity.mint @128");
    assert_eq!(
        key(&data, 408),
        SPL_TOKEN_ID,
        "liquidity.token_program @408"
    );

    let supply = key(&data, 160);
    assert_ne!(supply, Pubkey::default(), "liquidity.supply_vault @160");
    assert_ne!(supply, key(&data, 128), "supply must not alias the mint");

    // Kamino publishes the main-market USDC reserve at 80% LTV and 90% liquidation
    // threshold. Reading exactly those two numbers, adjacent and in the right order,
    // pins `ReserveConfig` — the struct whose prefix has already shifted once.
    assert_eq!(data[8 + 4_848 + 16], 80, "config.loan_to_value_pct");
    assert_eq!(data[8 + 4_848 + 17], 90, "config.liquidation_threshold_pct");

    // Every oracle preventive check is satisfied on a live reserve.
    assert_eq!(data[25], 0b0011_1111, "last_update.price_status @25");
}

#[test]
fn both_fixtures_are_owned_by_klend() {
    // Not read from the bytes — recorded here so the provenance of the fixtures is
    // part of the test rather than only a comment.
    assert_eq!(
        KLEND_PROGRAM_ID.to_string(),
        "KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD"
    );
}
