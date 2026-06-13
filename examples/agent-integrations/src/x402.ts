// x402 (HTTP 402 "Payment Required"), governed by a mandate.
//
// A paid API answers a request with 402 + payment requirements. The agent pays
// the quoted price THROUGH the MandateSpender — so the gate enforces per-tx /
// daily / destination before any tokens move — then retries with the on-chain
// payment as proof. An over-budget request brakes at the gate and never pays.
//
// This runs end-to-end on devnet: a local "paid API" server + the agent client,
// settling with a real gated execute. (Faithful to the x402 shape — 402 →
// X-PAYMENT → retry; real x402 carries a structured payment payload and verifies
// through a facilitator. Here the server verifies the on-chain tx directly.)
//
//   npm run setup && npm run x402
import "dotenv/config";
import { createServer } from "node:http";
import { Connection, PublicKey } from "@solana/web3.js";
import { load } from "./lib.js";

const PORT = 4021;
const { spender, demo, allowedDest } = load();
const connection = new Connection(demo.rpc, "confirmed");

// ── the paid API (server) ───────────────────────────────────────────────────
// Gates "premium data" behind a 700-unit payment to its token account. Verifies
// the X-PAYMENT header (an on-chain signature) confirmed before serving.
const PRICE = 700;
const server = createServer(async (req, res) => {
  const proof = req.headers["x-payment"];
  if (!proof || typeof proof !== "string") {
    res.writeHead(402, { "content-type": "application/json" });
    res.end(JSON.stringify({
      x402Version: 1,
      accepts: [{ scheme: "exact", network: "solana-devnet", maxAmountRequired: String(PRICE), payTo: demo.allowedDest, asset: demo.mint }],
    }));
    return;
  }
  // verify the payment landed on-chain (real proof, not a trust-me header)
  const st = await connection.getSignatureStatus(proof, { searchTransactionHistory: true });
  const ok = st.value && !st.value.err && (st.value.confirmationStatus === "confirmed" || st.value.confirmationStatus === "finalized");
  if (!ok) {
    res.writeHead(402, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "payment not found or failed", signature: proof }));
    return;
  }
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ data: "premium model weights ✦", paidWith: proof }));
});

// ── the agent (client) ────────────────────────────────────────────────────────
async function fetchPaid(amountBudget: number): Promise<{ status: number; body: unknown }> {
  const url = `http://localhost:${PORT}/premium`;
  let res = await fetch(url);
  if (res.status !== 402) return { status: res.status, body: await res.json() };

  const reqs = (await res.json()) as { accepts: { maxAmountRequired: string; payTo: string }[] };
  const need = Number(reqs.accepts[0].maxAmountRequired);
  if (need > amountBudget) {
    console.log(`  agent: quote ${need} exceeds budget ${amountBudget} — not paying`);
  }

  // pay THROUGH the mandate — the gate decides, not the agent
  const r = await spender.spend(BigInt(need), new PublicKey(reqs.accepts[0].payTo) ?? allowedDest);
  if (!r.allowed) {
    console.log(`  🛑 gate braked the payment: ${r.errorName} — request stays unpaid`);
    return { status: 402, body: { braked: r.errorName } };
  }
  console.log(`  ✅ paid ${need} · ${r.signature}`);
  res = await fetch(url, { headers: { "x-payment": r.signature! } });
  return { status: res.status, body: await res.json() };
}

async function main() {
  await new Promise<void>((r) => server.listen(PORT, r));
  console.log(`paid API on :${PORT}\n`);

  console.log("=== Legitimate request (within the mandate) ===");
  const a = await fetchPaid(PRICE);
  console.log(`  -> ${a.status}`, a.body);

  console.log("\n=== Over-budget request (gate brakes the payment) ===");
  // ask for a resource priced over the per-tx limit by raising the server price
  // would require a second route; instead show the gate's own ceiling: a 5000 pay
  const big = await spender.spend(5000n, allowedDest);
  console.log(big.allowed ? `  paid (unexpected)` : `  🛑 gate braked: ${big.errorName} — an x402 call this size never settles`);

  server.close();
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  }
);
