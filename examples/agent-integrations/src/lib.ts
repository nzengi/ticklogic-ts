// Shared wiring for both examples: load the mandate that `setup.ts` opened and
// build a MandateSpender. This is the only TickLogic-specific code an agent
// integration needs — everything below routes value moves through `spender`.
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { MandateSpender, type Spender } from "@nzengi/ticklogic-sdk";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";

export interface Demo {
  rpc: string;
  mandate: string;
  vaultToken: string;
  mint: string;
  allowedDest: string;
  agent: string;
  owner: string;
  perTx: number;
  dailyLimit: number;
}

export interface Wiring {
  connection: Connection;
  spender: Spender;
  demo: Demo;
  allowedDest: PublicKey;
}

function loadOwner(): Keypair {
  const path = process.env.OWNER_KEYPAIR ?? `${homedir()}/.config/solana/id.json`;
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
}

export function load(): Wiring {
  let demo: Demo;
  try {
    demo = JSON.parse(readFileSync(new URL("../demo.json", import.meta.url), "utf8"));
  } catch {
    throw new Error("demo.json not found — run `npm run setup` first.");
  }
  if (!process.env.AGENT_SECRET) {
    throw new Error("AGENT_SECRET missing from .env — run `npm run setup` first.");
  }

  const connection = new Connection(demo.rpc, "confirmed");
  const owner = loadOwner(); // fee payer
  const agent = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(process.env.AGENT_SECRET)));

  const spender = new MandateSpender({
    connection,
    feePayer: owner,
    agent,
    mandate: new PublicKey(demo.mandate),
    vaultToken: new PublicKey(demo.vaultToken),
    mint: new PublicKey(demo.mint),
  });

  return { connection, spender, demo, allowedDest: new PublicKey(demo.allowedDest) };
}
