import { Buffer } from "buffer";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { POLICY_PROGRAM_ID } from "./constants";

// ===========================================================================
// policy-program instruction builders (programs/policy-program/src/lib.rs).
//
// ADVANCED / mostly internal: in normal use these are CPI'd by the referee
// (LoadState + Tick during replay) and the engagement (LoadState + Verdict
// during settle), so you rarely build them directly — buildReplay/buildSettle
// already do. They're exported for completeness and off-chain tooling. The pure
// `gate_check` (tag 3) is a CPI that returns data, not a standalone transaction,
// so it has no builder.
// ===========================================================================

export const POLICY_TAG = {
  tick: 0,
  loadState: 1,
  verdict: 2,
  gateCheck: 3,
} as const;

/** Tick: advance a policy state account by one decision. data = [0, tick_index u64, inputs].
 *  accounts: [state(w)]. */
export function buildTick(
  state: PublicKey,
  tickIndex: bigint,
  inputs: Buffer,
  policyProgram: PublicKey = POLICY_PROGRAM_ID
): TransactionInstruction {
  const idx = Buffer.alloc(8);
  idx.writeBigUInt64LE(tickIndex, 0);
  return new TransactionInstruction({
    programId: policyProgram,
    keys: [{ pubkey: state, isSigner: false, isWritable: true }],
    data: Buffer.concat([Buffer.from([POLICY_TAG.tick]), idx, inputs]),
  });
}

/** LoadState: seed a (policy-owned) scratch account with raw state. The account
 *  must sign and be exactly the state length. accounts: [state(w, signer)]. */
export function buildLoadState(
  state: PublicKey,
  stateBytes: Buffer,
  policyProgram: PublicKey = POLICY_PROGRAM_ID
): TransactionInstruction {
  return new TransactionInstruction({
    programId: policyProgram,
    keys: [{ pubkey: state, isSigner: true, isWritable: true }],
    data: Buffer.concat([Buffer.from([POLICY_TAG.loadState]), stateBytes]),
  });
}

/** Verdict: publish the settlement summary [version, violation, nonce] as CPI
 *  return data. accounts: [state]. */
export function buildVerdict(
  state: PublicKey,
  policyProgram: PublicKey = POLICY_PROGRAM_ID
): TransactionInstruction {
  return new TransactionInstruction({
    programId: policyProgram,
    keys: [{ pubkey: state, isSigner: false, isWritable: false }],
    data: Buffer.from([POLICY_TAG.verdict]),
  });
}
