# @nzengi/ticklogic-sdk

**Govern an autonomous agent's on-chain spending without touching its code.**

TickLogic is a verifiable agent execution & authorization layer on Solana. This SDK wraps
your agent's value-moving path in a *mandate-aware signer*: every spend is routed through an
on-chain **gate** that enforces a policy (per-tx / daily limits, allowed destinations,
expiry, kill-switch) and holds the funds in a vault PDA — not the agent's key. If the agent
is prompt-injected, buggy, or compromised, the gate brakes the bad action. And if an
operator running the agent off-chain *lies* about what it did, the dispute layer proves it
by native replay and slashes their bond.

> *Agents act at machine speed. The chain holds the receipt — and the bond.*

This is **alpha** software, live on **devnet** only. SPL-token transfers, single-mint MVP.

---

## Install

```bash
npm i @nzengi/ticklogic-sdk@0.0.4 @solana/web3.js
```

## Quickstart — wrap your agent (the drop-in)

Your agent already moves value behind some interface. Code it against `Spender`, then inject
the governed implementation. **Your agent's own logic never changes** — that's the whole point.

```ts
import { Connection, Keypair } from "@solana/web3.js";
import { openMandate, MandateSpender, Spender, SPL_TOKEN_PROGRAM_ID } from "@nzengi/ticklogic-sdk";

const connection = new Connection("https://api.devnet.solana.com", "confirmed");
const owner = /* your Keypair (fee payer + mandate owner) */;
const agent = Keypair.generate(); // the key your agent signs with

// 1. Open a mandate: the spend envelope + a vault the gate controls.
const { mandate, vaultAuthority } = await openMandate(connection, owner, {
  agent: agent.publicKey,
  tokenProgram: SPL_TOKEN_PROGRAM_ID,
  mint,                       // the SPL mint the agent spends
  dest: allowedDestTokenAcct, // the only destination it may pay
  maxPerTx: 1_000n,
  dailyLimit: 5_000n,
  expiry: 2_000_000_000n,
});
// → fund a token account owned by `vaultAuthority` to give the agent something to spend.

// 2. Wrap the agent. This is the only line that differs from an ungoverned agent.
const spender: Spender = new MandateSpender({
  connection, feePayer: owner, agent, mandate, vaultToken, mint,
});

// 3. Your agent acts. The gate decides.
const r = await spender.spend(700n, allowedDestTokenAcct);
if (r.allowed) console.log("paid", r.signature);
else console.log("braked:", r.errorName);   // e.g. "DENIED", "NOT_ACTIVE"
```

The agent only supplies the amount; the gate builds the intent from the accounts and runs
the policy check on-chain before any tokens move. A denied spend never lands.

## Owner controls (kill-switch + custody)

The owner can always intervene — and **custody never deadlocks** (you can withdraw even
while frozen):

```ts
import { MandateClient } from "@nzengi/ticklogic-sdk";

const client = new MandateClient(connection, mandate);
await client.fetchState();                 // status, limits, spend count, ...
await client.freeze(owner);                // kill-switch: agent can't spend
await client.withdraw(owner, { vaultToken, mint, destToken }, 5_000n); // works even when frozen
```

## Runnable examples

[`examples/agent-integrations/`](examples/agent-integrations) governs real agents on
devnet with this SDK:

- **Claude tool-use** — Claude gets a `pay` tool; a legit invoice clears, a prompt-injected
  "send everything" brakes at the gate. `npm run claude`
- **MCP server** — a stdio MCP server exposing a governed `pay` tool for Claude Desktop or any
  MCP client; every payment is bounded by the mandate. `npm run mcp`

Both share one `MandateSpender` — the only TickLogic-specific line. See the example README for setup.

## What's in the box

| Surface | Exports |
|---|---|
| **Gate** (prevention) | `openMandate`, `MandateClient` (fetchState / freeze / unfreeze / revoke / withdraw / update), `MandateSpender`, `buildCreateMandate`, `buildExecute`, `buildWithdraw`, `buildSetStatus`, `buildUpdate`, `buildFreezeExternal`, `deriveVaultAuthority`, `derivePolicyProgramData` |
| **Referee** (fraud proof) | `buildRefereeInit/Checkpoint/Finalize/Challenge/Bisect/Pick/Replay/Timeout`, `decodeSession` |
| **Engagement** (bond/slash) | `buildEngagementCreate/Join/Bind/SettleCoop/Settle/Slash/ReportSlash/Cancel/Expire/Commit/Release`, `recommendedBond`, `decodeEngagement`, `deriveFreezer` |
| **Policy** (advanced) | `buildTick`, `buildLoadState`, `buildVerdict` (normally CPI'd by the referee/engagement) |
| **Layout** | `encodeValueState`, `decodeMandate`, `VALUE`/`MANDATE`/`SESSION`/`ENGAGEMENT` offset maps |
| **Errors** | `classifyGateError`/`classifyRefereeError`/`classifyEngagementError`, `GATE_ERROR`/`REFEREE_ERROR`/`ENGAGEMENT_ERROR`/`POLICY_REASON` |
| **Constants** | program ids, `STATUS`/`PHASE`/`OUTCOME`/`PARTY`/`REFEREE_STATUS`, `GATE_TAG`, `FLAG_ALLOW_ANY_DEST`, … |

Every instruction of all four deployed programs has a builder; every account type a complete
decoder; every program its error table. Layout encoders mirror the on-chain Rust byte-for-byte
(locked by `npm test`); a mandate the SDK opens is accepted on devnet, which is the proof.

## Verify it live

You don't have to take this on faith — a stable demo mandate runs on devnet and every spend
is a real, explorer-verifiable transaction. The gate enforces a per-tx limit of `1000`:

| Account | Address (devnet) |
|---|---|
| Demo mandate | `GjSNUDdAWTYR2UQFroM2PaM9BLU3hnDjdGJVeojEcHcG` |
| Allowed destination | `5BPfJ4iM3unkWUBDp8iF4pfXywmczyF62U65RnwSuWjd` |

Decode the live mandate with the SDK — an allowed spend lands while an over-limit or
wrong-destination spend is braked before any tokens move:

```ts
import { Connection, PublicKey } from "@solana/web3.js";
import { MandateClient } from "@nzengi/ticklogic-sdk";

const connection = new Connection("https://api.devnet.solana.com", "confirmed");
const client = new MandateClient(connection, new PublicKey("GjSNUDdAWTYR2UQFroM2PaM9BLU3hnDjdGJVeojEcHcG"));
console.log(await client.fetchState()); // status, limits, spend count
```

## Status & limits (honest)

- **Devnet only**, not audited, not for real funds.
- **SPL-token transfers, single mint** (MVP). Delegation/attenuation and bond-sizing ship in
  the SDK today; semantic policies (e.g. "swap ok, LP not"), multi-asset, and a fleet-wide
  shared budget are on the roadmap.
- The synchronous gate adds an on-chain roundtrip per *value move* (~0.5–1s on public devnet
  RPC). It is designed for rare, irreversible value moves — not high-frequency decisions
  (those stay off-chain and are reconciled by the fraud-proof layer). Use a dedicated RPC in
  production.

## Deployed programs (devnet)

| Program | ID |
|---|---|
| policy-program | `BMA1q23akKQZA1e48ivr2XZcFuoAi7KfcvGk49DSb3R4` |
| mandate-gate | `BczJK4WWrLgjAVXjs4Q8TYiXP6CLMBshxEG52wHkavqC` |
| engagement | `CHtKdFbsd7DP5ej4QRSst7oEEM7tbBMjNSLzTBBh3iE9` |
| referee | `GCXRo5boghuzpYAGyvdbJoWsZBD4GZUBy4pKN7XaPuGv` |

This package mirrors the on-chain Rust byte layouts; the canonical programs live in the
TickLogic monorepo. A mandate this SDK opens is accepted on devnet, which is the parity proof.
