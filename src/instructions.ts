import { Buffer } from "buffer";
import {
  PublicKey,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  BPF_LOADER_UPGRADEABLE_ID,
  GATE_PROGRAM_ID,
  GATE_TAG,
  POLICY_PROGRAM_ID,
  SPL_TOKEN_PROGRAM_ID,
  VAULT_SEED,
} from "./constants";
import { encodeValueState, MANDATE, ValueStateParams } from "./layout";

/** The per-mandate vault authority PDA: signs SPL transfers out of the vault. */
export function deriveVaultAuthority(
  mandate: PublicKey,
  gateProgram: PublicKey = GATE_PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [VAULT_SEED, mandate.toBuffer()],
    gateProgram
  );
}

/** The pinned policy's ProgramData account (BPFLoaderUpgradeable), used by the
 *  gate's U17 check at create time. */
export function derivePolicyProgramData(
  policy: PublicKey = POLICY_PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [policy.toBuffer()],
    BPF_LOADER_UPGRADEABLE_ID
  );
}

export interface CreateMandateAccounts {
  mandate: PublicKey;
  owner: PublicKey; // signer
  policy?: PublicKey;
  gateProgram?: PublicKey;
  /** U15/16 (B11): supply a parent mandate to mint a DELEGATED (child) mandate.
   *  The child must be a narrowing of the parent and `owner` must be the parent's
   *  agent (the delegator). Omit for a root mandate. */
  parentMandate?: PublicKey;
}

/** Build the mandate-gate `create` instruction.
 *  data = [tag=0][ValueState 496][freezer 32]; the gate pins the policy and
 *  verifies its upgrade authority (U17), then records the vault bump. */
export function buildCreateMandate(
  accounts: CreateMandateAccounts,
  value: ValueStateParams,
  freezer: PublicKey | null = null
): TransactionInstruction {
  const policy = accounts.policy ?? POLICY_PROGRAM_ID;
  const gateProgram = accounts.gateProgram ?? GATE_PROGRAM_ID;
  const [policyProgramData] = derivePolicyProgramData(policy);

  const data = Buffer.alloc(1 + value0Len);
  data[0] = GATE_TAG.create;
  encodeValueState(value).copy(data, 1);
  (freezer ? freezer.toBuffer() : Buffer.alloc(32)).copy(data, 1 + 496);

  const keys = [
    { pubkey: accounts.mandate, isSigner: false, isWritable: true },
    { pubkey: accounts.owner, isSigner: true, isWritable: false },
    { pubkey: policy, isSigner: false, isWritable: false },
    { pubkey: policyProgramData, isSigner: false, isWritable: false },
  ];
  if (accounts.parentMandate) {
    // delegation: the 5th account triggers the attenuation + delegator checks
    keys.push({ pubkey: accounts.parentMandate, isSigner: false, isWritable: false });
  }
  return new TransactionInstruction({ programId: gateProgram, keys, data });
}
const value0Len = 496 + 32; // ValueState ‖ freezer

export interface ExecuteAccounts {
  mandate: PublicKey;
  agent: PublicKey; // signer
  vaultToken: PublicKey;
  mint: PublicKey;
  destToken: PublicKey;
  policy?: PublicKey;
  gateProgram?: PublicKey;
}

/** Build the mandate-gate `execute` instruction. The agent supplies ONLY the
 *  amount (9-byte data, GB2); the gate builds the intent from the accounts,
 *  runs the policy GateCheck CPI, then transfers from the vault if Allowed. */
export function buildExecute(
  accounts: ExecuteAccounts,
  amount: bigint
): TransactionInstruction {
  const policy = accounts.policy ?? POLICY_PROGRAM_ID;
  const gateProgram = accounts.gateProgram ?? GATE_PROGRAM_ID;
  const [vaultAuthority] = deriveVaultAuthority(accounts.mandate, gateProgram);

  const data = Buffer.alloc(9);
  data[0] = GATE_TAG.execute;
  data.writeBigUInt64LE(amount, 1);

  return new TransactionInstruction({
    programId: gateProgram,
    keys: [
      { pubkey: accounts.mandate, isSigner: false, isWritable: true },
      { pubkey: accounts.agent, isSigner: true, isWritable: false },
      { pubkey: policy, isSigner: false, isWritable: false },
      { pubkey: vaultAuthority, isSigner: false, isWritable: false },
      { pubkey: accounts.vaultToken, isSigner: false, isWritable: true },
      { pubkey: accounts.mint, isSigner: false, isWritable: false },
      { pubkey: accounts.destToken, isSigner: false, isWritable: true },
      { pubkey: SPL_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data,
  });
}

export interface WithdrawAccounts {
  mandate: PublicKey;
  owner: PublicKey; // signer
  vaultToken: PublicKey;
  mint: PublicKey;
  destToken: PublicKey;
  gateProgram?: PublicKey;
}

/** Build the mandate-gate `withdraw` instruction: the owner pulls tokens out of
 *  the vault. It SKIPS the gate check (GB15/U12) - custody is the owner's and
 *  must work even when the mandate is frozen, so funds can never deadlock (B8).
 *  data = [tag=5][amount u64]. */
export function buildWithdraw(
  accounts: WithdrawAccounts,
  amount: bigint
): TransactionInstruction {
  const gateProgram = accounts.gateProgram ?? GATE_PROGRAM_ID;
  const [vaultAuthority] = deriveVaultAuthority(accounts.mandate, gateProgram);
  const data = Buffer.alloc(9);
  data[0] = GATE_TAG.withdraw;
  data.writeBigUInt64LE(amount, 1);
  return new TransactionInstruction({
    programId: gateProgram,
    keys: [
      { pubkey: accounts.mandate, isSigner: false, isWritable: true },
      { pubkey: accounts.owner, isSigner: true, isWritable: false },
      { pubkey: vaultAuthority, isSigner: false, isWritable: false },
      { pubkey: accounts.vaultToken, isSigner: false, isWritable: true },
      { pubkey: accounts.mint, isSigner: false, isWritable: false },
      { pubkey: accounts.destToken, isSigner: false, isWritable: true },
      { pubkey: SPL_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data,
  });
}

/** Build a status-flip instruction (freeze / unfreeze / revoke): the owner's
 *  kill-switch. accounts: [mandate(w), owner(signer)]. */
export function buildSetStatus(
  mandate: PublicKey,
  owner: PublicKey,
  op: "freeze" | "unfreeze" | "revoke",
  gateProgram: PublicKey = GATE_PROGRAM_ID
): TransactionInstruction {
  return new TransactionInstruction({
    programId: gateProgram,
    keys: [
      { pubkey: mandate, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false },
    ],
    data: Buffer.from([GATE_TAG[op]]),
  });
}

/** Hot-update a mandate's policy parameters under the gate's write-mask (GB5).
 *  The owner submits a full ValueState; only the mutable fields are applied.
 *  Refused on a revoked mandate. accounts: [mandate(w), owner(signer)]. */
export function buildUpdate(
  accounts: { mandate: PublicKey; owner: PublicKey; gateProgram?: PublicKey },
  value: ValueStateParams
): TransactionInstruction {
  return new TransactionInstruction({
    programId: accounts.gateProgram ?? GATE_PROGRAM_ID,
    keys: [
      { pubkey: accounts.mandate, isSigner: false, isWritable: true },
      { pubkey: accounts.owner, isSigner: true, isWritable: false },
    ],
    data: Buffer.concat([Buffer.from([GATE_TAG.update]), encodeValueState(value)]),
  });
}

/** Freeze a mandate via its designated external freezer (U7), without the owner.
 *  The freezer must be the exact key stored in the mandate's freezer slot —
 *  usually an engagement's freezer PDA reached by CPI (buildReportSlash), but a
 *  plain keypair freezer can call this directly. accounts: [mandate(w), freezer(signer)]. */
export function buildFreezeExternal(
  mandate: PublicKey,
  freezer: PublicKey,
  gateProgram: PublicKey = GATE_PROGRAM_ID
): TransactionInstruction {
  return new TransactionInstruction({
    programId: gateProgram,
    keys: [
      { pubkey: mandate, isSigner: false, isWritable: true },
      { pubkey: freezer, isSigner: true, isWritable: false },
    ],
    data: Buffer.from([GATE_TAG.freezeExternal]),
  });
}

export { MANDATE };
