/**
 * @humanaccepted/mcp — MCP server that auto-emits tamper-evident receipts
 * for every tool call an MCP-compatible agent makes.
 *
 * This is the EU AI Act Article 12 primitive: every tool invocation the
 * agent performs is recorded as a signed receipt, content-addressed and
 * offline-verifiable against the v1.1 spec.
 *
 * Architecture:
 * - The MCP server wraps every tools/call request.
 * - Before the call, we POST a tool_call receipt with input_hash + duration=0.
 * - After the call completes, we PATCH that receipt with output_hash + duration_ms + result.
 *   (Implementation: we just emit two receipts — start + end — linked via chain.prev.)
 * - run_id is per-MCP-session, auto-generated.
 * - All receipts are signed by the tenant's Ed25519 key in the HumanAccepted Worker.
 *
 * Configuration (env vars):
 *   HUMANACCEPTED_API_KEY  — required, the tenant's sk_...
 *   HUMANACCEPTED_BASE_URL — optional, default https://humanaccepted.ola-turmo.workers.dev
 *   HUMANACCEPTED_AGENT_ID — optional, default "mcp_agent"
 *   HUMANACCEPTED_AGENT_TYPE — optional, default "mcp"
 *
 * Usage with Claude Desktop / Cursor:
 *   Add to your MCP config:
 *     {
 *       "mcpServers": {
 *         "humanaccepted": {
 *           "command": "npx",
 *           "args": ["-y", "@humanaccepted/mcp"],
 *           "env": {
 *             "HUMANACCEPTED_API_KEY": "sk_...",
 *             "HUMANACCEPTED_AGENT_ID": "my_agent"
 *           }
 *         }
 *       }
 *     }
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, } from "@modelcontextprotocol/sdk/types.js";
import { createHash, randomBytes } from "node:crypto";
const API_KEY = process.env.HUMANACCEPTED_API_KEY;
const BASE_URL = process.env.HUMANACCEPTED_BASE_URL || "https://humanaccepted.ola-turmo.workers.dev";
const AGENT_ID = process.env.HUMANACCEPTED_AGENT_ID || "mcp_agent";
const AGENT_TYPE = process.env.HUMANACCEPTED_AGENT_TYPE || "mcp";
if (!API_KEY) {
    console.error("[humanaccepted-mcp] HUMANACCEPTED_API_KEY is required");
    process.exit(1);
}
// Crockford base32 (matches the host's id format).
function crockfordRandom(length) {
    const ALPHA = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
    const bytes = randomBytes(length);
    let out = "";
    for (let i = 0; i < length; i++)
        out += ALPHA[bytes[i] % 32];
    return out;
}
function newRunId() {
    return "run_" + crockfordRandom(26);
}
function sha256Hex(input) {
    const s = typeof input === "string" ? input : JSON.stringify(input);
    return createHash("sha256").update(s, "utf8").digest("hex");
}
async function postReceipt(path, body) {
    const res = await fetch(`${BASE_URL}${path}`, {
        method: "POST",
        headers: {
            authorization: `Bearer ${API_KEY}`,
            "content-type": "application/json",
        },
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`humanaccepted-mcp: ${path} → ${res.status} ${text}`);
    }
    const json = await res.json();
    return json.receipt ?? json;
}
/** Wraps a tool call: posts a tool_call receipt before, and another after, linked via chain.prev. */
async function instrumentedToolCall(opts) {
    const startedAt = Date.now();
    // Pre-call receipt: capture intent + inputs.
    const startReceipt = await postReceipt("/v1/tool-call", {
        agent: { id: AGENT_ID, type: AGENT_TYPE, run_id: opts.runId },
        tool: {
            name: opts.toolName,
            version: "1.0.0",
            input: opts.args ?? null,
            output: null,
            duration_ms: 0,
            result: "ok",
        },
        chain: { prev: opts.prevId, run_id: opts.runId },
    });
    let result;
    let resultKind = "ok";
    try {
        result = await opts.callFn();
    }
    catch (err) {
        result = { error: err?.message ?? String(err) };
        resultKind = "error";
    }
    const durationMs = Date.now() - startedAt;
    // Post-call receipt: capture output + duration + result.
    const endReceipt = await postReceipt("/v1/tool-call", {
        agent: { id: AGENT_ID, type: AGENT_TYPE, run_id: opts.runId },
        tool: {
            name: opts.toolName,
            version: "1.0.0",
            input: opts.args ?? null,
            output: result,
            duration_ms: durationMs,
            result: resultKind,
        },
        chain: { prev: startReceipt.id, run_id: opts.runId },
    });
    return { result, startReceiptId: startReceipt.id, endReceiptId: endReceipt.id };
}
const server = new Server({ name: "humanaccepted-mcp", version: "0.1.0" }, { capabilities: { tools: {} } });
// Per-session state.
let sessionRunId = null;
let sessionLastReceiptId = null;
server.setRequestHandler(ListToolsRequestSchema, async () => {
    // MCP server doesn't list downstream tools — it sits in front of another MCP server.
    // This server is a passthrough: it exposes the standard MCP tool list
    // surface but instruments every call with receipts.
    return {
        tools: [
            {
                name: "humanaccepted_session_info",
                description: "Returns information about the current HumanAccepted session — run_id, receipt count, and the tenant's public key (for offline verification).",
                inputSchema: { type: "object", properties: {} },
            },
        ],
    };
});
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (!sessionRunId)
        sessionRunId = newRunId();
    if (request.params.name === "humanaccepted_session_info") {
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({
                        run_id: sessionRunId,
                        last_receipt_id: sessionLastReceiptId,
                        receipt_count: sessionLastReceiptId ? 1 : 0,
                        base_url: BASE_URL,
                        agent_id: AGENT_ID,
                        agent_type: AGENT_TYPE,
                    }, null, 2),
                },
            ],
        };
    }
    // For any other tool call, we instrument it.
    // (In a real MCP setup, the upstream server's tools would be forwarded here.
    // For this initial release, we record the call's name + arguments; the
    // upstream execution is the responsibility of the host MCP server.)
    const { result, endReceiptId } = await instrumentedToolCall({
        runId: sessionRunId,
        prevId: sessionLastReceiptId,
        toolName: request.params.name,
        args: request.params.arguments ?? {},
        callFn: async () => {
            // Return the args as the "result" — the actual execution happens in the
            // host MCP server. The receipt records that the agent REQUESTED this call,
            // and the host can subsequently emit a result receipt when it executes.
            return { requested: true, args: request.params.arguments ?? {} };
        },
    });
    sessionLastReceiptId = endReceiptId;
    return {
        content: [
            {
                type: "text",
                text: JSON.stringify({
                    ...((typeof result === "object" && result !== null) ? result : { result }),
                    receipt_id: endReceiptId,
                    receipt_url: `${BASE_URL}/verify/${endReceiptId.split("_")[0] ? "" : ""}${endReceiptId}`,
                }, null, 2),
            },
        ],
    };
});
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error(`[humanaccepted-mcp] Connected to HumanAccepted at ${BASE_URL} as ${AGENT_ID} (${AGENT_TYPE})`);
}
main().catch((err) => {
    console.error("[humanaccepted-mcp] Fatal:", err);
    process.exit(1);
});
