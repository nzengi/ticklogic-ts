// Squads multisig custody: the kill-switch lives in the multisig.
//
// Owner of a mandate = a Squads multisig vault (a PDA, cold custody). Because the
// owner is a PDA, you don't sign with a Keypair — you build the gate instruction
// and execute it through a Squads vault transaction (propose → approve → execute).
// This script creates a real multisig on devnet and runs the FREEZE kill-switch
// on a vault-owned mandate through it.
//
//   npm run setup && SQUADS_MANDATE=<addr> npm run squads
//
// Honest prerequisite (U17): a mandate whose owner is the multisig vault can only
// be OPENED against a policy that is immutable or whose upgrade authority is that
// vault — the gate refuses an upgradeable third-party policy (POLICY_UPGRADEABLE).
// On the shared devnet demo policy (authority = the deployer) you'd deploy your own
// `policy_program.so --final` first. The buildCreateMandate ix below is exactly what
// you'd wrap in a vault transaction (via a Squads ephemeral signer for the mandate
// account); this script focuses on the kill-switch, which has no such prerequisite.
import "dotenv/config";
import { Connection, Keypair, PublicKey, TransactionMessage } from "@solana/web3.js";
import * as multisig from "@sqds/multisig";
import { buildSetStatus } from "@nzengi/ticklogic-sdk";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";

const RPC = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";

function loadFunder(): Keypair {
  const path = process.env.OWNER_KEYPAIR ?? `${homedir()}/.config/solana/id.json`;
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
}

async function main() {
  const connection = new Connection(RPC, "confirmed");
  const funder = loadFunder(); // creator + sole member + fee payer
  const createKey = Keypair.generate(); // the multisig's create seed

  // 1. create a 1-of-1 Squads multisig on devnet
  const [multisigPda] = multisig.getMultisigPda({ createKey: createKey.publicKey });
  const programConfigPda = multisig.getProgramConfigPda({})[0];
  const programConfig = await multisig.accounts.ProgramConfig.fromAccountAddress(connection, programConfigPda);

  await multisig.rpc.multisigCreateV2({
    connection,
    treasury: programConfig.treasury,
    createKey,
    creator: funder,
    multisigPda,
    configAuthority: null,
    threshold: 1,
    members: [{ key: funder.publicKey, permissions: multisig.types.Permissions.all() }],
    timeLock: 0,
    rentCollector: null,
  });
  const [vault] = multisig.getVaultPda({ multisigPda, index: 0 });
  console.log("multisig:", multisigPda.toBase58());
  console.log("vault (mandate owner):", vault.toBase58());

  const mandateStr = process.env.SQUADS_MANDATE;
  if (!mandateStr) {
    console.log(
      "\nNo SQUADS_MANDATE set. Open a mandate with owner =",
      vault.toBase58(),
      "\n(against an immutable / vault-authority policy — U17), then re-run to freeze it via the multisig."
    );
    return;
  }
  const mandate = new PublicKey(mandateStr);

  // 2. the kill-switch instruction — owner is the vault PDA, signed by Squads
  const freezeIx = buildSetStatus(mandate, vault, "freeze");

  // 3. wrap it in a vault transaction and run it through the multisig
  const transactionIndex = 1n;
  const { blockhash } = await connection.getLatestBlockhash();
  const transactionMessage = new TransactionMessage({
    payerKey: vault,
    recentBlockhash: blockhash,
    instructions: [freezeIx],
  });

  await multisig.rpc.vaultTransactionCreate({
    connection,
    feePayer: funder,
    multisigPda,
    transactionIndex,
    creator: funder.publicKey,
    vaultIndex: 0,
    ephemeralSigners: 0,
    transactionMessage,
  });
  await multisig.rpc.proposalCreate({ connection, feePayer: funder, creator: funder, multisigPda, transactionIndex });
  await multisig.rpc.proposalApprove({ connection, feePayer: funder, member: funder, multisigPda, transactionIndex });
  const sig = await multisig.rpc.vaultTransactionExecute({
    connection,
    feePayer: funder,
    multisigPda,
    transactionIndex,
    member: funder.publicKey,
  });

  console.log(`\nfroze mandate ${mandate.toBase58().slice(0, 8)}… through the multisig · ${sig}`);
  console.log("The agent can no longer spend. The owner (multisig) can still withdraw — custody never deadlocks (B8).");
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  }
);
