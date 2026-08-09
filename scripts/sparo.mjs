#!/usr/bin/env node
/**
 * Sparo agent CLI — fast path for AI agents.
 * Usage:
 *   node scripts/sparo.mjs status
 *   node scripts/sparo.mjs ensure
 *   node scripts/sparo.mjs open https://weibo.com
 *   node scripts/sparo.mjs info
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.SPARO_MCP_PORT || 3920);
const HEALTH = `http://127.0.0.1:${PORT}/health`;

function configDir() {
  return (
    process.env.SPARO_CONFIG_DIR ||
    (process.platform === "win32" && process.env.APPDATA
      ? join(process.env.APPDATA, "sparo")
      : join(homedir(), ".config", "sparo"))
  );
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function getJson(url, headers = {}, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method: "GET",
        headers,
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          try {
            resolve({ status: res.statusCode || 0, json: JSON.parse(text), text });
          } catch {
            resolve({ status: res.statusCode || 0, json: null, text });
          }
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.end();
  });
}

function postMcp(auth, name, args = {}) {
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: Date.now(),
    method: "tools/call",
    params: { name, arguments: args },
  });
  return new Promise((resolve, reject) => {
    const u = new URL(auth.endpoint);
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          Authorization: `Bearer ${auth.token}`,
          "MCP-Protocol-Version": "2024-11-05",
          "Content-Length": Buffer.byteLength(body),
        },
        timeout: 60000,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let payload = text;
          if (text.includes("data:")) {
            payload =
              text
                .split(/\r?\n/)
                .filter((l) => l.startsWith("data:"))
                .map((l) => l.slice(5).trim())
                .filter(Boolean)
                .at(-1) || text;
          }
          try {
            const json = JSON.parse(payload);
            const content = json.result?.content?.[0]?.text || JSON.stringify(json.result);
            try {
              resolve(JSON.parse(content));
            } catch {
              resolve({ ok: true, message: content });
            }
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function health() {
  try {
    const r = await getJson(HEALTH);
    return r.status === 200 && r.json?.ok === true;
  } catch {
    return false;
  }
}

function loadAuth() {
  const p = join(configDir(), "mcp-auth.json");
  if (!existsSync(p)) throw new Error(`Missing ${p} — start Sparo first (npm run start)`);
  return JSON.parse(readFileSync(p, "utf8"));
}

async function ensureRunning() {
  if (await health()) {
    console.log("OK Sparo already running");
    return;
  }
  if (!existsSync(join(ROOT, "node_modules", "electron"))) {
    console.error("FAIL node_modules missing. Run: npm install");
    process.exit(2);
  }
  console.log("STARTING Sparo (npm run start)…");
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "start"], {
    cwd: ROOT,
    detached: true,
    stdio: "ignore",
    env,
    shell: process.platform === "win32",
  });
  child.unref();

  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (await health()) {
      console.log("OK Sparo ready");
      return;
    }
    await sleep(800);
  }
  console.error("FAIL Sparo did not become healthy within 90s");
  process.exit(3);
}

async function cmdStatus() {
  const up = await health();
  const authPath = join(configDir(), "mcp-auth.json");
  console.log(
    JSON.stringify(
      {
        healthy: up,
        health: HEALTH,
        mcpAuth: existsSync(authPath) ? authPath : null,
        hint: up
          ? "Call MCP navigate / or: npm run open -- https://weibo.com"
          : "Run: npm run start   then retry",
      },
      null,
      2,
    ),
  );
  process.exit(up ? 0 : 1);
}

async function cmdInfo() {
  console.log(`Sparo Agent Browser
  EN: The browser built for AI agents — humans stay in control.
  ZH: Sparo 人机同窗浏览器 — AI 驾驭网页，你驾驭 AI.
Health: ${HEALTH}
Auth:   ${join(configDir(), "mcp-auth.json")}
Start:  npm run start
Open:   npm run open -- https://weibo.com
Docs:   AGENTS.md (read first) · docs/MCP-API.md`);
}

async function cmdOpen(url) {
  if (!url) {
    console.error("Usage: npm run open -- https://weibo.com");
    process.exit(2);
  }
  let target = url.trim();
  if (target === "微博" || /weibo/i.test(target) && !/^https?:/i.test(target)) {
    target = "https://weibo.com";
  } else if (!/^https?:\/\//i.test(target)) {
    target = `https://${target}`;
  }
  await ensureRunning();
  await sleep(500);
  const auth = loadAuth();
  const nav = await postMcp(auth, "navigate", { url: target });
  console.log("NAV", nav?.ok, nav?.message || "");
  const got = await postMcp(auth, "get_url", {});
  const finalUrl = got?.data?.url || got?.message || "";
  console.log("URL", finalUrl);
  let hostOk = false;
  try {
    const want = new URL(target).hostname.replace(/^www\./, "");
    const gotHost = new URL(String(finalUrl)).hostname.replace(/^www\./, "");
    hostOk =
      gotHost === want ||
      gotHost.endsWith("." + want) ||
      want.endsWith("." + gotHost) ||
      gotHost.includes("weibo");
  } catch {
    hostOk = /weibo/i.test(String(finalUrl));
  }
  if (!nav?.ok || !hostOk) {
    console.error("FAIL navigation not confirmed");
    process.exit(4);
  }
  console.log("OK");
}

const [cmd, ...rest] = process.argv.slice(2);
const arg = rest.join(" ").trim();

if (cmd === "status") await cmdStatus();
else if (cmd === "info") await cmdInfo();
else if (cmd === "ensure" || cmd === "start") {
  await ensureRunning();
} else if (cmd === "open") {
  await cmdOpen(arg);
} else {
  console.log(`Sparo Agent Browser CLI
  node scripts/sparo.mjs status
  node scripts/sparo.mjs ensure
  node scripts/sparo.mjs open <url>
  node scripts/sparo.mjs info`);
  process.exit(cmd ? 2 : 0);
}
