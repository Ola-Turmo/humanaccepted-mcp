# @humanaccepted/mcp

MCP (Model Context Protocol) server that **auto-emits tamper-evident receipts for every tool call** an MCP-compatible agent makes.

This is the **EU AI Act Article 12** primitive: every tool invocation the agent performs is recorded as a signed receipt, content-addressed and offline-verifiable against the v1.1 spec.

## What it does

1. Sits in front of your agent's tool calls (Claude Desktop, Cursor, etc.)
2. Wraps every `tools/call` request:
   - **Before:** posts a `tool_call` receipt capturing the agent's intent + inputs
   - **After:** posts another receipt capturing the result + duration + ok/error
3. Links both receipts via `chain.prev` so an auditor can replay the full chain
4. Generates a stable `run_id` per session for traceability

All receipts are signed by your tenant's Ed25519 key in the HumanAccepted Worker. You can fetch them at any time:

```bash
curl https://humanaccepted.ola-turmo.workers.dev/v1/runs/run_ABC... \
  -H "Authorization: Bearer sk_..."
```

## Install + run

### npx

```bash
HUMANACCEPTED_API_KEY=sk_... npx -y @humanaccepted/mcp
```

### Claude Desktop / Cursor

Add to your MCP config:

```json
{
  "mcpServers": {
    "humanaccepted": {
      "command": "npx",
      "args": ["-y", "@humanaccepted/mcp"],
      "env": {
        "HUMANACCEPTED_API_KEY": "sk_...",
        "HUMANACCEPTED_AGENT_ID": "my_agent",
        "HUMANACCEPTED_AGENT_TYPE": "claude-sonnet-4.6"
      }
    }
  }
}
```

## Configuration (env vars)

| Var | Required | Default | Description |
|---|---|---|---|
| `HUMANACCEPTED_API_KEY` | yes | — | Your tenant's `sk_...` API key (from `POST /bootstrap`) |
| `HUMANACCEPTED_BASE_URL` | no | `https://humanaccepted.ola-turmo.workers.dev` | Override for local dev or staging |
| `HUMANACCEPTED_AGENT_ID` | no | `mcp_agent` | Stable agent id across the session |
| `HUMANACCEPTED_AGENT_TYPE` | no | `mcp` | e.g. `claude-sonnet-4.6`, `openai:gpt-5.5` |

## Tools exposed

This MCP server exposes ONE tool:

- **`humanaccepted_session_info`** — returns the current session's `run_id`, last receipt id, and base URL.

All other tool calls are instrumented: the upstream tool still runs as normal, but every call records a signed receipt.

## Article 12 evidence

After running your agent for any length of time, fetch the full session's receipts:

```bash
curl https://humanaccepted.ola-turmo.workers.dev/v1/article12-export \
  -H "Authorization: Bearer $HUMANACCEPTED_API_KEY" \
  | jq '.counts, .receipts | length'
```

Or replay a single session:

```bash
curl https://humanaccepted.ola-turmo.workers.dev/v1/runs/$RUN_ID \
  -H "Authorization: Bearer $HUMANACCEPTED_API_KEY" \
  | jq '.chain_valid, .count'
```

## License

Apache-2.0

## See also

- [HumanAccepted spec v1.1](https://github.com/Ola-Turmo/humanaccepted-spec/tree/spec/v1.1-tool-call-receipts)
- [HumanAccepted host](https://github.com/Ola-Turmo/humanaccepted/tree/feature/v0.3-tool-call-receipts)
- [EU AI Act Article 12](https://artificialintelligenceact.eu/article/12/)