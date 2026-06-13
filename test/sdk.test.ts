//! Offline unit tests: builders emit the right tag/accounts/data, decoders read
//! the right fields, error classifiers parse every shape, and the math/PDAs are
//! deterministic. No cluster — pure encode/decode. Run: npm test

import { Keypair, PublicKey } from "@solana/web3.js";
import {
  buildExecute, buildSetStatus, buildUpdate, buildFreezeExternal, buildWithdraw,
  deriveVaultAuthority, deriveFreezer,
  buildRefereeInit, buildCheckpoint, buildTimeout, decodeSession, SESSION,
  buildEngagementCreate, buildCommit, buildRelease, recommendedBond, decodeEngagement, ENGAGEMENT,
  buildTick, buildVerdict, buildLoadState, POLICY_TAG,
  encodeValueState, decodeMandate, VALUE, MANDATE,
  classifyGateError, classifyRefereeError, classifyEngagementError,
  GATE_PROGRAM_ID, REFEREE_PROGRAM_ID, ENGAGEMENT_PROGRAM_ID, POLICY_PROGRAM_ID,
  SPL_TOKEN_PROGRAM_ID, GATE_TAG,
} from "../src/index";

let failures = 0;
let n = 0;
function eq(name: string, got: unknown, want: unknown) {
  n++;
  const g = typeof got === "bigint" ? got.toString() : got;
  const w = typeof want === "bigint" ? want.toString() : want;
  if (g !== w) {
    console.error(`  FAIL ${name}: got ${String(g)}, want ${String(w)}`);
    failures++;
  }
}
function ok(name: string, cond: boolean) {
  eq(name, cond, true);
}
function throws(name: string, fn: () => unknown) {
  n++;
  try {
    fn();
    console.error(`  FAIL ${name}: expected throw`);
    failures++;
  } catch {
    /* expected */
  }
}

const A = Keypair.generate().publicKey;
const B = Keypair.generate().publicKey;
const C = Keypair.generate().publicKey;
const claim = Buffer.alloc(64, 7);
const u64 = (v: bigint) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(v, 0); return b; };

// ---- gate builders ----
{
  const ix = buildExecute({ mandate: A, agent: B, vaultToken: C, mint: A, destToken: B }, 700n);
  ok("execute programId", ix.programId.equals(GATE_PROGRAM_ID));
  eq("execute tag", ix.data[0], GATE_TAG.execute);
  eq("execute data len", ix.data.length, 9);
  eq("execute amount", Buffer.from(ix.data).readBigUInt64LE(1), 700n);
  eq("execute keys", ix.keys.length, 8);
  ok("execute agent signs", ix.keys[1].isSigner);
  ok("execute mandate writable", ix.keys[0].isWritable);
  ok("execute vaultToken writable", ix.keys[4].isWritable);

  eq("freeze tag", buildSetStatus(A, B, "freeze").data[0], GATE_TAG.freeze);
  eq("revoke tag", buildSetStatus(A, B, "revoke").data[0], GATE_TAG.revoke);

  const upd = buildUpdate({ mandate: A, owner: B }, { owner: B, agent: C, tokenProgram: SPL_TOKEN_PROGRAM_ID, mint: A, dest: B, maxPerTx: 1n, dailyLimit: 2n, expiry: 3n });
  eq("update tag", upd.data[0], GATE_TAG.update);
  eq("update data len", upd.data.length, 1 + VALUE.size);
  ok("update owner signs", upd.keys[1].isSigner);

  const fe = buildFreezeExternal(A, B);
  eq("freezeExternal tag", fe.data[0], GATE_TAG.freezeExternal);
  ok("freezeExternal freezer signs", fe.keys[1].isSigner);

  eq("withdraw tag", buildWithdraw({ mandate: A, owner: B, vaultToken: C, mint: A, destToken: B }, 9n).data[0], GATE_TAG.withdraw);
}

// ---- referee builders + validation ----
{
  eq("refInit tag", buildRefereeInit(A, B, POLICY_PROGRAM_ID, 1n, claim).data[0], 0);
  throws("refInit bad claim", () => buildRefereeInit(A, B, POLICY_PROGRAM_ID, 1n, Buffer.alloc(10)));
  throws("checkpoint bad claim", () => buildCheckpoint(A, B, 1n, Buffer.alloc(10)));
  const to = buildTimeout(A, B, C);
  eq("timeout tag", to.data[0], 7);
  eq("timeout keys", to.keys.length, 3);
  ok("timeout all writable", to.keys.every((k) => k.isWritable));
  ok("timeout no signer", to.keys.every((k) => !k.isSigner));
}

// ---- engagement builders + validation ----
{
  const ix = buildEngagementCreate(A, B, C, { bond: 100n, finalTick: 8n, deadlineSlots: 9n, genesisClaim: claim, maxExposure: 50n });
  eq("engCreate tag", ix.data[0], 0);
  ok("engCreate programId", ix.programId.equals(ENGAGEMENT_PROGRAM_ID));
  throws("engCreate bad genesis", () => buildEngagementCreate(A, B, C, { bond: 1n, finalTick: 1n, deadlineSlots: 1n, genesisClaim: Buffer.alloc(10), maxExposure: 1n }));
  eq("commit tag", buildCommit(A, B, 5n).data[0], 9);
  eq("commit amount", Buffer.from(buildCommit(A, B, 5n).data).readBigUInt64LE(1), 5n);
  eq("release tag", buildRelease(A, B, 5n).data[0], 10);
}

// ---- policy builders ----
{
  const t = buildTick(A, 42n, Buffer.from([1, 2, 3]));
  eq("tick tag", t.data[0], POLICY_TAG.tick);
  eq("tick index", Buffer.from(t.data).readBigUInt64LE(1), 42n);
  eq("verdict tag", buildVerdict(A).data[0], POLICY_TAG.verdict);
  const ls = buildLoadState(A, Buffer.alloc(4));
  eq("loadState tag", ls.data[0], POLICY_TAG.loadState);
  ok("loadState signs", ls.keys[0].isSigner);
}

// ---- decodeMandate (round-trip via encodeValueState) ----
{
  const v = encodeValueState({ owner: A, agent: B, tokenProgram: SPL_TOKEN_PROGRAM_ID, mint: C, dest: A, maxPerTx: 1000n, dailyLimit: 5000n, expiry: 2_000_000_000n });
  v.writeUInt16LE(1, VALUE.flags); // ALLOW_ANY_DEST
  v.writeBigUInt64LE(250n, VALUE.spentToday);
  const data = Buffer.concat([v, Buffer.alloc(MANDATE.size - VALUE.size)]);
  C.toBuffer().copy(data, MANDATE.policyProgram);
  data.writeBigUInt64LE(3n, MANDATE.spendCount);
  const m = decodeMandate(data);
  eq("mandate maxPerTx", m.maxPerTx, 1000n);
  eq("mandate spentToday", m.spentToday, 250n);
  eq("mandate allowAnyDest", m.allowAnyDest, true);
  ok("mandate owner", m.owner.equals(A));
  ok("mandate mint", m.mint.equals(C));
  eq("mandate spendCount", m.spendCount, 3n);
  ok("mandate policyProgram", m.policyProgram.equals(C));
  throws("decodeMandate bad len", () => decodeMandate(Buffer.alloc(10)));
}

// ---- decodeSession ----
{
  const d = Buffer.alloc(SESSION.status >= 0 ? 344 : 344);
  d[SESSION.status] = 3;
  d[SESSION.winner] = 2;
  A.toBuffer().copy(d, SESSION.operator);
  d.writeBigUInt64LE(1_000_000n, SESSION.bond);
  d.writeBigUInt64LE(4n, SESSION.loTick);
  d.writeBigUInt64LE(5n, SESSION.hiTick);
  const s = decodeSession(d);
  eq("session status", s.status, 3);
  eq("session winner", s.winner, 2);
  eq("session bond", s.bond, 1_000_000n);
  eq("session lo/hi", `${s.loTick}-${s.hiTick}`, "4-5");
  ok("session operator", s.operator.equals(A));
}

// ---- decodeEngagement ----
{
  const d = Buffer.alloc(280);
  d[ENGAGEMENT.phase] = 1;
  d[ENGAGEMENT.outcome] = 2;
  d.writeBigUInt64LE(2_000_000n, ENGAGEMENT.bond);
  d.writeBigUInt64LE(50_000n, ENGAGEMENT.maxExposure);
  d.writeBigUInt64LE(12_345n, ENGAGEMENT.offchainCommitted);
  const e = decodeEngagement(d);
  eq("eng phase", e.phase, 1);
  eq("eng outcome", e.outcome, 2);
  eq("eng bond", e.bond, 2_000_000n);
  eq("eng maxExposure", e.maxExposure, 50_000n);
  eq("eng offchainCommitted", e.offchainCommitted, 12_345n);
}

// ---- error classifiers (every shape) ----
{
  eq("structured Custom", classifyGateError({ InstructionError: [0, { Custom: 12 }] })?.name, "DENIED");
  eq("stringified Custom", classifyGateError({ message: 'Error: {"InstructionError":[0,{"Custom":4}]}' })?.name, "NOT_ACTIVE");
  eq("hex preflight", classifyGateError(new Error("custom program error: 0xc"))?.name, "DENIED");
  eq("no code", classifyGateError(new Error("network down")), undefined);
  eq("referee CLAIM", classifyRefereeError({ InstructionError: [0, { Custom: 6 }] })?.name, "CLAIM");
  eq("engagement BOND_TOO_LOW", classifyEngagementError({ InstructionError: [0, { Custom: 11 }] })?.name, "BOND_TOO_LOW");
  eq("unknown code", classifyGateError({ InstructionError: [0, { Custom: 200 }] })?.name, "UNKNOWN(200)");
}

// ---- math + PDA determinism ----
{
  eq("recommendedBond 2x", recommendedBond(50_000n), 100_000n);
  eq("recommendedBond 3x", recommendedBond(50_000n, 30_000), 150_000n);
  eq("recommendedBond zero", recommendedBond(0n), 0n);
  const [vault1] = deriveVaultAuthority(A);
  const [vault2] = deriveVaultAuthority(A);
  ok("vault PDA deterministic", vault1.equals(vault2));
  ok("vault PDA is PublicKey", vault1 instanceof PublicKey);
  const [fz1] = deriveFreezer(A);
  const [fz2] = deriveFreezer(A);
  ok("freezer PDA deterministic", fz1.equals(fz2));
}

if (failures > 0) {
  console.error(`\nsdk tests: ${failures}/${n} FAILED`);
  process.exit(1);
}
console.log(`sdk tests: OK (${n} assertions)`);
