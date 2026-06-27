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
export {};
