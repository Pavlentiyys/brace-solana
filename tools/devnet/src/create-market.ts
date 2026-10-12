/**
 * Creates a Kamino lending market on devnet that this project controls.
 *
 * Why this exists: you cannot open a new borrow on the Kamino markets that already
 * sit on devnet. Every one of them prices collateral in a test mint whose mint
 * authority belongs to somebody else, so there is no way to obtain the collateral.
 * The only real wrapped SOL reserve on devnet is configured at a 0% loan-to-value
 * and is hidden. So we create our own market, with our own mints, and hand out the
 * collateral from a faucet.
 *
 * KLend is permissionless about this — 148 markets already exist on devnet — and
 * the market it creates is a genuine one: real Pyth prices, real interest accrual,
 * real liquidation thresholds. Nothing here is simulated.
 *
 * Run once:
 *   npm run market
 *
 * It writes every address it created to `market.json`, which the app and the faucet
 * read. Running it again creates a second, unrelated market.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createAssociatedTokenAccountIdempotentInstruction,
  createInitializeMint2Instruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  SYSVAR_RENT_PUBKEY,
  Transaction,
  sendAndConfirmTransaction,
  type TransactionInstruction,
} from "@solana/web3.js";

import {
  KLEND_PROGRAM_ID,
  LENDING_MARKET_SIZE,
  PYTH_DEVNET,
  RESERVE_SIZE,
  UpdateConfigMode,
  instructionCoder,
  marketAuthority,
  reserveAccounts,
} from "./klend.js";

const RPC = process.env.BRACE_RPC_URL ?? "https://api.devnet.solana.com";
const KEYPAIR = process.env.BRACE_KEYPAIR ?? join(homedir(), ".config/solana/id.json");
const OUT = join(dirname(fileURLToPath(import.meta.url)), "../market.json");

const GLOBAL_CONFIG = PublicKey.findProgramAddressSync(
  [Buffer.from("global_config")],
  KLEND_PROGRAM_ID,
)[0];

const coder = instructionCoder();
const connection = new Connection(RPC, "confirmed");

const payer = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(readFileSync(KEYPAIR, "utf8")) as number[]),
);

function ix(name: string, args: object, keys: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[]) {
  return {
    programId: KLEND_PROGRAM_ID,
    keys,
    data: coder.encode(name, args),
  } as TransactionInstruction;
}

function ro(pubkey: PublicKey) {
  return { pubkey, isSigner: false, isWritable: false };
}
function rw(pubkey: PublicKey) {
  return { pubkey, isSigner: false, isWritable: true };
}
function signer(pubkey: PublicKey, isWritable = true) {
  return { pubkey, isSigner: true, isWritable };
}

async function send(label: string, instructions: TransactionInstruction[], signers: Keypair[] = []) {
  const tx = new Transaction().add(...instructions);
  const signature = await sendAndConfirmTransaction(connection, tx, [payer, ...signers], {
    commitment: "confirmed",
  });
  console.log(`  ${label}\n    ${signature}`);
  return signature;
}

/** A mint we hold the authority for, so the faucet can hand it out. */
async function createMint(decimals: number): Promise<PublicKey> {
  const mint = Keypair.generate();
  const lamports = await connection.getMinimumBalanceForRentExemption(MINT_SIZE);

  await send(
    `mint (${decimals} decimals) ${mint.publicKey.toBase58()}`,
    [
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: mint.publicKey,
        lamports,
        space: MINT_SIZE,
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeMint2Instruction(mint.publicKey, decimals, payer.publicKey, null),
    ],
    [mint],
  );
  return mint.publicKey;
}

async function mintTo(mint: PublicKey, owner: PublicKey, amount: bigint) {
  const ata = getAssociatedTokenAddressSync(mint, owner, true);
  await send(`mint ${amount} to ${ata.toBase58()}`, [
    createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, ata, owner, mint),
    createMintToInstruction(mint, ata, payer.publicKey, amount),
  ]);
  return ata;
}

async function createLendingMarket(): Promise<PublicKey> {
  const market = Keypair.generate();
  const lamports = await connection.getMinimumBalanceForRentExemption(LENDING_MARKET_SIZE);

  // `quote_currency` is a fixed 32 byte label. Every existing market uses "USD".
  const quoteCurrency = Buffer.alloc(32);
  quoteCurrency.write("USD");

  await send(
    `lending market ${market.publicKey.toBase58()}`,
    [
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: market.publicKey,
        lamports,
        space: LENDING_MARKET_SIZE,
        programId: KLEND_PROGRAM_ID,
      }),
      ix("initLendingMarket", { quoteCurrency: [...quoteCurrency] }, [
        signer(payer.publicKey),
        rw(market.publicKey),
        ro(marketAuthority(market.publicKey)),
        ro(SystemProgram.programId),
        ro(SYSVAR_RENT_PUBKEY),
        ro(SYSVAR_INSTRUCTIONS_PUBKEY),
      ]),
    ],
    [market],
  );

  return market.publicKey;
}

async function createReserve(market: PublicKey, mint: PublicKey, source: PublicKey) {
  const reserve = Keypair.generate();
  const lamports = await connection.getMinimumBalanceForRentExemption(RESERVE_SIZE);
  const pdas = reserveAccounts(reserve.publicKey);

  await send(
    `reserve ${reserve.publicKey.toBase58()}`,
    [
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: reserve.publicKey,
        lamports,
        space: RESERVE_SIZE,
        programId: KLEND_PROGRAM_ID,
      }),
      ix("initReserve", {}, [
        signer(payer.publicKey),
        ro(market),
        ro(marketAuthority(market)),
        rw(reserve.publicKey),
        ro(mint),
        rw(pdas.liquiditySupply),
        rw(pdas.feeReceiver),
        rw(pdas.collateralMint),
        rw(pdas.collateralSupply),
        rw(source),
        ro(SYSVAR_RENT_PUBKEY),
        ro(TOKEN_PROGRAM_ID),
        ro(TOKEN_PROGRAM_ID),
        ro(SystemProgram.programId),
        ro(SYSVAR_INSTRUCTIONS_PUBKEY),
      ]),
    ],
    [reserve],
  );

  return reserve.publicKey;
}

/**
 * One field of a reserve config.
 *
 * `updateReserveConfig` takes a mode and a raw little-endian value, which is why
 * the whole 900-byte config never has to be serialised by hand. Integrity
 * validation is skipped on every call but the last, because the config is
 * inconsistent halfway through by definition.
 */
function setConfig(
  market: PublicKey,
  reserve: PublicKey,
  mode: number,
  value: Buffer,
  validate = false,
) {
  return ix(
    "updateReserveConfig",
    { mode: { [modeName(mode)]: {} }, value, skipConfigIntegrityValidation: !validate },
    [
      signer(payer.publicKey, false),
      ro(GLOBAL_CONFIG),
      ro(market),
      rw(reserve),
      ro(SYSVAR_INSTRUCTIONS_PUBKEY),
    ],
  );
}

const MODE_NAMES = Object.fromEntries(
  Object.entries(UpdateConfigMode).map(([name, value]) => [value, name]),
) as Record<number, string>;

function modeName(mode: number): string {
  const name = MODE_NAMES[mode];
  if (!name) throw new Error(`no name for UpdateConfigMode ${mode}`);
  // Anchor enum variants are camelCase in the TS layer.
  return name[0].toLowerCase() + name.slice(1);
}

function u8(value: number) {
  return Buffer.from([value]);
}
function u64(value: bigint) {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(value);
  return buffer;
}
function name32(text: string) {
  const buffer = Buffer.alloc(32);
  buffer.write(text);
  return buffer;
}

/**
 * `BorrowRateCurve`: eleven (utilization bps, borrow rate bps) points.
 *
 * Utilisation has to reach 10000 by the last point and never decrease, so the tail
 * repeats the final value. Full config validation rejects an unset curve, which is
 * why a plausible one is needed before the limits can be opened.
 */
function borrowRateCurve() {
  const points: [number, number][] = [
    [0, 100],
    [8_000, 1_500],
    [10_000, 5_000],
  ];
  while (points.length < 11) points.push(points[points.length - 1]);

  const buffer = Buffer.alloc(11 * 8);
  points.forEach(([utilization, rate], index) => {
    buffer.writeUInt32LE(utilization, index * 8);
    buffer.writeUInt32LE(rate, index * 8 + 4);
  });
  return buffer;
}

interface ReserveShape {
  label: string;
  ltvPct: number;
  liquidationThresholdPct: number;
  pythFeed: PublicKey;
  depositLimit: bigint;
  borrowLimit: bigint;
}

async function configureReserve(market: PublicKey, reserve: PublicKey, shape: ReserveShape) {
  /*
   * Order is load bearing.
   *
   * KLend only accepts `skipConfigIntegrityValidation` while the reserve is still
   * "predeposit", and a reserve stops being predeposit the moment its deposit limit
   * goes above zero. Setting the limits early therefore makes the very instruction
   * that sets them fail its own post-check. So everything else is written first
   * under the skip, and the two limits go last under full validation — which is the
   * right place for it anyway, because by then the config is complete enough to
   * validate.
   */
  const draft: [number, Buffer][] = [
    [UpdateConfigMode.UpdateTokenInfoName, name32(shape.label)],
    [UpdateConfigMode.UpdatePythPrice, shape.pythFeed.toBuffer()],
    // Devnet feeds go quiet for long stretches; a tight max age would leave the
    // market unusable for reasons that have nothing to do with this project.
    [UpdateConfigMode.UpdateTokenInfoPriceMaxAge, u64(1_000_000n)],
    [UpdateConfigMode.UpdateTokenInfoTwapMaxAge, u64(1_000_000n)],
    [UpdateConfigMode.UpdateLoanToValuePct, u8(shape.ltvPct)],
    [UpdateConfigMode.UpdateLiquidationThresholdPct, u8(shape.liquidationThresholdPct)],
    [UpdateConfigMode.UpdateMinLiquidationBonusBps, u64(200n)],
    [UpdateConfigMode.UpdateMaxLiquidationBonusBps, u64(500n)],
    [UpdateConfigMode.UpdateBorrowFactor, u64(100n)],
    [UpdateConfigMode.UpdateBorrowRateCurve, borrowRateCurve()],
    [UpdateConfigMode.UpdateReserveStatus, u8(0)],
  ];

  // Sent a few at a time: a transaction holding all of them exceeds the size limit.
  for (let index = 0; index < draft.length; index += 4) {
    const batch = draft.slice(index, index + 4);
    await send(
      `config ${shape.label} [${batch.map(([mode]) => modeName(mode)).join(", ")}]`,
      batch.map(([mode, value]) => setConfig(market, reserve, mode, value)),
    );
  }

  await send(`open ${shape.label} [depositLimit, borrowLimit, outsideElevationBorrowLimit]`, [
    setConfig(market, reserve, UpdateConfigMode.UpdateDepositLimit, u64(shape.depositLimit), true),
    setConfig(market, reserve, UpdateConfigMode.UpdateBorrowLimit, u64(shape.borrowLimit), true),
    // Ordinary obligations are not in an elevation group. KLend checks this
    // separate cap for the normal borrow path, and its default is zero.
    setConfig(
      market,
      reserve,
      UpdateConfigMode.UpdateBorrowLimitOutsideElevationGroup,
      u64(shape.borrowLimit),
      true,
    ),
  ]);
}

console.log(`payer   ${payer.publicKey.toBase58()}`);
console.log(`rpc     ${RPC}`);
const balance = await connection.getBalance(payer.publicKey);
console.log(`balance ${(balance / 1e9).toFixed(4)} SOL\n`);
if (balance < 0.5e9) throw new Error("need at least 0.5 SOL; run `solana airdrop 2 --url devnet`");

console.log("mints");
const collateralMint = await createMint(9);
const debtMint = await createMint(6);

console.log("\nseeding the payer");
const collateralSource = await mintTo(collateralMint, payer.publicKey, 1_000_000_000_000n);
const debtSource = await mintTo(debtMint, payer.publicKey, 1_000_000_000_000n);

console.log("\nmarket");
const market = await createLendingMarket();

console.log("\nreserves");
const collateralReserve = await createReserve(market, collateralMint, collateralSource);
const debtReserve = await createReserve(market, debtMint, debtSource);

console.log("\nconfig");
await configureReserve(market, collateralReserve, {
  label: "bSOL",
  ltvPct: 75,
  liquidationThresholdPct: 85,
  pythFeed: PYTH_DEVNET.solUsd,
  depositLimit: 1_000_000_000_000_000n,
  borrowLimit: 1_000_000_000_000_000n,
});
await configureReserve(market, debtReserve, {
  label: "bUSDC",
  ltvPct: 0,
  liquidationThresholdPct: 0,
  pythFeed: PYTH_DEVNET.usdcUsd,
  depositLimit: 1_000_000_000_000_000n,
  borrowLimit: 1_000_000_000_000_000n,
});

const result = {
  cluster: "devnet",
  createdAt: new Date().toISOString(),
  authority: payer.publicKey.toBase58(),
  lendingMarket: market.toBase58(),
  lendingMarketAuthority: marketAuthority(market).toBase58(),
  collateral: {
    label: "bSOL",
    mint: collateralMint.toBase58(),
    decimals: 9,
    reserve: collateralReserve.toBase58(),
    pythFeed: PYTH_DEVNET.solUsd.toBase58(),
  },
  debt: {
    label: "bUSDC",
    mint: debtMint.toBase58(),
    decimals: 6,
    reserve: debtReserve.toBase58(),
    pythFeed: PYTH_DEVNET.usdcUsd.toBase58(),
  },
};

writeFileSync(OUT, `${JSON.stringify(result, null, 2)}\n`);
console.log(`\nwrote ${OUT}`);
console.log(JSON.stringify(result, null, 2));
