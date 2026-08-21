//! LiteSVM harness for the `guard` program.
//!
//! Every test drives the real compiled `guard.so` through real transactions. The
//! Kamino side is played by `tests/mock-klend`, an SBF program loaded at the address
//! the guard hardcodes.
//!
//! Usage is: build a [`TestEnv`], mutate exactly the one thing under test, call
//! [`TestEnv::install`], then send. Defaults describe a position that is over its
//! trigger and legitimately repayable, so any rejection a test observes is caused by
//! the mutation it made and nothing else.

pub mod guard;
pub mod ids;
pub mod kamino;
pub mod spl;

use std::path::PathBuf;

use litesvm::LiteSVM;
use solana_account::Account;
use solana_clock::Clock;
use solana_instruction::{error::InstructionError, AccountMeta, Instruction};
use solana_keypair::Keypair;
use solana_message::Message;
use solana_pubkey::Pubkey;
use solana_signer::Signer;
use solana_transaction::Transaction;
use solana_transaction_error::TransactionError;

use crate::{
    guard::{GuardConfigFixture, GUARD_CONFIG_LEN},
    ids::{
        err, ACTION_REPAY, FARMS_PROGRAM_ID, GUARD_PROGRAM_ID, INSTRUCTIONS_SYSVAR_ID,
        KLEND_PROGRAM_ID, LENDING_MARKET_AUTH_SEED, SPL_TOKEN_ID,
    },
    kamino::{
        q60, BorrowFixture, ObligationFixture, ReserveFixture, PRICE_STATUS_ALL_CHECKS,
    },
};

/// Slot and wall clock the default scenario runs at.
pub const DEFAULT_SLOT: u64 = 100;
pub const DEFAULT_TIMESTAMP: i64 = 1_000_000;

/// Repay amount that satisfies every default policy limit and the target-LTV cap.
pub const HEALTHY_REPAY: u64 = 100;

pub struct TestEnv {
    pub svm: LiteSVM,
    pub payer: Keypair,
    pub owner: Keypair,
    pub agent: Keypair,

    pub obligation: Pubkey,
    pub lending_market: Pubkey,
    pub debt_reserve: Pubkey,
    pub collateral_reserve: Pubkey,
    pub vault_mint: Pubkey,
    pub reserve_liquidity_supply: Pubkey,
    pub owner_token_account: Pubkey,
    pub guard: Pubkey,
    pub vault: Pubkey,
    pub lending_market_authority: Pubkey,

    pub config: GuardConfigFixture,
    pub obligation_state: ObligationFixture,
    pub debt_reserve_state: ReserveFixture,
    pub collateral_reserve_state: ReserveFixture,

    pub vault_balance: u64,
    pub supply_balance: u64,
    pub owner_balance: u64,
    pub slot: u64,
    pub unix_timestamp: i64,
    /// Program passed in the `lending_program` slot. Only the foreign-program test
    /// changes it.
    pub lending_program: Pubkey,
}

impl TestEnv {
    /// A position at 85% LTV against an 80% trigger and a 70% target: repayable, and
    /// every limit far enough away that a test must opt in to hitting one.
    pub fn new() -> Self {
        let mut svm = LiteSVM::new();
        load_programs(&mut svm);

        let payer = Keypair::new();
        let owner = Keypair::new();
        let agent = Keypair::new();
        svm.airdrop(&payer.pubkey(), 100_000_000_000).unwrap();

        let obligation = Pubkey::new_unique();
        let lending_market = Pubkey::new_unique();
        let debt_reserve = Pubkey::new_unique();
        let collateral_reserve = Pubkey::new_unique();
        let vault_mint = Pubkey::new_unique();
        let reserve_liquidity_supply = Pubkey::new_unique();
        let owner_token_account = Pubkey::new_unique();

        let (guard, bump) = guard::guard_pda(&owner.pubkey(), &obligation);
        let (vault, vault_bump) = guard::vault_pda(&guard);
        let (lending_market_authority, _) = Pubkey::find_program_address(
            &[LENDING_MARKET_AUTH_SEED, lending_market.as_ref()],
            &KLEND_PROGRAM_ID,
        );

        let mut config = GuardConfigFixture {
            owner: owner.pubkey(),
            agent: agent.pubkey(),
            obligation,
            lending_market,
            debt_reserve,
            vault,
            vault_mint,
            trigger_ltv_bps: 0,
            target_ltv_bps: 0,
            max_action_amount: 0,
            max_actions_per_window: 0,
            window_seconds: 0,
            cooldown_seconds: 0,
            allowed_actions: 0,
            expires_at: DEFAULT_TIMESTAMP + 86_400,
            paused: false,
            // A prior action exists, so the cooldown rule is live rather than skipped.
            last_action_at: DEFAULT_TIMESTAMP - 3_600,
            window_started_at: DEFAULT_TIMESTAMP - 60,
            actions_in_window: 0,
            total_actions: 1,
            total_repaid: 0,
            bump,
            vault_bump,
        };
        guard::default_policy(&mut config);

        let obligation_state = ObligationFixture {
            owner: owner.pubkey(),
            lending_market,
            slot: DEFAULT_SLOT,
            stale: false,
            price_status: PRICE_STATUS_ALL_CHECKS,
            deposits: vec![collateral_reserve],
            // $1000 of collateral against $850 of risk-adjusted debt: 8500 bps.
            deposited_value_sf: q60(1_000),
            borrows: vec![BorrowFixture::new(debt_reserve, q60(850), q60(850))],
            debt_value_sf: q60(850),
            liquidation_ltv_pct: 90,
            mock_mode: 0,
        };

        let reserve = |mint: Pubkey, supply: Pubkey| ReserveFixture {
            lending_market,
            liquidity_mint: mint,
            liquidity_supply: supply,
            token_program: SPL_TOKEN_ID,
            slot: DEFAULT_SLOT,
            stale: false,
            price_status: PRICE_STATUS_ALL_CHECKS,
        };

        Self {
            svm,
            payer,
            owner,
            agent,
            obligation,
            lending_market,
            debt_reserve,
            collateral_reserve,
            vault_mint,
            reserve_liquidity_supply,
            owner_token_account,
            guard,
            vault,
            lending_market_authority,
            config,
            obligation_state,
            debt_reserve_state: reserve(vault_mint, reserve_liquidity_supply),
            // The collateral reserve only has to belong to the same market; its own
            // mint and supply are never touched by a repay.
            collateral_reserve_state: reserve(Pubkey::new_unique(), Pubkey::new_unique()),
            vault_balance: 500,
            supply_balance: 1_000_000,
            owner_balance: 0,
            slot: DEFAULT_SLOT,
            unix_timestamp: DEFAULT_TIMESTAMP,
            lending_program: KLEND_PROGRAM_ID,
        }
    }

    /// Writes the current fixture state into the SVM. Call after every mutation —
    /// tests are expected to mutate then install, never the other way round.
    pub fn install(&mut self) {
        self.svm
            .set_sysvar::<Clock>(&Clock {
                slot: self.slot,
                epoch_start_timestamp: 0,
                epoch: 0,
                leader_schedule_epoch: 0,
                unix_timestamp: self.unix_timestamp,
            });

        set(&mut self.svm, self.guard, self.config.to_bytes(), GUARD_PROGRAM_ID);
        set(
            &mut self.svm,
            self.obligation,
            self.obligation_state.to_bytes(),
            KLEND_PROGRAM_ID,
        );
        set(
            &mut self.svm,
            self.debt_reserve,
            self.debt_reserve_state.to_bytes(),
            KLEND_PROGRAM_ID,
        );
        set(
            &mut self.svm,
            self.collateral_reserve,
            self.collateral_reserve_state.to_bytes(),
            KLEND_PROGRAM_ID,
        );
        // The lending market is only ever checked for its owner and address.
        set(&mut self.svm, self.lending_market, vec![0; 64], KLEND_PROGRAM_ID);

        set(&mut self.svm, self.vault_mint, spl::mint(6, 1_000_000_000), SPL_TOKEN_ID);
        set(
            &mut self.svm,
            self.vault,
            // Self-authority: the vault PDA is its own token authority, which is what
            // lets the guard move funds without any user signature.
            spl::token_account(&self.vault_mint, &self.vault, self.vault_balance),
            SPL_TOKEN_ID,
        );
        set(
            &mut self.svm,
            self.reserve_liquidity_supply,
            spl::token_account(&self.vault_mint, &self.lending_market, self.supply_balance),
            SPL_TOKEN_ID,
        );
        set(
            &mut self.svm,
            self.owner_token_account,
            spl::token_account(&self.vault_mint, &self.owner.pubkey(), self.owner_balance),
            SPL_TOKEN_ID,
        );
    }

    pub fn execute_action_ix(&self, action_kind: u8, amount: u64) -> Instruction {
        Instruction {
            program_id: GUARD_PROGRAM_ID,
            accounts: vec![
                AccountMeta::new(self.guard, false),
                AccountMeta::new(self.vault, false),
                AccountMeta::new_readonly(self.agent.pubkey(), true),
                AccountMeta::new(self.obligation, false),
                AccountMeta::new_readonly(self.lending_market, false),
                AccountMeta::new(self.debt_reserve, false),
                AccountMeta::new_readonly(self.vault_mint, false),
                AccountMeta::new(self.reserve_liquidity_supply, false),
                AccountMeta::new_readonly(self.lending_market_authority, false),
                AccountMeta::new_readonly(self.lending_program, false),
                AccountMeta::new_readonly(FARMS_PROGRAM_ID, false),
                AccountMeta::new_readonly(SPL_TOKEN_ID, false),
                AccountMeta::new_readonly(INSTRUCTIONS_SYSVAR_ID, false),
                // Remaining accounts: the obligation's deposit reserves, in order.
                AccountMeta::new(self.collateral_reserve, false),
            ],
            data: guard::execute_action_data(action_kind, amount),
        }
    }

    pub fn withdraw_ix(&self, amount: u64) -> Instruction {
        Instruction {
            program_id: GUARD_PROGRAM_ID,
            accounts: vec![
                AccountMeta::new_readonly(self.guard, false),
                AccountMeta::new(self.owner.pubkey(), true),
                AccountMeta::new(self.vault, false),
                AccountMeta::new(self.owner_token_account, false),
                AccountMeta::new_readonly(self.vault_mint, false),
                AccountMeta::new_readonly(SPL_TOKEN_ID, false),
            ],
            data: guard::withdraw_reserve_data(amount),
        }
    }

    pub fn revoke_ix(&self) -> Instruction {
        Instruction {
            program_id: GUARD_PROGRAM_ID,
            accounts: vec![
                AccountMeta::new(self.guard, false),
                AccountMeta::new_readonly(self.owner.pubkey(), true),
            ],
            data: guard::revoke_data(),
        }
    }

    /// Sends `execute_action` signed by the configured agent.
    pub fn repay(&mut self, amount: u64) -> Result<(), TransactionError> {
        let ix = self.execute_action_ix(ACTION_REPAY, amount);
        self.send(ix, SignedBy::Agent)
    }

    pub fn send(&mut self, ix: Instruction, signer: SignedBy) -> Result<(), TransactionError> {
        let transaction = self.build_tx(ix, signer);
        self.send_tx(transaction)
    }

    /// Signs a transaction without sending it. Separated from [`Self::send`] so a
    /// test can sign now and submit after the world has changed — the durable-nonce
    /// replay the ТЗ singles out.
    pub fn build_tx(&self, ix: Instruction, signer: SignedBy) -> Transaction {
        let message = Message::new(&[ix], Some(&self.payer.pubkey()));
        let blockhash = self.svm.latest_blockhash();
        match signer {
            SignedBy::Agent => Transaction::new(&[&self.payer, &self.agent], message, blockhash),
            SignedBy::Owner => Transaction::new(&[&self.payer, &self.owner], message, blockhash),
            SignedBy::PayerOnly => Transaction::new(&[&self.payer], message, blockhash),
        }
    }

    pub fn send_tx(&mut self, transaction: Transaction) -> Result<(), TransactionError> {
        self.svm
            .send_transaction(transaction)
            .map(|_| ())
            .map_err(|failure| failure.err)
    }

    /// Compute units consumed by a successful `execute_action`, for the §9 budget.
    pub fn repay_compute_units(&mut self, amount: u64) -> u64 {
        let ix = self.execute_action_ix(ACTION_REPAY, amount);
        let transaction = self.build_tx(ix, SignedBy::Agent);
        self.svm
            .send_transaction(transaction)
            .expect("repay must succeed")
            .compute_units_consumed
    }

    pub fn account_data(&self, key: &Pubkey) -> Vec<u8> {
        self.svm.get_account(key).expect("account must exist").data
    }

    pub fn vault_amount(&self) -> u64 {
        spl::token_account_amount(&self.account_data(&self.vault))
    }

    pub fn supply_amount(&self) -> u64 {
        spl::token_account_amount(&self.account_data(&self.reserve_liquidity_supply))
    }

    pub fn owner_amount(&self) -> u64 {
        spl::token_account_amount(&self.account_data(&self.owner_token_account))
    }
}

impl Default for TestEnv {
    fn default() -> Self {
        Self::new()
    }
}

pub enum SignedBy {
    Agent,
    Owner,
    PayerOnly,
}

/// Asserts the transaction failed with a specific `GuardError`, naming both codes on
/// mismatch so a wrong-reason failure is not mistaken for a pass.
#[track_caller]
pub fn assert_guard_error(result: Result<(), TransactionError>, expected: u32) {
    match result {
        Ok(()) => panic!("expected guard error {expected}, transaction succeeded"),
        Err(TransactionError::InstructionError(_, InstructionError::Custom(actual))) => {
            assert_eq!(
                actual, expected,
                "expected guard error {expected} ({}), got {actual} ({})",
                error_name(expected),
                error_name(actual)
            );
        }
        Err(other) => panic!("expected guard error {expected}, got {other:?}"),
    }
}

pub fn error_name(code: u32) -> &'static str {
    match code {
        err::UNAUTHORIZED_AGENT => "UnauthorizedAgent",
        err::GUARD_PAUSED => "GuardPaused",
        err::GUARD_EXPIRED => "GuardExpired",
        err::COOLDOWN_ACTIVE => "CooldownActive",
        err::RATE_LIMIT_EXCEEDED => "RateLimitExceeded",
        err::ACTION_NOT_ALLOWED => "ActionNotAllowed",
        err::AMOUNT_EXCEEDS_LIMIT => "AmountExceedsLimit",
        err::STALE_OBLIGATION => "StaleObligation",
        err::STALE_ORACLE => "StaleOracle",
        err::TRIGGER_NOT_MET => "TriggerNotMet",
        err::ACTION_WOULD_NOT_IMPROVE => "ActionWouldNotImprove",
        err::OVERCORRECTION => "Overcorrection",
        err::INVALID_POLICY => "InvalidPolicy",
        err::MATH_OVERFLOW => "MathOverflow",
        err::UNEXPECTED_PROGRAM => "UnexpectedProgram",
        err::INVALID_EXTERNAL_ACCOUNT => "InvalidExternalAccount",
        err::INVALID_MARKET_RELATIONSHIP => "InvalidMarketRelationship",
        err::MISSING_DEBT_POSITION => "MissingDebtPosition",
        err::INVALID_REMAINING_ACCOUNTS => "InvalidRemainingAccounts",
        err::INVALID_AMOUNT => "InvalidAmount",
        err::CLOCK_MOVED_BACKWARDS => "ClockMovedBackwards",
        err::POST_CPI_INVARIANT => "PostCpiInvariant",
        _ => "unknown (Anchor built-in?)",
    }
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

fn load_programs(svm: &mut LiteSVM) {
    svm.add_program_from_file(GUARD_PROGRAM_ID, artifact("target/deploy/guard.so"))
        .expect("run `cargo build-sbf --manifest-path programs/guard/Cargo.toml` first");
    let mock = artifact("tests/mock-klend/target/deploy/mock_klend.so");
    svm.add_program_from_file(KLEND_PROGRAM_ID, &mock)
        .expect("run `cargo build-sbf --manifest-path tests/mock-klend/Cargo.toml` first");
    // The guard requires an executable account at the farms address even though the
    // farm slots are `None`; any ELF satisfies that, and it is never invoked.
    svm.add_program_from_file(FARMS_PROGRAM_ID, &mock).unwrap();
}

/// Resolves a path relative to the `program/` directory.
fn artifact(relative: &str) -> PathBuf {
    let mut path = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    path.pop();
    path.pop();
    path.push(relative);
    path
}

/// Whether the compiled artifacts both tests need are present.
pub fn artifacts_available() -> bool {
    artifact("target/deploy/guard.so").is_file()
        && artifact("tests/mock-klend/target/deploy/mock_klend.so").is_file()
}

pub const GUARD_CONFIG_ACCOUNT_LEN: usize = GUARD_CONFIG_LEN;
