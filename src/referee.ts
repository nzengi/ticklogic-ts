import { Buffer } from "buffer";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { REFEREE_PROGRAM_ID } from "./constants";

// ===========================================================================
// Referee Session layout + instruction builders - the EXACT mirror of
// programs/referee/src/lib.rs (verified against clients/devnet-demo).
// ===========================================================================

export const SESSION_LEN = 344;
/** The replay scratch account (policy-owned) the disputed tick runs against. */
export const POLICY_STATE_SIZE = 544;

export const SESSION = {
  status: 0,
  winner: 1,
  turn: 2,
  operator: 8,
  challenger: 40,
  gameProgram: 72,
  bond: 104, // u64
  postedSlot: 112, // u64
  deadline: 120, // u64
  loTick: 128, // u64
  loClaim: 136, // [u8;64]
  hiTick: 200, // u64
  hiClaim: 208, // [u8;64]
  midTick: 272, // u64
  midClaim: 280, // [u8;64]
} as const;

export const REFEREE_STATUS = {
  idle: 0,
  bisecting: 1,
  awaitingReplay: 2,
  resolved: 3,
} as const;

export const PARTY = { none: 0, operator: 1, challenger: 2 } as const;

const REF_TAG = {
  init: 0,
  checkpoint: 1,
  finalize: 2,
  challenge: 3,
  bisect: 4,
  pick: 5,
  replay: 6,
  timeout: 7,
} as const;

export interface SessionState {
  status: number;
  winner: number;
  turn: number;
  operator: PublicKey;
  challenger: PublicKey;
  gameProgram: PublicKey;
  bond: bigint;
  loTick: bigint;
  loClaim: Buffer;
  hiTick: bigint;
  hiClaim: Buffer;
  midTick: bigint;
  midClaim: Buffer;
  postedSlot: bigint;
  deadline: bigint;
}

export function decodeSession(data: Buffer): SessionState {
  if (data.length !== SESSION_LEN) {
    throw new Error(`Session must be ${SESSION_LEN} bytes, got ${data.length}`);
  }
  const claim = (o: number) => Buffer.from(data.subarray(o, o + 64));
  const pk = (o: number) => new PublicKey(data.subarray(o, o + 32));
  return {
    status: data[SESSION.status],
    winner: data[SESSION.winner],
    turn: data[SESSION.turn],
    operator: pk(SESSION.operator),
    challenger: pk(SESSION.challenger),
    gameProgram: pk(SESSION.gameProgram),
    bond: data.readBigUInt64LE(SESSION.bond),
    loTick: data.readBigUInt64LE(SESSION.loTick),
    loClaim: claim(SESSION.loClaim),
    hiTick: data.readBigUInt64LE(SESSION.hiTick),
    hiClaim: claim(SESSION.hiClaim),
    midTick: data.readBigUInt64LE(SESSION.midTick),
    midClaim: claim(SESSION.midClaim),
    postedSlot: data.readBigUInt64LE(SESSION.postedSlot),
    deadline: data.readBigUInt64LE(SESSION.deadline),
  };
}

const ref = (pid?: PublicKey) => pid ?? REFEREE_PROGRAM_ID;

/** init: operator opens the session, committing the genesis claim and the bond. */
export function buildRefereeInit(
  session: PublicKey,
  operator: PublicKey,
  gameProgram: PublicKey,
  bond: bigint,
  genesisClaim: Buffer,
  refereeProgram?: PublicKey
): TransactionInstruction {
  const data = Buffer.concat([Buffer.from([REF_TAG.init]), u64(bond), claim64(genesisClaim)]);
  return new TransactionInstruction({
    programId: ref(refereeProgram),
    keys: [
      w(session),
      s(operator),
      r(gameProgram),
    ],
    data,
  });
}

/** checkpoint: operator asserts a claim at `tick`. */
export function buildCheckpoint(
  session: PublicKey,
  operator: PublicKey,
  tick: bigint,
  claimBuf: Buffer,
  refereeProgram?: PublicKey
): TransactionInstruction {
  const data = Buffer.concat([Buffer.from([REF_TAG.checkpoint]), u64(tick), claim64(claimBuf)]);
  return new TransactionInstruction({
    programId: ref(refereeProgram),
    keys: [w(session), s(operator)],
    data,
  });
}

/** finalize: an unchallenged assertion past the window becomes the proven claim. */
export function buildFinalize(
  session: PublicKey,
  refereeProgram?: PublicKey
): TransactionInstruction {
  return new TransactionInstruction({
    programId: ref(refereeProgram),
    keys: [w(session)],
    data: Buffer.from([REF_TAG.finalize]),
  });
}

/** challenge: challenger posts bond and opens the dispute. */
export function buildChallenge(
  session: PublicKey,
  challenger: PublicKey,
  refereeProgram?: PublicKey
): TransactionInstruction {
  return new TransactionInstruction({
    programId: ref(refereeProgram),
    keys: [w(session), s(challenger)],
    data: Buffer.from([REF_TAG.challenge]),
  });
}

/** bisect: operator asserts the claim at the current midpoint. */
export function buildBisect(
  session: PublicKey,
  operator: PublicKey,
  claimBuf: Buffer,
  refereeProgram?: PublicKey
): TransactionInstruction {
  const data = Buffer.concat([Buffer.from([REF_TAG.bisect]), claim64(claimBuf)]);
  return new TransactionInstruction({
    programId: ref(refereeProgram),
    keys: [w(session), s(operator)],
    data,
  });
}

/** pick: challenger agrees (1) or disagrees (0) with the midpoint claim. */
export function buildPick(
  session: PublicKey,
  challenger: PublicKey,
  agree: boolean,
  refereeProgram?: PublicKey
): TransactionInstruction {
  return new TransactionInstruction({
    programId: ref(refereeProgram),
    keys: [w(session), s(challenger)],
    data: Buffer.from([REF_TAG.pick, agree ? 1 : 0]),
  });
}

/** replay: the native one-step proof. data = [tag, inputs_len u32, inputs, pre_state].
 *  accounts: session(w), scratch(w,signer,policy-owned), game program, operator(w), challenger(w). */
export function buildReplay(
  session: PublicKey,
  scratch: PublicKey,
  gameProgram: PublicKey,
  operator: PublicKey,
  challenger: PublicKey,
  inputs: Buffer,
  preState: Buffer,
  refereeProgram?: PublicKey
): TransactionInstruction {
  const len = Buffer.alloc(4);
  len.writeUInt32LE(inputs.length, 0);
  const data = Buffer.concat([Buffer.from([REF_TAG.replay]), len, inputs, preState]);
  return new TransactionInstruction({
    programId: ref(refereeProgram),
    keys: [
      w(session),
      { pubkey: scratch, isSigner: true, isWritable: true },
      r(gameProgram),
      w(operator),
      w(challenger),
    ],
    data,
  });
}

/** timeout: the party who failed to move in time loses (in awaiting-replay, the
 *  operator carries the burden). Permissionless after the deadline. The winner
 *  takes both bonds. accounts: session(w), operator(w), challenger(w). */
export function buildTimeout(
  session: PublicKey,
  operator: PublicKey,
  challenger: PublicKey,
  refereeProgram?: PublicKey
): TransactionInstruction {
  return new TransactionInstruction({
    programId: ref(refereeProgram),
    keys: [w(session), w(operator), w(challenger)],
    data: Buffer.from([REF_TAG.timeout]),
  });
}

// account-meta + encoding helpers
const w = (pubkey: PublicKey) => ({ pubkey, isSigner: false, isWritable: true });
const r = (pubkey: PublicKey) => ({ pubkey, isSigner: false, isWritable: false });
const s = (pubkey: PublicKey) => ({ pubkey, isSigner: true, isWritable: false });
function u64(v: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(v, 0);
  return b;
}
function claim64(c: Buffer): Buffer {
  if (c.length !== 64) throw new Error(`claim must be 64 bytes, got ${c.length}`);
  return c;
}
