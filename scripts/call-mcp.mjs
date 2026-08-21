#!/usr/bin/env node
/**
 * Minimal MCP HTTP caller — UTF-8 JSON only (no PowerShell).
 * Usage:
 *   node scripts/call-mcp.mjs tools/call navigate '{"url":"https://weibo.com"}'
 *   node scripts/call-mcp.mjs tools/call click_text '{"text":"写长文"}'
 */
import { readFileSync } from "node:fs";
import http from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";

function configDir() {
  return process.platform === "win32" && process.env.APPDATA
    ? join(process.env.APPDATA, "sparo")
    : join(homedir(), ".config", "sparo");
}

function loadAuth() {
  const auth = JSON.parse(
    readFileSync(join(configDir(), "mcp-auth.json"), "utf8"),
  );
  if (!auth.endpoint || !auth.token) {
    throw new Error("mcp-auth.json missing — start Sparo first");
  }
  return auth;
}

function mcpRequest(endpoint, token, method, params, id = 1) {
  return new Promise((resolve, reject) => {
    const body = Buffer.from(
      JSON.stringify({ jsonrpc: "2.0", id, method, params }),
      "utf8",
    );
    const u = new URL(endpoint);
    const req = http.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || 80,
        path: u.pathname + u.search,
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          Accept: "application/json, text/event-stream",
          Authorization: `Bearer ${token}`,
          "Content-Length": body.length,
          "MCP-Protocol-Version": "2024-11-05",
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          try {
            resolve(JSON.parse(raw));
          } catch {
            resolve(raw);
          }
        });
      },
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  const [method, nameOrArgs, maybeArgs] = process.argv.slice(2);
  if (!method) {
    console.error(`Usage:
  node scripts/call-mcp.mjs initialize
  node scripts/call-mcp.mjs tools/call <toolName> '<jsonArgs>'
Always pass Chinese inside UTF-8 JSON — do not pipe through PowerShell string literals.`);
    process.exit(2);
  }
  const auth = loadAuth();
  if (method === "initialize") {
    const r = await mcpRequest(auth.endpoint, auth.token, "initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "sparo-call-mcp", version: "0.1.0" },
    });
    console.log(JSON.stringify(r, null, 2));
    return;
  }
  if (method === "tools/call") {
    const toolName = nameOrArgs;
    const args = maybeArgs ? JSON.parse(maybeArgs) : {};
    const r = await mcpRequest(
      auth.endpoint,
      auth.token,
      "tools/call",
      { name: toolName, arguments: args },
      2,
    );
    console.log(JSON.stringify(r, null, 2));
    return;
  }
  const r = await mcpRequest(
    auth.endpoint,
    auth.token,
    method,
    nameOrArgs ? JSON.parse(nameOrArgs) : {},
  );
  console.log(JSON.stringify(r, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
