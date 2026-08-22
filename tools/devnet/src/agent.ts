/**
 * The agent keypair.
 *
 * `execute_action` is the only instruction that moves the reserve, and only this key
 * can call it — the guard checks it against the `agent` recorded at authorization.
 * It is deliberately not the owner's key: the whole point is that the thing watching
 * the market cannot withdraw, cannot change the policy and cannot revoke.
 *
 * The secret stays out of git. Only the public key reaches the app, which needs it to
 * write the authorization.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Keypair } from "@solana/web3.js";

const HERE = dirname(fileURLToPath(import.meta.url));
export const AGENT_PATH = join(HERE, "../agent.json");

export function loadOrCreateAgent(): Keypair {
  if (existsSync(AGENT_PATH)) {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(AGENT_PATH, "utf8"))));
  }
  const agent = Keypair.generate();
  writeFileSync(AGENT_PATH, JSON.stringify([...agent.secretKey]));
  return agent;
}
