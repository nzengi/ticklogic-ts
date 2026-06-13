import {
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
  Transaction,
} from "@solana/web3.js";
import { buildExecute } from "./instructions";
import { classifyGateError } from "./errors";

// `performance` is a global in both browsers and Node 16+; avoid importing
// Node's `perf_hooks` so the SDK bundles for the browser without a shim.
const clock: { now(): number } = (globalThis as { performance?: { now(): number } }).performance ?? {
  now: () => Date.now(),
};

/** The result of one governed value-move attempt. `allowed` is the gate's
 *  verdict: true = tokens moved, false = the gate braked it (e.g. over limit,
 *  frozen, wrong destination). Latency is the synchronous on-chain roundtrip. */
export interface SpendResult {
  allowed: boolean;
  signature?: string;
  /** Gate custom error code if the failure was a program error (12 = DENIED). */
  errorCode?: number;
  /** Human-readable gate error name (e.g. "DENIED", "NOT_ACTIVE"). */
  errorName?: string;
  error?: string;
  latencyMs: number;
}

/** The interface the agent codes against. Swapping the implementation (raw vs
 *  mandate-governed) is the ONLY change to govern an agent (D1) - the agent's
 *  own logic never references the gate. */
export interface Spender {
  spend(amount: bigint, destToken: PublicKey): Promise<SpendResult>;
}

export interface MandateSpenderConfig {
  connection: Connection;
  /** Pays transaction fees (in the demo, the owner/principal). */
  feePayer: Keypair;
  /** The agent's key - the mandate's authorized agent; signs every execute. */
  agent: Keypair;
  mandate: PublicKey;
  vaultToken: PublicKey;
  mint: PublicKey;
  policy?: PublicKey;
  gateProgram?: PublicKey;
}

/** The mandate-aware signer shim. The agent calls `spend(amount, dest)` exactly
 *  as it would a raw transfer; under the hood every move is routed through the
 *  mandate-gate's `execute` - the policy GateCheck decides, and the vault PDA
 *  (not the agent) holds custody. The agent supplies only the amount; the gate
 *  builds the intent from the accounts (GB2). This is the drop-in claim. */
export class MandateSpender implements Spender {
  constructor(private cfg: MandateSpenderConfig) {}

  async spend(amount: bigint, destToken: PublicKey): Promise<SpendResult> {
    const ix = buildExecute(
      {
        mandate: this.cfg.mandate,
        agent: this.cfg.agent.publicKey,
        vaultToken: this.cfg.vaultToken,
        mint: this.cfg.mint,
        destToken,
        policy: this.cfg.policy,
        gateProgram: this.cfg.gateProgram,
      },
      amount
    );
    const tx = new Transaction().add(ix);
    const t0 = clock.now();
    try {
      const signature = await sendAndConfirmTransaction(
        this.cfg.connection,
        tx,
        [this.cfg.feePayer, this.cfg.agent],
        { commitment: "confirmed" }
      );
      return { allowed: true, signature, latencyMs: clock.now() - t0 };
    } catch (e: any) {
      const info = classifyGateError(e);
      return {
        allowed: false,
        errorCode: info?.code,
        errorName: info?.name,
        error: String(e?.message ?? e),
        latencyMs: clock.now() - t0,
      };
    }
  }
}
