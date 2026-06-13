import { Buffer } from "buffer";
import { PublicKey } from "@solana/web3.js";

// Deployed devnet program ids (DEVNET.md). The SDK targets these by default;
// override via the config objects if you redeploy.
export const POLICY_PROGRAM_ID = new PublicKey(
  "BMA1q23akKQZA1e48ivr2XZcFuoAi7KfcvGk49DSb3R4"
);
export const GATE_PROGRAM_ID = new PublicKey(
  "BczJK4WWrLgjAVXjs4Q8TYiXP6CLMBshxEG52wHkavqC"
);
export const ENGAGEMENT_PROGRAM_ID = new PublicKey(
  "CHtKdFbsd7DP5ej4QRSst7oEEM7tbBMjNSLzTBBh3iE9"
);
export const REFEREE_PROGRAM_ID = new PublicKey(
  "GCXRo5boghuzpYAGyvdbJoWsZBD4GZUBy4pKN7XaPuGv"
);
export const BPF_LOADER_UPGRADEABLE_ID = new PublicKey(
  "BPFLoaderUpgradeab1e11111111111111111111111"
);
export const SPL_TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
);

// Mandate-gate instruction tags (programs/mandate-gate/src/lib.rs).
export const GATE_TAG = {
  create: 0,
  execute: 1,
  freeze: 2,
  unfreeze: 3,
  revoke: 4,
  withdraw: 5,
  update: 6,
  freezeExternal: 7,
} as const;

// ValueState.status (crates/policy-core/src/layout.rs).
export const STATUS = {
  active: 0,
  frozen: 1,
  revoked: 2,
} as const;

// ValueState.allowed_actions bitmask.
export const ACTION_TRANSFER = 1;
export const SUPPORTED_VERSION = 1;
// ValueState.flags bitmask (bit 0): destination allowlist is bypassed when set.
export const FLAG_ALLOW_ANY_DEST = 1;

// PDA seed for the per-mandate vault authority.
export const VAULT_SEED = Buffer.from("vault");
