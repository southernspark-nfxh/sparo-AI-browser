#!/usr/bin/env node
/**
 * Shared MCP HTTP helpers for Spark acceptance scripts.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import http from "node:http";
import https from "node:https";

/** Long workflows (一键翻译) can exceed fetch's default ~300s timeout */
const LONG_MS = 20 * 60 * 1000;

export function loadAuth() {
  const configDir =
    process.env.SPARO_CONFIG_DIR ||
    process.env.SPARK_CONFIG_DIR ||
    (process.platform === "win32" && process.env.APPDATA
      ? join(process.env.APPDATA, "sparo")
      : join(homedir(), ".config", "sparo"));
  return JSON.parse(readFileSync(join(configDir, "mcp-auth.json"), "utf8"));
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function parsePayload(text) {
  let payload = text;
  if (text.includes("data:")) {
    const dataLines = text
      .split(/\r?\n/)
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trim())
      .filter(Boolean);
    payload = dataLines.at(-1) || text;
  }
  return JSON.parse(payload);
}

function postJson(urlStr, headers, body, timeoutMs = LONG_MS) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const lib = u.protocol === "https:" ? https : http;
    const req = lib.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || (u.protocol === "https:" ? 443 : 80),
        path: u.pathname + u.search,
        method: "POST",
        headers: {
          ...headers,
          "Content-Length": Buffer.byteLength(body),
        },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          resolve({
            ok: (res.statusCode || 500) >= 200 && (res.statusCode || 500) < 300,
            status: res.statusCode || 0,
            text: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );
    req.on("timeout", () => {
      req.destroy(new Error(`MCP request timeout after ${timeoutMs}ms`));
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function mcpFetch(auth, body) {
  return postJson(
    auth.endpoint,
    {
      "Content-Type": "application/json; charset=utf-8",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${auth.token}`,
      "MCP-Protocol-Version": "2024-11-05",
    },
    // JSON.stringify preserves Unicode; Buffer.byteLength counts UTF-8 bytes
    JSON.stringify(body),
  );
}

export async function initialize(auth) {
  const body = {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "spark-accept", version: "0.1.1" },
    },
  };
  const res = await mcpFetch(auth, body);
  if (!res.ok) throw new Error(`initialize failed: ${res.status} ${res.text}`);
}

export async function mcpCall(auth, name, args = {}) {
  const body = {
    jsonrpc: "2.0",
    id: Date.now(),
    method: "tools/call",
    params: { name, arguments: args },
  };
  const res = await mcpFetch(auth, body);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.text}`);
  const json = parsePayload(res.text);
  if (json.error) throw new Error(JSON.stringify(json.error));
  const content = json.result?.content?.[0]?.text || JSON.stringify(json.result);
  try {
    return JSON.parse(content);
  } catch {
    return { ok: true, message: content };
  }
}
