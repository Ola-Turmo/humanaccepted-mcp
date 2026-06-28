<!-- Brand: HumanAccepted · color #0E5C4A · "Signed evidence your AI did what you said." -->

# humanaccepted-mcp

**MCP server that emits signed, EU AI Act Article 12-compliant receipts on every AI tool call.**

Drop-in [Model Context Protocol](https://modelcontextprotocol.io) server. Every `tools/call` your agent makes — through Claude Desktop, Cursor, or any MCP-compatible host — is wrapped and emitted as a signed `tool_call` receipt into the [HumanAccepted](https://github.com/Ola-Turmo/humanaccepted) registry, chained to the previous receipt in the session, and verifiable offline against the public Python / TypeScript reference verifiers.

A single line of MCP config, no code changes, no host rewrites.

---

## What it does

1. **Sits in front of your agent's tool layer** as a passthrough MCP server.
2. **Wraps every `tools/call`** in a `before → after` pair of signed receipts:
   - **Start receipt** (`kind: "tool_call"`, `duration_ms: 0`) — captures intent + inputs.
   - **End receipt** — captures output + duration + `ok | error | timeout | denied` result.
3. **Chains both** via `chain.prev` so an auditor can replay the full session in order.
4. **Generates a stable `run_id`** per MCP session for end-to-end traceability.

All receipts are signed with the tenant's Ed25519 key inside the HumanAccepted Worker. The MCP server itself holds no private key material — it authenticates with `Bearer sk_...` and the Worker does the signing.

---

## Quick start

```bash
# 1. Get an API key (one-time, returns a tenant + sk_…)
curl -X POST https://humanaccepted.ola-turmo.workers.dev/v1/bootstrap

# 2. Run the MCP server (npx pulls it from npm; no local install needed)
HUMANACCEPTED_API_KEY=sk_... \
  npx -y @humanaccepted/mcp
```

To use it in **Claude Desktop** or **Cursor**, add this to your MCP config:

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

The server connects on stdio, prints `[humanaccepted-mcp] Connected to …` to stderr, and from that point every tool call your agent makes is recorded.

---

## Configuration

| Env var | Required | Default | Purpose |
|---|---|---|---|
| `HUMANACCEPTED_API_KEY` | yes | — | Tenant `sk_…` from `POST /v1/bootstrap` |
| `HUMANACCEPTED_BASE_URL` | no | `https://humanaccepted.ola-turmo.workers.dev` | Override for staging / local Worker |
| `HUMANACCEPTED_AGENT_ID` | no | `mcp_agent` | Stable id across the session (good for dashboards) |
| `HUMANACCEPTED_AGENT_TYPE` | no | `mcp` | e.g. `claude-sonnet-4.6`, `openai:gpt-5.5`, `cursor-2.0` |

---

## What it exposes

This MCP server exposes **one** meta-tool:

- **`humanaccepted_session_info`** — returns the current session's `run_id`, last receipt id, base URL, agent id, and tenant key fingerprint. Useful for debugging and for letting downstream code correlate receipts to a session.

All **other** `tools/call` requests are passed through but wrapped: the upstream tool still runs as normal, and a `tool_call` receipt pair is emitted to HumanAccepted for each invocation.

---

## Receipt shape

Receipts follow [HumanAccepted spec v1.1](https://github.com/Ola-Turmo/humanaccepted-spec) (`kind: "tool_call"` was added in v1.1). A minimal example of the `before` half:

```json
{
  "kind": "tool_call",
  "version": 2,
  "tenant": "ten_3K9F2X",
  "id": "rcp_4PZ8QJ2M1X9Y7K0ABCDEF1234",
  "issued_at": "2026-06-28T09:53:11.421Z",
  "agent": {
    "id": "my_agent",
    "type": "claude-sonnet-4.6",
    "run_id": "run_01HF3R8K2Q5P9X7Z4M6V0YJWBN"
  },
  "tool": {
    "name": "get_weather",
    "version": "1.0.0",
    "input": { "city": "Oslo" },
    "output": null,
    "duration_ms": 0,
    "result": "ok"
  },
  "chain": { "prev": null, "run_id": "run_01HF3R8K2Q5P9X7Z4M6V0YJWBN" },
  "canonical": "ha:v1:tool_call:ten_3K9F2X:rcp_4PZ…:{…sorted-utf8-json…}",
  "signature": {
    "alg": "ed25519",
    "key_id": "k_8N4Q",
    "value": "7c3f…(ed25519 sig over canonical)"
  }
}
```

The `after` half repeats the same envelope with `duration_ms > 0`, the actual `output`, and `chain.prev = rcp_4PZ…` (the start receipt's id).

Verify offline:

```bash
# Python
python3 -m verifier.python.verify --receipt rcp_4PZ... --pubkey <tenant-ed25519-pub>

# TypeScript
npx @humanaccepted/verify --receipt rcp_4PZ... --pubkey <tenant-ed25519-pub>
```

---

## EU AI Act Article 12

Article 12 of the [EU AI Act](https://artificialintelligenceact.eu/article/12/) requires providers of high-risk AI systems to keep **automatic, tamper-evident logs** of every interaction over the system lifecycle. The deadline is **2 August 2026** — 35 days from today (2026-06-28).

HumanAccepted is the open primitive for Article 12. The MCP server here is the **drop-in layer**: any MCP-compatible agent — Claude Desktop, Cursor, Claude Code, your custom host — gets Article 12 logging with one block of MCP config and zero changes to the agent code.

After running your agent for any length of time, fetch the full session's receipts:

```bash
curl https://humanaccepted.ola-turmo.workers.dev/v1/article12-export \
  -H "Authorization: Bearer $HUMANACCEPTED_API_KEY" \
  | jq '.counts, (.receipts | length)'
```

Or replay one session:

```bash
curl https://humanaccepted.ola-turmo.workers.dev/v1/runs/$RUN_ID \
  -H "Authorization: Bearer $HUMANACCEPTED_API_KEY" \
  | jq '.chain_valid, .count'
```

---

## Local development

The repo ships TypeScript source in `src/` (entry: `src/server.ts`) and a built `dist/` for `npx`.

```bash
git clone https://github.com/Ola-Turmo/humanaccepted-mcp
cd humanaccepted-mcp

# Workaround for openclaw-user npm issues on shared VPS:
npm install --prefix /tmp/mcp-dev --cache /tmp/mcp-dev/.npm-cache
NODE_PATH=/tmp/mcp-dev/node_modules node --import tsx src/server.ts
```

Or build:

```bash
npm run build && npm start
```

Tests:

```bash
HUMANACCEPTED_API_KEY=sk_... \
  HUMANACCEPTED_BASE_URL=http://127.0.0.1:8789 \
  npm test
```

---

## Repo layout

| Path | Purpose |
|---|---|
| `src/server.ts` | MCP server implementation — wraps `tools/call`, emits receipts |
| `src/cli.ts` | Thin entrypoint (`#!/usr/bin/env node`) |
| `dist/` | Built JS for `npx` + `bin: humanaccepted-mcp` |
| `test/server.test.mjs` | Boot + `tools/list` smoke test |
| `package.json` | `@humanaccepted/mcp` v0.1.0, Apache-2.0 |
| `tsconfig.json` | ES2022, strict, outDir `dist/` |

---

## Related projects

| Project | What it is |
|---|---|
| [Ola-Turmo/humanaccepted-spec](https://github.com/Ola-Turmo/humanaccepted-spec) | Open spec v1.1 — receipt shapes, canonical form, verifiers in 5 languages |
| [Ola-Turmo/humanaccepted](https://github.com/Ola-Turmo/humanaccepted) | Host product — Worker + Pages app (PR #6 ships v0.3 with these receipt kinds) |
| Live Worker | `https://humanaccepted.ola-turmo.workers.dev/` — the registry this server writes to |
| Live host product | `https://humanaccepted-new.pages.dev/` — dashboard + docs UI |
| Landing page (this repo) | `site/index.html` — single-file CF Pages marketing page |

---

## License

Apache-2.0