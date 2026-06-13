// One-off: stand up a mandate + funded vault on devnet so the Claude and MCP
// examples have something real to spend. Mirrors how you'd open a mandate in
// production with openMandate(), but mints a token we control so the demo never
// runs dry. Writes public addresses to demo.json and the agent key to .env.
//
//   npm run setup
//
// Needs a funded devnet keypair (OWNER_KEYPAIR or ~/.config/solana/id.json) as
// the mandate owner + fee payer. On devnet that key is also the policy's upgrade
// authority in the deployed demo, which U17 requires of the mandate owner.
import "dotenv/config";
import { createMint, createAccount, mintTo } from "@solana/spl-token";
import { Connection, Keypair } from "@solana/web3.js";
import { openMandate, SPL_TOKEN_PROGRAM_ID } from "@nzengi/ticklogic-sdk";
import { readFileSync, writeFileSync, existsSync, appendFileSync } from "node:fs";
import { homedir } from "node:os";

const RPC = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
const DECIMALS = 6;
const PER_TX = 1_000n;
const DAILY = 5_000n;
const VAULT_FUND = 1_000_000n; // plenty for repeated demo spends

function loadOwner(): Keypair {
  const path = process.env.OWNER_KEYPAIR ?? `${homedir()}/.config/solana/id.json`;
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
}

async function main() {
  const connection = new Connection(RPC, "confirmed");
  const owner = loadOwner();
  const agent = Keypair.generate();
  console.log("owner :", owner.publicKey.toBase58());
  console.log("agent :", agent.publicKey.toBase58());

  // a mint we control + the one destination the agent may pay
  const mint = await createMint(connection, owner, owner.publicKey, null, DECIMALS);
  const allowedDest = await createAccount(connection, owner, mint, owner.publicKey, Keypair.generate());
  console.log("mint  :", mint.toBase58());

  // open the mandate (owner = fee payer + create signer)
  const { mandate, vaultAuthority } = await openMandate(connection, owner, {
    agent: agent.publicKey,
    tokenProgram: SPL_TOKEN_PROGRAM_ID,
    mint,
    dest: allowedDest,
    maxPerTx: PER_TX,
    dailyLimit: DAILY,
    expiry: 4_000_000_000n,
  });
  console.log("mandate:", mandate.toBase58());

  // the vault the gate controls — fund it so the agent has something to spend
  const vaultToken = await createAccount(connection, owner, mint, vaultAuthority, Keypair.generate());
  await mintTo(connection, owner, mint, vaultToken, owner, VAULT_FUND);
  console.log("vault funded:", VAULT_FUND.toString());

  const demo = {
    rpc: RPC,
    mandate: mandate.toBase58(),
    vaultToken: vaultToken.toBase58(),
    mint: mint.toBase58(),
    allowedDest: allowedDest.toBase58(),
    agent: agent.publicKey.toBase58(),
    owner: owner.publicKey.toBase58(),
    perTx: Number(PER_TX),
    dailyLimit: Number(DAILY),
  };
  writeFileSync(new URL("../demo.json", import.meta.url), JSON.stringify(demo, null, 2) + "\n");

  const envLine = `\n# written by setup — the agent signing key (devnet only)\nAGENT_SECRET=${JSON.stringify(Array.from(agent.secretKey))}\n`;
  const envPath = new URL("../.env", import.meta.url);
  if (existsSync(envPath)) appendFileSync(envPath, envLine);
  else writeFileSync(envPath, envLine.trimStart());

  console.log("\nwrote demo.json + AGENT_SECRET to .env");
  console.log("now run:  npm run claude   (or wire src/mcp.ts into an MCP client)");
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  }
);
