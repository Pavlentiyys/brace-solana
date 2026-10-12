import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";

import market from "@/lib/platform/devnet-market.json";

export const runtime = "nodejs";

const DEVNET_RPC = "https://api.devnet.solana.com";
const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const FAUCET_AMOUNT = 1_000_000n; // 1 bUSDC, six decimals
const COOLDOWN_MS = 60_000;
const lastRequests = new Map<string, number>();

function json(body: Record<string, unknown>, status = 200) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function u64(value: bigint): Uint8Array {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, value, true);
  return bytes;
}

function associatedTokenAddress(mint: PublicKey, owner: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  )[0];
}

function createAtaInstruction(payer: PublicKey, owner: PublicKey, mint: PublicKey) {
  return new TransactionInstruction({
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: associatedTokenAddress(mint, owner), isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(Uint8Array.of(1)), // CreateIdempotent
  });
}

function mintToInstruction(mint: PublicKey, destination: PublicKey, authority: PublicKey) {
  return new TransactionInstruction({
    programId: TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: mint, isSigner: false, isWritable: true },
      { pubkey: destination, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: false },
    ],
    data: Buffer.from(Uint8Array.of(7, ...u64(FAUCET_AMOUNT))), // MintTo
  });
}

function faucetKeypair(): Keypair | null {
  const encoded = process.env.BRACE_DEVNET_FAUCET_SECRET_KEY?.trim();
  if (!encoded) return null;

  try {
    const secret = JSON.parse(encoded);
    if (
      !Array.isArray(secret) ||
      secret.length !== 64 ||
      secret.some((value) => !Number.isInteger(value) || value < 0 || value > 255)
    ) {
      return null;
    }
    return Keypair.fromSecretKey(Uint8Array.from(secret));
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  if ((process.env.NEXT_PUBLIC_BRACE_CLUSTER ?? "devnet") !== "devnet") {
    return json({ error: "USDC faucet is available only on devnet." }, 400);
  }

  let address: string;
  try {
    const body = (await request.json()) as { address?: unknown };
    if (typeof body.address !== "string") return json({ error: "A wallet address is required." }, 400);
    address = body.address.trim();
  } catch {
    return json({ error: "Invalid request body." }, 400);
  }

  let owner: PublicKey;
  try {
    owner = new PublicKey(address);
  } catch {
    return json({ error: "Invalid Solana wallet address." }, 400);
  }
  if (!PublicKey.isOnCurve(owner.toBytes())) {
    return json({ error: "The faucet accepts wallet addresses, not program addresses." }, 400);
  }

  const now = Date.now();
  const previous = lastRequests.get(owner.toBase58());
  if (previous !== undefined && now - previous < COOLDOWN_MS) {
    return json({ error: "Try the bUSDC faucet again in a minute." }, 429);
  }

  const payer = faucetKeypair();
  if (payer === null) {
    return json(
      {
        error:
          "The devnet bUSDC faucet is not configured. Add BRACE_DEVNET_FAUCET_SECRET_KEY as a server-only Vercel environment variable, then redeploy.",
      },
      503,
    );
  }

  const mint = new PublicKey(market.debt.mint);
  const destination = associatedTokenAddress(mint, owner);
  const connection = new Connection(process.env.BRACE_DEVNET_RPC_URL?.trim() || DEVNET_RPC, "confirmed");
  const transaction = new Transaction().add(
    createAtaInstruction(payer.publicKey, owner, mint),
    mintToInstruction(mint, destination, payer.publicKey),
  );
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = payer.publicKey;

  const simulation = await connection.simulateTransaction(transaction);
  if (simulation.value.err) {
    return json({ error: "The devnet bUSDC faucet transaction failed simulation." }, 502);
  }

  try {
    const signature = await sendAndConfirmTransaction(connection, transaction, [payer], {
      commitment: "confirmed",
    });
    lastRequests.set(owner.toBase58(), now);
    return json({ amount: "1", symbol: "bUSDC", signature });
  } catch {
    return json({ error: "The devnet bUSDC faucet transaction failed." }, 502);
  }
}
