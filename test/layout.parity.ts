//! Offline layout-parity test: the #1 SDK correctness risk is the TS byte
//! offsets drifting from the Rust programs. On-chain acceptance proves parity
//! at runtime; this guards it in CI without a cluster. Run: npm test

import { PublicKey } from "@solana/web3.js";
import { encodeValueState, VALUE, MANDATE } from "../src/layout";
import { SESSION, SESSION_LEN } from "../src/referee";
import { ENGAGEMENT, ENGAGEMENT_LEN } from "../src/engagement";
import { SPL_TOKEN_PROGRAM_ID } from "../src/constants";

let failures = 0;
function eq(name: string, got: unknown, want: unknown) {
  if (got !== want) {
    console.error(`  FAIL ${name}: got ${got}, want ${want}`);
    failures++;
  }
}

// --- offsets must match crates/policy-core + gate-core (do not drift) ---
eq("VALUE.status", VALUE.status, 1);
eq("VALUE.flags", VALUE.flags, 2);
eq("VALUE.allowedActions", VALUE.allowedActions, 4);
eq("VALUE.maxPerTx", VALUE.maxPerTx, 8);
eq("VALUE.dailyLimit", VALUE.dailyLimit, 16);
eq("VALUE.spentToday", VALUE.spentToday, 24);
eq("VALUE.windowStart", VALUE.windowStart, 32);
eq("VALUE.expiry", VALUE.expiry, 40);
eq("VALUE.owner", VALUE.owner, 48);
eq("VALUE.agent", VALUE.agent, 80);
eq("VALUE.programs", VALUE.programs, 112);
eq("VALUE.mints", VALUE.mints, 240);
eq("VALUE.dests", VALUE.dests, 368);
eq("VALUE.size", VALUE.size, 496);
eq("MANDATE.policyProgram", MANDATE.policyProgram, 496);
eq("MANDATE.vaultBump", MANDATE.vaultBump, 528);
eq("MANDATE.spendCount", MANDATE.spendCount, 529);
eq("MANDATE.freezer", MANDATE.freezer, 537);
eq("MANDATE.size", MANDATE.size, 569);

// --- encodeValueState must place fields at exactly those offsets ---
const owner = new PublicKey("5EiLNkpp3QiH1wzBEHnCdWSpxREFH2q5jje9S2gVmaMz");
const agent = new PublicKey("11111111111111111111111111111111");
const mint = new PublicKey("So11111111111111111111111111111111111111112");
const dest = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
const v = encodeValueState({
  owner, agent, tokenProgram: SPL_TOKEN_PROGRAM_ID, mint, dest,
  maxPerTx: 1_000n, dailyLimit: 5_000n, expiry: 2_000_000_000n,
});

eq("encoded length", v.length, 496);
eq("schema byte", v[VALUE.schema], 1);
eq("status byte", v[VALUE.status], 0);
eq("allowed_actions LE", v.readUInt32LE(VALUE.allowedActions), 1);
eq("max_per_tx LE", v.readBigUInt64LE(VALUE.maxPerTx), 1_000n);
eq("daily_limit LE", v.readBigUInt64LE(VALUE.dailyLimit), 5_000n);
eq("expiry LE", v.readBigInt64LE(VALUE.expiry), 2_000_000_000n);
eq("owner bytes", v.subarray(VALUE.owner, VALUE.owner + 32).equals(owner.toBuffer()), true);
eq("agent bytes", v.subarray(VALUE.agent, VALUE.agent + 32).equals(agent.toBuffer()), true);
eq("token program @programs", v.subarray(VALUE.programs, VALUE.programs + 32).equals(SPL_TOKEN_PROGRAM_ID.toBuffer()), true);
eq("mint bytes", v.subarray(VALUE.mints, VALUE.mints + 32).equals(mint.toBuffer()), true);
eq("dest bytes", v.subarray(VALUE.dests, VALUE.dests + 32).equals(dest.toBuffer()), true);

// --- referee Session offsets (programs/referee/src/lib.rs) ---
eq("SESSION_LEN", SESSION_LEN, 344);
eq("SESSION.status", SESSION.status, 0);
eq("SESSION.winner", SESSION.winner, 1);
eq("SESSION.operator", SESSION.operator, 8);
eq("SESSION.challenger", SESSION.challenger, 40);
eq("SESSION.gameProgram", SESSION.gameProgram, 72);
eq("SESSION.bond", SESSION.bond, 104);
eq("SESSION.loTick", SESSION.loTick, 128);
eq("SESSION.hiTick", SESSION.hiTick, 200);
eq("SESSION.midTick", SESSION.midTick, 272);

// --- engagement offsets (programs/engagement/src/lib.rs) ---
eq("ENGAGEMENT_LEN", ENGAGEMENT_LEN, 280);
eq("ENGAGEMENT.phase", ENGAGEMENT.phase, 0);
eq("ENGAGEMENT.principal", ENGAGEMENT.principal, 8);
eq("ENGAGEMENT.operator", ENGAGEMENT.operator, 40);
eq("ENGAGEMENT.session", ENGAGEMENT.session, 136);
eq("ENGAGEMENT.bond", ENGAGEMENT.bond, 168);
eq("ENGAGEMENT.finalTick", ENGAGEMENT.finalTick, 176);
eq("ENGAGEMENT.maxExposure", ENGAGEMENT.maxExposure, 264);
eq("ENGAGEMENT.offchainCommitted", ENGAGEMENT.offchainCommitted, 272);

if (failures > 0) {
  console.error(`\nlayout parity: ${failures} FAILED`);
  process.exit(1);
}
console.log("layout parity: OK (TS offsets match the Rust programs)");
