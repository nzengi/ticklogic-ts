import { Buffer } from "buffer";
import { PublicKey } from "@solana/web3.js";
import { ACTION_TRANSFER, STATUS, SUPPORTED_VERSION } from "./constants";

// ===========================================================================
// Byte layouts - the EXACT mirror of crates/policy-core/src/layout.rs and
// crates/gate-core/src/layout.rs. The deployed programs read raw bytes at these
// offsets; any drift here is a silent acceptance/rejection bug. Single source of
// truth is the Rust layout (verified against clients/devnet-demo/src/main.rs).
// ===========================================================================

// --- ValueState (496 bytes): the on-chain authoritative spend envelope ---
export const VALUE = {
  schema: 0,
  status: 1,
  flags: 2, // u16 (bit 0 = FLAG_ALLOW_ANY_DEST)
  allowedActions: 4, // u32
  maxPerTx: 8, // u64
  dailyLimit: 16, // u64
  spentToday: 24, // u64 (written by the gate's apply_spend)
  windowStart: 32, // i64 (rolling-day window anchor)
  expiry: 40, // i64
  owner: 48, // [u8;32]
  agent: 80, // [u8;32]
  programs: 112, // [u8;32] (single-mint MVP: one slot)
  mints: 240, // [u8;32]
  dests: 368, // [u8;32]
  size: 496,
} as const;

// --- GateMandate (569 bytes): ValueState followed by gate bookkeeping ---
export const MANDATE = {
  policyProgram: 496, // [u8;32] - the pinned policy (GB1)
  vaultBump: 528, // u8
  spendCount: 529, // u64
  freezer: 537, // [u8;32] - designated external freezer (U7), zero = disabled
  size: 569,
} as const;

function writeU64LE(buf: Buffer, offset: number, value: bigint) {
  buf.writeBigUInt64LE(value, offset);
}

function writeI64LE(buf: Buffer, offset: number, value: bigint) {
  buf.writeBigInt64LE(value, offset);
}

export interface ValueStateParams {
  owner: PublicKey;
  agent: PublicKey;
  /** SPL token program (the only allowed program in the transfer MVP). */
  tokenProgram: PublicKey;
  mint: PublicKey;
  /** The single allowed destination token account. */
  dest: PublicKey;
  maxPerTx: bigint;
  dailyLimit: bigint;
  /** Unix seconds after which the mandate is expired. */
  expiry: bigint;
}

/** Encode a ValueState (496B) byte-identical to the Rust client's value_state(). */
export function encodeValueState(p: ValueStateParams): Buffer {
  const v = Buffer.alloc(VALUE.size);
  v[VALUE.schema] = SUPPORTED_VERSION;
  v[VALUE.status] = STATUS.active;
  v.writeUInt32LE(ACTION_TRANSFER, VALUE.allowedActions);
  writeU64LE(v, VALUE.maxPerTx, p.maxPerTx);
  writeU64LE(v, VALUE.dailyLimit, p.dailyLimit);
  writeI64LE(v, VALUE.expiry, p.expiry);
  p.owner.toBuffer().copy(v, VALUE.owner);
  p.agent.toBuffer().copy(v, VALUE.agent);
  p.tokenProgram.toBuffer().copy(v, VALUE.programs);
  p.mint.toBuffer().copy(v, VALUE.mints);
  p.dest.toBuffer().copy(v, VALUE.dests);
  return v;
}

/** A decoded view of an on-chain GateMandate account. */
export interface MandateState {
  schema: number;
  status: number;
  flags: number;
  allowedActions: number;
  allowAnyDest: boolean;
  maxPerTx: bigint;
  dailyLimit: bigint;
  spentToday: bigint;
  windowStart: bigint;
  expiry: bigint;
  owner: PublicKey;
  agent: PublicKey;
  /** First allowlist slots (single-mint MVP uses one each). */
  program: PublicKey;
  mint: PublicKey;
  dest: PublicKey;
  policyProgram: PublicKey;
  spendCount: bigint;
  freezer: PublicKey;
}

/** Decode a GateMandate account's raw data (569B) for reads/asserts. */
export function decodeMandate(data: Buffer): MandateState {
  if (data.length !== MANDATE.size) {
    throw new Error(
      `GateMandate must be ${MANDATE.size} bytes, got ${data.length}`
    );
  }
  const pk = (o: number) => new PublicKey(data.subarray(o, o + 32));
  const flags = data.readUInt16LE(VALUE.flags);
  return {
    schema: data[VALUE.schema],
    status: data[VALUE.status],
    flags,
    allowedActions: data.readUInt32LE(VALUE.allowedActions),
    allowAnyDest: (flags & 1) !== 0,
    maxPerTx: data.readBigUInt64LE(VALUE.maxPerTx),
    dailyLimit: data.readBigUInt64LE(VALUE.dailyLimit),
    spentToday: data.readBigUInt64LE(VALUE.spentToday),
    windowStart: data.readBigInt64LE(VALUE.windowStart),
    expiry: data.readBigInt64LE(VALUE.expiry),
    owner: pk(VALUE.owner),
    agent: pk(VALUE.agent),
    program: pk(VALUE.programs),
    mint: pk(VALUE.mints),
    dest: pk(VALUE.dests),
    policyProgram: pk(MANDATE.policyProgram),
    spendCount: data.readBigUInt64LE(MANDATE.spendCount),
    freezer: pk(MANDATE.freezer),
  };
}
