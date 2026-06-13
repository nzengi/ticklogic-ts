import { Buffer } from "buffer";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import {
  ENGAGEMENT_PROGRAM_ID,
  GATE_PROGRAM_ID,
  POLICY_PROGRAM_ID,
  REFEREE_PROGRAM_ID,
} from "./constants";
import { derivePolicyProgramData } from "./instructions";

// ===========================================================================
// Engagement layout + instruction builders - the EXACT mirror of
// programs/engagement/src/lib.rs (verified against clients/devnet-demo).
// ===========================================================================

export const ENGAGEMENT_LEN = 280;

export const ENGAGEMENT = {
  phase: 0,
  outcome: 1,
  principal: 8,
  operator: 40,
  policyProgram: 72,
  refereeProgram: 104,
  session: 136,
  bond: 168, // u64
  finalTick: 176, // u64
  deadlineSlots: 184, // u64
  deadline: 192, // u64
  genesisClaim: 200, // [u8;64]
  maxExposure: 264, // u64 (U13/B9: bond must cover this)
  offchainCommitted: 272, // u64 (U13: outstanding committed exposure)
} as const;

export const PHASE = { open: 0, live: 1, settled: 2 } as const;
export const OUTCOME = { none: 0, honored: 1, slashed: 2, expired: 3 } as const;

const ENG_TAG = {
  create: 0,
  join: 1,
  cancel: 2,
  bind: 3,
  settleCoop: 4,
  settle: 5,
  slash: 6,
  expire: 7,
  reportSlash: 8,
  commit: 9,
  release: 10,
} as const;

/** The freeze PDA an engagement signs with to freeze the agent's mandate (U7):
 *  [b"freezer", engagement] on the engagement program. The mandate must have
 *  designated this exact PDA as its freezer at create time. */
export function deriveFreezer(
  engagement: PublicKey,
  engagementProgram: PublicKey = ENGAGEMENT_PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("freezer"), engagement.toBuffer()],
    engagementProgram
  );
}

export interface EngagementState {
  phase: number;
  outcome: number;
  principal: PublicKey;
  operator: PublicKey;
  policyProgram: PublicKey;
  refereeProgram: PublicKey;
  session: PublicKey;
  bond: bigint;
  finalTick: bigint;
  deadlineSlots: bigint;
  deadline: bigint;
  maxExposure: bigint;
  offchainCommitted: bigint;
}

export function decodeEngagement(data: Buffer): EngagementState {
  if (data.length !== ENGAGEMENT_LEN) {
    throw new Error(`Engagement must be ${ENGAGEMENT_LEN} bytes, got ${data.length}`);
  }
  const pk = (o: number) => new PublicKey(data.subarray(o, o + 32));
  return {
    phase: data[ENGAGEMENT.phase],
    outcome: data[ENGAGEMENT.outcome],
    principal: pk(ENGAGEMENT.principal),
    operator: pk(ENGAGEMENT.operator),
    policyProgram: pk(ENGAGEMENT.policyProgram),
    refereeProgram: pk(ENGAGEMENT.refereeProgram),
    session: pk(ENGAGEMENT.session),
    bond: data.readBigUInt64LE(ENGAGEMENT.bond),
    finalTick: data.readBigUInt64LE(ENGAGEMENT.finalTick),
    deadlineSlots: data.readBigUInt64LE(ENGAGEMENT.deadlineSlots),
    deadline: data.readBigUInt64LE(ENGAGEMENT.deadline),
    maxExposure: data.readBigUInt64LE(ENGAGEMENT.maxExposure),
    offchainCommitted: data.readBigUInt64LE(ENGAGEMENT.offchainCommitted),
  };
}

const eng = (pid?: PublicKey) => pid ?? ENGAGEMENT_PROGRAM_ID;
const w = (pubkey: PublicKey) => ({ pubkey, isSigner: false, isWritable: true });
const r = (pubkey: PublicKey) => ({ pubkey, isSigner: false, isWritable: false });
const s = (pubkey: PublicKey) => ({ pubkey, isSigner: true, isWritable: false });
const sw = (pubkey: PublicKey) => ({ pubkey, isSigner: true, isWritable: true });
function u64(v: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(v, 0);
  return b;
}

export interface CreateEngagementParams {
  bond: bigint;
  finalTick: bigint;
  deadlineSlots: bigint;
  genesisClaim: Buffer;
  /** U13/B9: the principal's declared quantifiable exposure. The program enforces
   *  bond >= maxExposure (the strict no-profit floor). 0 imposes no floor. */
  maxExposure: bigint;
}

/** The B9 deterrence floor: the minimum bond covering `maxExposure` scaled by a
 *  liveness coefficient (bps; 10_000 = 1.0x). The program enforces the 1.0x floor;
 *  principals SHOULD size above it (k = 1/p_detect, e.g. 20_000 for p=0.5). */
export function recommendedBond(maxExposure: bigint, coefficientBps = 20_000): bigint {
  return (maxExposure * BigInt(coefficientBps)) / 10_000n;
}

/** create: principal sets the terms (no funds move). accounts:
 *  [engagement(w), principal(signer), operator, policy, referee, policy_programdata]. */
export function buildEngagementCreate(
  engagement: PublicKey,
  principal: PublicKey,
  operator: PublicKey,
  params: CreateEngagementParams,
  policy: PublicKey = POLICY_PROGRAM_ID,
  refereeProgram: PublicKey = REFEREE_PROGRAM_ID,
  engagementProgram?: PublicKey
): TransactionInstruction {
  if (params.genesisClaim.length !== 64) {
    throw new Error(`genesisClaim must be 64 bytes (state root ‖ input chain), got ${params.genesisClaim.length}`);
  }
  const [policyProgramData] = derivePolicyProgramData(policy);
  const data = Buffer.concat([
    Buffer.from([ENG_TAG.create]),
    u64(params.bond),
    u64(params.finalTick),
    u64(params.deadlineSlots),
    params.genesisClaim,
    u64(params.maxExposure),
  ]);
  return new TransactionInstruction({
    programId: eng(engagementProgram),
    keys: [w(engagement), s(principal), r(operator), r(policy), r(refereeProgram), r(policyProgramData)],
    data,
  });
}

/** join: operator's bond must already sit on the engagement account. */
export function buildJoin(
  engagement: PublicKey,
  operator: PublicKey,
  engagementProgram?: PublicKey
): TransactionInstruction {
  return new TransactionInstruction({
    programId: eng(engagementProgram),
    keys: [w(engagement), s(operator)],
    data: Buffer.from([ENG_TAG.join]),
  });
}

/** bind: bind ONE virgin referee session (once-only, GE6). */
export function buildBind(
  engagement: PublicKey,
  operator: PublicKey,
  session: PublicKey,
  engagementProgram?: PublicKey
): TransactionInstruction {
  return new TransactionInstruction({
    programId: eng(engagementProgram),
    keys: [w(engagement), s(operator), r(session)],
    data: Buffer.from([ENG_TAG.bind]),
  });
}

/** slash: the bound session resolved against the operator -> bond to principal. */
export function buildSlash(
  engagement: PublicKey,
  session: PublicKey,
  principal: PublicKey,
  engagementProgram?: PublicKey
): TransactionInstruction {
  return new TransactionInstruction({
    programId: eng(engagementProgram),
    keys: [w(engagement), r(session), w(principal)],
    data: Buffer.from([ENG_TAG.slash]),
  });
}

/** report_slash: the U7 interlock - freeze the agent's mandate via the freeze PDA.
 *  accounts: [engagement(w), mandate(w), gate_program, freezer_pda]. */
export function buildReportSlash(
  engagement: PublicKey,
  mandate: PublicKey,
  gateProgram: PublicKey = GATE_PROGRAM_ID,
  engagementProgram: PublicKey = ENGAGEMENT_PROGRAM_ID
): TransactionInstruction {
  const [freezer] = deriveFreezer(engagement, engagementProgram);
  return new TransactionInstruction({
    programId: engagementProgram,
    keys: [w(engagement), w(mandate), r(gateProgram), r(freezer)],
    data: Buffer.from([ENG_TAG.reportSlash]),
  });
}

/** settle: proven-honest finalize -> bond to operator. data = [tag, final_state].
 *  accounts: [engagement(w), session, scratch(w,signer), policy, principal(w), operator(w)]. */
export function buildSettle(
  engagement: PublicKey,
  session: PublicKey,
  scratch: PublicKey,
  principal: PublicKey,
  operator: PublicKey,
  finalState: Buffer,
  policy: PublicKey = POLICY_PROGRAM_ID,
  engagementProgram?: PublicKey
): TransactionInstruction {
  return new TransactionInstruction({
    programId: eng(engagementProgram),
    keys: [w(engagement), r(session), sw(scratch), r(policy), w(principal), w(operator)],
    data: Buffer.concat([Buffer.from([ENG_TAG.settle]), finalState]),
  });
}

/** settle_coop: principal + operator co-sign -> bond to operator (instant close). */
export function buildSettleCoop(
  engagement: PublicKey,
  principal: PublicKey,
  operator: PublicKey,
  engagementProgram?: PublicKey
): TransactionInstruction {
  return new TransactionInstruction({
    programId: eng(engagementProgram),
    keys: [w(engagement), s(principal), sw(operator)],
    data: Buffer.from([ENG_TAG.settleCoop]),
  });
}

/** cancel: principal voids an unjoined engagement. */
export function buildCancel(
  engagement: PublicKey,
  principal: PublicKey,
  engagementProgram?: PublicKey
): TransactionInstruction {
  return new TransactionInstruction({
    programId: eng(engagementProgram),
    keys: [w(engagement), s(principal)],
    data: Buffer.from([ENG_TAG.cancel]),
  });
}

/** expire: permissionless after the deadline -> bond to principal (fail-closed). */
export function buildExpire(
  engagement: PublicKey,
  principal: PublicKey,
  engagementProgram?: PublicKey
): TransactionInstruction {
  return new TransactionInstruction({
    programId: eng(engagementProgram),
    keys: [w(engagement), w(principal)],
    data: Buffer.from([ENG_TAG.expire]),
  });
}

/** commit: reserve off-chain commitment exposure (U13). Caps at max_exposure
 *  (the bonded ceiling). accounts: [engagement(w), operator(signer)]. LIVE only. */
export function buildCommit(
  engagement: PublicKey,
  operator: PublicKey,
  amount: bigint,
  engagementProgram?: PublicKey
): TransactionInstruction {
  return new TransactionInstruction({
    programId: eng(engagementProgram),
    keys: [w(engagement), s(operator)],
    data: Buffer.concat([Buffer.from([ENG_TAG.commit]), u64(amount)]),
  });
}

/** release: free a fulfilled off-chain commitment (U13), lowering offchain_committed. */
export function buildRelease(
  engagement: PublicKey,
  operator: PublicKey,
  amount: bigint,
  engagementProgram?: PublicKey
): TransactionInstruction {
  return new TransactionInstruction({
    programId: eng(engagementProgram),
    keys: [w(engagement), s(operator)],
    data: Buffer.concat([Buffer.from([ENG_TAG.release]), u64(amount)]),
  });
}
