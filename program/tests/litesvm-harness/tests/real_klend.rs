//! The guard's repay CPI against the **real** KLend program.
//!
//! Everything else in this suite runs against `tests/mock-klend`, which by
//! construction agrees with whatever the adapter believes. That proves the guard's
//! own logic but cannot prove the CPI is one Kamino would accept: the discriminator,
//! the account order, the two `None` farm slots, the trailing deposit reserves — all
//! of it is derived from reading upstream source, and reading can be wrong.
//!
//! This test removes that doubt by loading mainnet's actual KLend ELF and letting it
//! answer. The surrounding accounts are the real mainnet lending market and USDC
//! reserve, byte for byte, with only the fields a snapshot cannot carry patched:
//! the refresh slot, the staleness flag, and the token balances.
//!
//! The ELF is 10 MB, so it is not committed. Fetch it with:
//!
//! ```text
//! solana program dump -u m KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD \
//!     tests/litesvm-harness/fixtures/klend.so
//! ```
//!
//! Without it the tests below skip rather than fail, so the suite still runs offline.

use std::path::PathBuf;

use guard_litesvm_tests::{
    guard::{self, GuardConfigFixture},
    ids::{
        ACTION_REPAY, FARMS_PROGRAM_ID, GUARD_PROGRAM_ID, INSTRUCTIONS_SYSVAR_ID, KLEND_PROGRAM_ID,
        LENDING_MARKET_AUTH_SEED, SPL_TOKEN_ID,
    },
    kamino::{
        q60, BorrowFixture, ObligationFixture, PRICE_STATUS_ALL_CHECKS,
        RESERVE_CUMULATIVE_BORROW_RATE_OFFSET,
    },
    spl,
};
use litesvm::LiteSVM;
use solana_account::Account;
use solana_clock::Clock;
use solana_instruction::{AccountMeta, Instruction};
use solana_keypair::Keypair;
use solana_message::Message;
use solana_pubkey::Pubkey;
use solana_signer::Signer;
use solana_transaction::Transaction;

const MARKET: Pubkey = Pubkey::from_str_const("7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF");
const RESERVE: Pubkey = Pubkey::from_str_const("D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59");
const USDC_MINT: Pubkey = Pubkey::from_str_const("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const SUPPLY: Pubkey = Pubkey::from_str_const("Bgq7trRgVMeq33yt235zM2onQ4bRDBsY5EWiTetF4qw6");

/// The fixtures are a mainnet snapshot, so the clock has to be set *after* the
/// timestamps and slots frozen inside them — KLend compares against its own recorded
/// interval starts and rejects a clock that runs behind them.
const SLOT: u64 = 500_000_000;
const TIMESTAMP: i64 = 1_800_000_000;
const REPAY: u64 = 100;

fn fixtures() -> PathBuf {
    let mut path = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    path.push("fixtures");
    path
}

fn decode(name: &str) -> Vec<u8> {
    let text = std::fs::read_to_string(fixtures().join(name)).unwrap();
    base64_decode(&text.split_whitespace().collect::<String>())
}

fn base64_decode(input: &str) -> Vec<u8> {
    const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = Vec::with_capacity(input.len() / 4 * 3);
    let (mut acc, mut bits) = (0_u32, 0_u32);
    for byte in input.bytes() {
        if byte == b'=' {
            break;
        }
        let value = ALPHABET.iter().position(|c| *c == byte).unwrap() as u32;
        acc = (acc << 6) | value;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((acc >> bits) as u8);
        }
    }
    out
}

fn set(svm: &mut LiteSVM, key: Pubkey, data: Vec<u8>, owner: Pubkey) {
    let lamports = svm.minimum_balance_for_rent_exemption(data.len());
    svm.set_account(
        key,
        Account {
            lamports,
            data,
            owner,
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();
}

struct RealKlend {
    svm: LiteSVM,
    payer: Keypair,
    agent: Keypair,
    obligation: Pubkey,
    guard: Pubkey,
    vault: Pubkey,
    market_authority: Pubkey,
    supply_balance: u64,
}

/// Builds the scenario, or returns `None` when the KLend ELF has not been fetched.
fn setup() -> Option<RealKlend> {
    let klend = fixtures().join("klend.so");
    if !klend.is_file() {
        eprintln!(
            "skipping: {} not found; run `solana program dump -u m {} {}`",
            klend.display(),
            KLEND_PROGRAM_ID,
            klend.display()
        );
        return None;
    }

    let mut svm = LiteSVM::new();
    svm.add_program_from_file(GUARD_PROGRAM_ID, {
        let mut path = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        path.pop();
        path.pop();
        path.push("target/deploy/guard.so");
        path
    })
    .expect("build guard.so first");
    svm.add_program_from_file(KLEND_PROGRAM_ID, &klend).unwrap();
    // Never invoked — the farm slots are None — but the guard requires an executable
    // account at this address.
    svm.add_program_from_file(FARMS_PROGRAM_ID, &klend).unwrap();

    svm.set_sysvar::<Clock>(&Clock {
        slot: SLOT,
        epoch_start_timestamp: 0,
        epoch: 0,
        leader_schedule_epoch: 0,
        unix_timestamp: TIMESTAMP,
    });

    let payer = Keypair::new();
    let owner = Keypair::new();
    let agent = Keypair::new();
    svm.airdrop(&payer.pubkey(), 100_000_000_000).unwrap();

    // Real market, verbatim.
    set(&mut svm, MARKET, decode("mainnet-lending-market.base64"), KLEND_PROGRAM_ID);

    // Real USDC reserve, with only what a snapshot cannot carry patched: it was
    // captured between transactions, so KLend has it marked stale.
    let mut reserve = decode("mainnet-usdc-reserve.base64");
    reserve[16..24].copy_from_slice(&SLOT.to_le_bytes());
    reserve[24] = 0;
    reserve[25] = PRICE_STATUS_ALL_CHECKS;
    let cumulative_borrow_rate: [u8; 48] = reserve[RESERVE_CUMULATIVE_BORROW_RATE_OFFSET
        ..RESERVE_CUMULATIVE_BORROW_RATE_OFFSET + 48]
        .try_into()
        .unwrap();

    // KLend cross-checks the supply vault's real token balance against what the
    // reserve struct says it is holding, so the token account has to be funded to
    // match this snapshot rather than to a round test number.
    //   total_available_amount        u64  @ liquidity + 96
    //   accumulated_protocol_fees_sf  u128 @ liquidity + 216   (Q60)
    //   accumulated_referrer_fees_sf  u128 @ liquidity + 232   (Q60)
    //   pending_referrer_fees_sf      u128 @ liquidity + 248   (Q60)
    let u64_at = |data: &[u8], offset: usize| {
        u64::from_le_bytes(data[offset..offset + 8].try_into().unwrap())
    };
    let q60_units = |data: &[u8], offset: usize| {
        (u128::from_le_bytes(data[offset..offset + 16].try_into().unwrap()) >> 60) as u64
    };
    let supply_balance = u64_at(&reserve, 128 + 96)
        + q60_units(&reserve, 128 + 216)
        + q60_units(&reserve, 128 + 232)
        + q60_units(&reserve, 128 + 248);

    set(&mut svm, RESERVE, reserve, KLEND_PROGRAM_ID);

    let obligation = Pubkey::new_unique();
    let (guard, bump) = guard::guard_pda(&owner.pubkey(), &obligation);
    let (vault, vault_bump) = guard::vault_pda(&guard);
    let (market_authority, _) = Pubkey::find_program_address(
        &[LENDING_MARKET_AUTH_SEED, MARKET.as_ref()],
        &KLEND_PROGRAM_ID,
    );

    // A position that both deposits and borrows USDC. Structurally valid and it lets
    // one real reserve stand in for both sides, so no second reserve has to be faked.
    let mut borrow = BorrowFixture::new(RESERVE, q60(850), q60(850));
    // Match the reserve's accrual index, or KLend's interest catch-up divides by zero.
    borrow.cumulative_borrow_rate_bsf = cumulative_borrow_rate;

    let state = ObligationFixture {
        owner: owner.pubkey(),
        lending_market: MARKET,
        slot: SLOT,
        stale: false,
        price_status: PRICE_STATUS_ALL_CHECKS,
        deposits: vec![RESERVE],
        deposited_value_sf: q60(1_000),
        borrows: vec![borrow],
        debt_value_sf: q60(850),
        liquidation_ltv_pct: 90,
        mock_mode: 0,
    };
    set(&mut svm, obligation, state.to_bytes(), KLEND_PROGRAM_ID);

    let mut config = GuardConfigFixture {
        owner: owner.pubkey(),
        agent: agent.pubkey(),
        obligation,
        lending_market: MARKET,
        debt_reserve: RESERVE,
        vault,
        vault_mint: USDC_MINT,
        trigger_ltv_bps: 0,
        target_ltv_bps: 0,
        max_action_amount: 0,
        max_actions_per_window: 0,
        window_seconds: 0,
        cooldown_seconds: 0,
        allowed_actions: 0,
        schedule_seconds: 0,
        schedule_amount: 0,
        expires_at: TIMESTAMP + 86_400,
        paused: false,
        last_action_at: TIMESTAMP - 3_600,
        window_started_at: TIMESTAMP - 60,
        actions_in_window: 0,
        last_scheduled_at: TIMESTAMP - 30 * 24 * 60 * 60,
        total_actions: 1,
        total_repaid: 0,
        bump,
        vault_bump,
    };
    guard::default_policy(&mut config);
    set(&mut svm, guard, config.to_bytes(), GUARD_PROGRAM_ID);

    set(&mut svm, USDC_MINT, spl::mint(6, 1_000_000_000_000), SPL_TOKEN_ID);
    set(
        &mut svm,
        vault,
        spl::token_account(&USDC_MINT, &vault, 500),
        SPL_TOKEN_ID,
    );
    set(
        &mut svm,
        SUPPLY,
        spl::token_account(&USDC_MINT, &market_authority, supply_balance),
        SPL_TOKEN_ID,
    );

    Some(RealKlend {
        svm,
        supply_balance,
        payer,
        agent,
        obligation,
        guard,
        vault,
        market_authority,
    })
}

fn repay_ix(env: &RealKlend) -> Instruction {
    Instruction {
        program_id: GUARD_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(env.guard, false),
            AccountMeta::new(env.vault, false),
            AccountMeta::new_readonly(env.agent.pubkey(), true),
            AccountMeta::new(env.obligation, false),
            AccountMeta::new_readonly(MARKET, false),
            AccountMeta::new(RESERVE, false),
            AccountMeta::new_readonly(USDC_MINT, false),
            AccountMeta::new(SUPPLY, false),
            AccountMeta::new_readonly(env.market_authority, false),
            AccountMeta::new_readonly(KLEND_PROGRAM_ID, false),
            AccountMeta::new_readonly(FARMS_PROGRAM_ID, false),
            AccountMeta::new_readonly(SPL_TOKEN_ID, false),
            AccountMeta::new_readonly(INSTRUCTIONS_SYSVAR_ID, false),
            AccountMeta::new(RESERVE, false),
        ],
        data: guard::execute_action_data(ACTION_REPAY, REPAY),
    }
}

#[test]
fn real_klend_accepts_the_guard_repay_cpi() {
    let Some(mut env) = setup() else { return };

    let message = Message::new(&[repay_ix(&env)], Some(&env.payer.pubkey()));
    let blockhash = env.svm.latest_blockhash();
    let transaction = Transaction::new(&[&env.payer, &env.agent], message, blockhash);

    match env.svm.send_transaction(transaction) {
        Ok(meta) => {
            let vault = spl::token_account_amount(&env.svm.get_account(&env.vault).unwrap().data);
            let supply = spl::token_account_amount(&env.svm.get_account(&SUPPLY).unwrap().data);
            assert_eq!(vault, 500 - REPAY, "the vault paid exactly the repay amount");
            assert_eq!(
                supply,
                env.supply_balance + REPAY,
                "the reserve supply received it"
            );
            // Also the obligation's borrow shrank, as recorded by KLend itself
            // rather than by a mock that was told to.
            let obligation = env.svm.get_account(&env.obligation).unwrap().data;
            let (borrowed, _) =
                ObligationFixture::read_borrow(&obligation, &RESERVE).expect("borrow entry");
            assert!(
                borrowed < q60(850),
                "real KLend must have reduced the borrow, got {borrowed}"
            );

            // ТЗ §9's compute budget, for the half this repository controls. The
            // refresh instructions the agent must prepend are extra, which is why
            // IMPLEMENTATION.md calls for an explicit ComputeBudget request.
            println!(
                "real KLend repay succeeded, {} compute units",
                meta.compute_units_consumed
            );
            assert!(
                meta.compute_units_consumed < 200_000,
                "guard + real KLend repay used {}",
                meta.compute_units_consumed
            );
        }
        Err(failure) => {
            // A KLend-side rejection is still informative — it means the CPI reached
            // the program and was decoded — so surface its logs rather than a bare
            // error code.
            panic!(
                "real KLend rejected the CPI: {:?}\n--- logs ---\n{}",
                failure.err,
                failure.meta.logs.join("\n")
            );
        }
    }
}
