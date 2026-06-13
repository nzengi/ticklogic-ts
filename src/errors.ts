// The mandate-gate's custom program error codes (crates/gate-core/src/layout.rs).
// A developer should see `DENIED` or `NOT_ACTIVE`, not a bare number.
export const GATE_ERROR: Record<number, string> = {
  0: "BAD_LENGTH",
  1: "BAD_OWNER",
  2: "NOT_SIGNER",
  3: "BAD_SCHEMA",
  4: "NOT_ACTIVE", // the mandate is frozen/revoked/expired
  5: "OWNER_MISMATCH",
  6: "OWNER_IS_AGENT",
  7: "MULTI_MINT",
  8: "ALREADY_INIT",
  9: "PIN_MISMATCH",
  10: "BAD_PROGRAM",
  11: "VAULT_MISMATCH",
  12: "DENIED", // the policy GateCheck refused this intent (over limit, bad dest, ...)
  13: "BAD_STATUS",
  14: "OVERFLOW",
  15: "WRONG_AGENT",
  16: "POLICY_UPGRADEABLE",
  17: "FREEZE_DENIED",
  18: "NOT_ATTENUATION", // delegated child isn't a narrowing of its parent (U15/16)
  19: "BAD_DELEGATOR", // delegated create not signed by the parent's agent
};

// The referee's custom error codes (programs/referee/src/lib.rs).
export const REFEREE_ERROR: Record<number, string> = {
  0: "STATUS", // instruction not valid in the current status
  1: "TURN", // not this party's move
  2: "PENDING", // an assertion is already pending
  3: "WINDOW", // challenge window still open
  4: "DEADLINE", // move arrived after the deadline
  5: "NOT_EXPIRED", // timeout called before the deadline
  6: "CLAIM", // supplied data doesn't match a committed claim
};

// The engagement's custom error codes (programs/engagement/src/lib.rs).
export const ENGAGEMENT_ERROR: Record<number, string> = {
  0: "PHASE", // instruction not valid in the current phase
  1: "SESSION", // session doesn't qualify for this engagement (GE1)
  2: "UNPROVEN", // session not finalized at the final tick
  3: "CLAIM", // supplied state doesn't hash to the proven claim
  4: "NOT_EXPIRED", // expire called before the deadline
  5: "VERDICT", // policy returned no verdict or a bad one
  6: "NOT_RESOLVED", // slash: session not resolved against the operator
  7: "ALREADY_BOUND", // bind is once-only (GE6)
  8: "POLICY_UPGRADEABLE", // U17: pinned policy mutable by a non-principal
  9: "NOT_SLASHED", // report_slash: engagement isn't slashed
  10: "BAD_FREEZER", // report_slash: wrong freeze PDA
  11: "BOND_TOO_LOW", // U13/B9: bond below the floor for declared exposure
  12: "EXPOSURE_EXCEEDED", // U13: commit would exceed max_exposure
  13: "RELEASE_TOO_MUCH", // U13: release exceeds outstanding offchain_committed
  255: "NOT_IMPLEMENTED",
};

// The policy GateCheck deny reasons (crates/policy-core/src/layout.rs). These are
// the byte the gate collapses into DENIED (12); not surfaced over a tx today, but
// exported for tooling/replay inspection.
export const POLICY_REASON: Record<number, string> = {
  0: "NONE", // Allow
  1: "BAD_VERSION",
  2: "FROZEN",
  3: "EXPIRED",
  4: "ACTION_NOT_ALLOWED",
  5: "PROGRAM_NOT_ALLOWED",
  6: "MINT_NOT_ALLOWED",
  7: "DEST_NOT_ALLOWED",
  8: "OVER_PER_TX",
  9: "OVER_DAILY",
  10: "OVERFLOW",
  11: "BAD_INTENT",
};

export interface ProgramErrorInfo {
  code: number;
  name: string;
}
/** @deprecated alias of ProgramErrorInfo (kept for back-compat). */
export type GateErrorInfo = ProgramErrorInfo;

/** Pull a program's custom error code out of a failed-transaction error.
 *  web3.js surfaces it as `{ InstructionError: [i, { Custom: code }] }`, but
 *  sendAndConfirm often stringifies, so we fall back to scraping. */
export function extractCustomCode(e: unknown): number | undefined {
  const anyE = e as any;
  const err = anyE?.transactionError ?? anyE?.err ?? anyE;
  const ie = err?.InstructionError ?? err?.instructionError;
  if (Array.isArray(ie) && ie[1] && typeof ie[1].Custom === "number") {
    return ie[1].Custom;
  }
  const msg = String(anyE?.message ?? e);
  const j = msg.match(/"Custom":\s*(\d+)/); // structured: {"Custom": 12}
  const h = msg.match(/custom program error:\s*0x([0-9a-fA-F]+)/); // preflight: 0xc
  if (j) return Number(j[1]);
  if (h) return parseInt(h[1], 16);
  return undefined;
}

function classify(e: unknown, table: Record<number, string>): ProgramErrorInfo | undefined {
  const code = extractCustomCode(e);
  if (code === undefined) return undefined;
  return { code, name: table[code] ?? `UNKNOWN(${code})` };
}

/** Classify a mandate-gate failure (e.g. { code: 12, name: "DENIED" }). */
export function classifyGateError(e: unknown): ProgramErrorInfo | undefined {
  return classify(e, GATE_ERROR);
}
/** Classify a referee (dispute) failure. */
export function classifyRefereeError(e: unknown): ProgramErrorInfo | undefined {
  return classify(e, REFEREE_ERROR);
}
/** Classify an engagement (bond) failure. */
export function classifyEngagementError(e: unknown): ProgramErrorInfo | undefined {
  return classify(e, ENGAGEMENT_ERROR);
}
