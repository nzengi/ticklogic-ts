// An MCP server that exposes a governed wallet.
//
// Any MCP client (Claude Desktop, an IDE agent) can call the `pay` tool — but
// every payment is routed through the mandate, so the on-chain gate enforces the
// per-tx / daily / destination policy and the owner keeps the kill-switch. The
// client never touches a key; it just asks to pay, and the gate decides.
//
// Run it standalone:           npm run mcp
// Or register it in Claude Desktop (claude_desktop_config.json):
//   {
//     "mcpServers": {
//       "ticklogic-wallet": {
//         "command": "npx",
//         "args": ["tsx", "/abs/path/to/examples/agent-integrations/src/mcp.ts"]
//       }
//     }
//   }
import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { PublicKey } from "@solana/web3.js";
import { z } from "zod";
import { load } from "./lib.js";

const { spender, demo } = load();

const server = new McpServer({ name: "ticklogic-wallet", version: "0.1.0" });

// what the gate will and won't allow — useful context for the model
server.tool("treasury_info", "The mandate's spending policy and approved vendor.", {}, async () => ({
  content: [
    {
      type: "text",
      text:
        `mandate ${demo.mandate}\n` +
        `per-tx limit: ${demo.perTx}\n` +
        `daily limit: ${demo.dailyLimit}\n` +
        `approved vendor (only allowed destination): ${demo.allowedDest}`,
    },
  ],
}));

// the governed action — the gate has the final say
server.tool(
  "pay",
  "Pay a vendor from the treasury. The on-chain gate enforces limits and destination.",
  { amount: z.number().int().positive(), dest: z.string() },
  async ({ amount, dest }) => {
    let destKey: PublicKey;
    try {
      destKey = new PublicKey(dest);
    } catch {
      return { content: [{ type: "text", text: `invalid destination address: ${dest}` }], isError: true };
    }

    const r = await spender.spend(BigInt(amount), destKey);
    const text = r.allowed
      ? `ALLOWED — paid ${amount}. signature: ${r.signature}`
      : `BRAKED by the gate — ${r.errorName ?? "denied"}. No tokens moved.`;
    return { content: [{ type: "text", text }], isError: !r.allowed };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdio servers log to stderr so stdout stays clean for the protocol
  console.error("ticklogic-wallet MCP server ready (stdio).");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
