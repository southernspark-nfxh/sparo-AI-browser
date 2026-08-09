#!/usr/bin/env node
/**
 * Stdio → HTTP proxy for Sparo MCP.
 * OpenClaw / Claude Desktop can point here while Sparo runs as a GUI app.
 */
import { createInterface } from "node:readline";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function loadAuth() {
  const configDir =
    process.env.SPARO_CONFIG_DIR ||
    process.env.SPARK_CONFIG_DIR ||
    (process.platform === "win32" && process.env.APPDATA
      ? join(process.env.APPDATA, "sparo")
      : join(homedir(), ".config", "sparo"));
  const auth = JSON.parse(readFileSync(join(configDir, "mcp-auth.json"), "utf8"));
  if (!auth.endpoint || !auth.token) {
    throw new Error("mcp-auth.json missing endpoint/token — start Sparo first");
  }
  return auth;
}

const auth = loadAuth();

async function postRpc(body) {
  const res = await fetch(auth.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${auth.token}`,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`MCP HTTP ${res.status}: ${text}`);
  }
  // Streamable HTTP may return SSE; extract last JSON data line if needed.
  if (text.startsWith("event:") || text.includes("data:")) {
    const dataLines = text
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .filter(Boolean);
    const last = dataLines.at(-1);
    return last ? JSON.parse(last) : {};
  }
  return JSON.parse(text);
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

rl.on("line", async (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  try {
    const msg = JSON.parse(trimmed);
    const result = await postRpc(msg);
    process.stdout.write(JSON.stringify(result) + "\n");
  } catch (error) {
    const id = (() => {
      try {
        return JSON.parse(trimmed).id ?? null;
      } catch {
        return null;
      }
    })();
    process.stdout.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id,
        error: {
          code: -32000,
          message: error instanceof Error ? error.message : String(error),
        },
      }) + "\n",
    );
  }
});
