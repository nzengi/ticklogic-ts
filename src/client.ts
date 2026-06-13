import { Buffer } from "buffer";
import {
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import { GATE_PROGRAM_ID, SPL_TOKEN_PROGRAM_ID } from "./constants";
import {
  buildCreateMandate,
  buildSetStatus,
  buildUpdate,
  buildWithdraw,
  deriveVaultAuthority,
} from "./instructions";
import { decodeMandate, MANDATE, MandateState, ValueStateParams } from "./layout";

export interface OpenMandateResult {
  mandate: PublicKey;
  vaultAuthority: PublicKey;
  signature: string;
}

/** High-level: open a mandate in one call. `owner` is the fee payer, the
 *  mandate's owner, and the create signer (the common single-actor case, B25).
 *  Returns the mandate address and its vault authority PDA - fund a token
 *  account owned by that PDA to give the agent something to spend. */
export async function openMandate(
  connection: Connection,
  owner: Keypair,
  value: Omit<ValueStateParams, "owner">,
  opts: { freezer?: PublicKey; gateProgram?: PublicKey; policy?: PublicKey } = {}
): Promise<OpenMandateResult> {
  const gateProgram = opts.gateProgram ?? GATE_PROGRAM_ID;
  const mandateKp = Keypair.generate();
  const [vaultAuthority] = deriveVaultAuthority(mandateKp.publicKey, gateProgram);

  const rent = await connection.getMinimumBalanceForRentExemption(MANDATE.size);
  const createAcct = SystemProgram.createAccount({
    fromPubkey: owner.publicKey,
    newAccountPubkey: mandateKp.publicKey,
    lamports: rent,
    space: MANDATE.size,
    programId: gateProgram,
  });
  const createIx = buildCreateMandate(
    { mandate: mandateKp.publicKey, owner: owner.publicKey, policy: opts.policy, gateProgram },
    { ...value, owner: owner.publicKey },
    opts.freezer ?? null
  );
  const signature = await sendAndConfirmTransaction(
    connection,
    new Transaction().add(createAcct, createIx),
    [owner, mandateKp],
    { commitment: "confirmed" }
  );
  return { mandate: mandateKp.publicKey, vaultAuthority, signature };
}

export interface VaultRefs {
  vaultToken: PublicKey;
  mint: PublicKey;
  destToken: PublicKey;
}

/** A thin client bound to one mandate: read its state and run the owner-only
 *  controls (the kill-switch and the always-available withdraw, B8). */
export class MandateClient {
  constructor(
    private connection: Connection,
    public readonly mandate: PublicKey,
    private gateProgram: PublicKey = GATE_PROGRAM_ID
  ) {}

  get vaultAuthority(): PublicKey {
    return deriveVaultAuthority(this.mandate, this.gateProgram)[0];
  }

  /** Read and decode the current on-chain mandate state. */
  async fetchState(): Promise<MandateState> {
    const info = await this.connection.getAccountInfo(this.mandate);
    if (!info) throw new Error(`mandate ${this.mandate.toBase58()} not found`);
    return decodeMandate(info.data as Buffer);
  }

  /** Kill-switch: freeze the mandate (the agent can't spend; the owner still can withdraw). */
  freeze(owner: Keypair): Promise<string> {
    return this.sendOwner(owner, "freeze");
  }
  unfreeze(owner: Keypair): Promise<string> {
    return this.sendOwner(owner, "unfreeze");
  }
  /** Terminal kill-switch: revoke (irreversible). */
  revoke(owner: Keypair): Promise<string> {
    return this.sendOwner(owner, "revoke");
  }

  /** Pull tokens out of the vault. Works even when the mandate is frozen (B8). */
  withdraw(owner: Keypair, refs: VaultRefs, amount: bigint): Promise<string> {
    const ix = buildWithdraw(
      {
        mandate: this.mandate,
        owner: owner.publicKey,
        vaultToken: refs.vaultToken,
        mint: refs.mint,
        destToken: refs.destToken,
        gateProgram: this.gateProgram,
      },
      amount
    );
    return sendAndConfirmTransaction(this.connection, new Transaction().add(ix), [owner], {
      commitment: "confirmed",
    });
  }

  /** Hot-update the mandate's policy parameters (the gate applies only the
   *  mutable fields under its write-mask). Refused on a revoked mandate. */
  update(owner: Keypair, value: ValueStateParams): Promise<string> {
    const ix = buildUpdate({ mandate: this.mandate, owner: owner.publicKey, gateProgram: this.gateProgram }, value);
    return sendAndConfirmTransaction(this.connection, new Transaction().add(ix), [owner], {
      commitment: "confirmed",
    });
  }

  private sendOwner(owner: Keypair, op: "freeze" | "unfreeze" | "revoke"): Promise<string> {
    const ix = buildSetStatus(this.mandate, owner.publicKey, op, this.gateProgram);
    return sendAndConfirmTransaction(this.connection, new Transaction().add(ix), [owner], {
      commitment: "confirmed",
    });
  }
}

// re-export so callers don't need a second import for the SPL program id
export { SPL_TOKEN_PROGRAM_ID };
