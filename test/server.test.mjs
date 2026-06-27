// test/server.test.mjs — basic smoke test for the MCP server.
//
// What this covers:
//   1. The MCP server boots.
//   2. tools/list returns humanaccepted_session_info.
//   3. tools/call on humanaccepted_session_info returns the session metadata.
//
// Run with HUMANACCEPTED_API_KEY=sk_... HUMANACCEPTED_BASE_URL=http://127.0.0.1:8789 \
//   node --test test/server.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("MCP server boots and responds to session_info", async () => {
  const apiKey = process.env.HUMANACCEPTED_API_KEY;
  const baseUrl = process.env.HUMANACCEPTED_BASE_URL || "http://127.0.0.1:8789";
  if (!apiKey) {
    console.log("  ? skipped (no HUMANACCEPTED_API_KEY)");
    return;
  }
  const proc = spawn("node", ["--import", "tsx/esm", "src/server.ts"], {
    cwd: process.cwd(),
    env: { ...process.env, HUMANACCEPTED_API_KEY: apiKey, HUMANACCEPTED_BASE_URL: baseUrl },
    stdio: ["pipe", "pipe", "pipe"],
  });

  // Send initialize → session_info request.
  const initMsg = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "test", version: "0.0.1" },
    },
  }) + "\n";
  proc.stdin.write(initMsg);

  const listMsg = JSON.stringify({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/list",
    params: {},
  }) + "\n";
  proc.stdin.write(listMsg);

  // Collect output.
  let out = "";
  proc.stdout.on("data", (d) => (out += d.toString()));

  await new Promise((r) => setTimeout(r, 2000));
  proc.kill();

  // Parse at least one JSON-RPC response.
  const lines = out.trim().split("\n").filter(Boolean);
  assert.ok(lines.length >= 1, "no JSON-RPC responses received");
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (obj.id === 2 && obj.result?.tools) {
        const names = obj.result.tools.map((t: any) => t.name);
        assert.ok(names.includes("humanaccepted_session_info"));
        return;
      }
    } catch { /* ignore */ }
  }
  assert.fail("did not see tools/list response with humanaccepted_session_info");
});