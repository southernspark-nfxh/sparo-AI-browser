#!/usr/bin/env node
/**
 * Hidden helper: Cursor/Claude talk to this over stdio; it talks to the Sparo window.
 * Started as: ELECTRON_RUN_AS_NODE=1 Sparo.exe sparo-agent.cjs
 */
const { spawn } = require("node:child_process");
const { existsSync, readFileSync } = require("node:fs");
const { homedir } = require("node:os");
const { join } = require("node:path");

function configDir() {
  if (process.env.SPARO_CONFIG_DIR) return process.env.SPARO_CONFIG_DIR;
  if (process.platform === "win32" && process.env.APPDATA) {
    return join(process.env.APPDATA, "sparo-store");
  }
  return join(homedir(), ".config", "sparo-store");
}

function loadAuth() {
  const p = join(configDir(), "mcp-auth.json");
  if (!existsSync(p)) return null;
  try {
    const raw = JSON.parse(readFileSync(p, "utf8"));
    if (raw && raw.endpoint && raw.token) return raw;
  } catch (_) {
    /* ignore */
  }
  return null;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function healthOk() {
  try {
    const res = await fetch("http://127.0.0.1:3921/health");
    return res.ok;
  } catch (_) {
    return false;
  }
}

function launchExe() {
  try {
    const info = JSON.parse(readFileSync(join(configDir(), "install.json"), "utf8"));
    if (info && info.exe && existsSync(info.exe) && !String(info.exe).includes("app.asar")) {
      return info.exe;
    }
  } catch (_) {
    /* ignore */
  }
  const portable = process.env.PORTABLE_EXECUTABLE_FILE;
  if (portable && existsSync(portable)) return portable;
  return process.execPath;
}

function launchSparoWindow() {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  spawn(launchExe(), [], {
    detached: true,
    stdio: "ignore",
    env,
    windowsHide: false,
  }).unref();
}

async function ensureWindow() {
  if (await healthOk()) return true;
  launchSparoWindow();
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    if (await healthOk()) return true;
  }
  return false;
}

async function postRpc(auth, body) {
  const res = await fetch(auth.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: "Bearer " + auth.token,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error("Sparo HTTP " + res.status + ": " + text.slice(0, 400));
  }
  if (text.startsWith("event:") || text.includes("\ndata:")) {
    const lines = text
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .filter(Boolean);
    const last = lines[lines.length - 1];
    return last ? JSON.parse(last) : {};
  }
  return JSON.parse(text);
}

function writeMessage(obj) {
  const json = Buffer.from(JSON.stringify(obj), "utf8");
  process.stdout.write("Content-Length: " + json.length + "\r\n\r\n");
  process.stdout.write(json);
}

async function main() {
  const ready = await ensureWindow();
  if (!ready) {
    writeMessage({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "请先打开 Sparo 窗口，再让 AI 控制浏览器。",
      },
    });
    process.exit(1);
  }
  const auth = loadAuth();
  if (!auth) {
    writeMessage({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Sparo 还没准备好，请先打开 Sparo。" },
    });
    process.exit(1);
  }

  let buf = Buffer.alloc(0);
  process.stdin.on("data", (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    process.nextTick(drain);
  });

  async function drain() {
    while (true) {
      const headerEnd = buf.indexOf("\r\n\r\n");
      if (headerEnd < 0) return;
      const header = buf.slice(0, headerEnd).toString("utf8");
      const m = /Content-Length:\s*(\d+)/i.exec(header);
      if (!m) {
        buf = buf.slice(headerEnd + 4);
        continue;
      }
      const len = Number(m[1]);
      const start = headerEnd + 4;
      if (buf.length < start + len) return;
      const body = buf.slice(start, start + len).toString("utf8");
      buf = buf.slice(start + len);
      let msg;
      try {
        msg = JSON.parse(body);
      } catch (_) {
        continue;
      }
      try {
        const result = await postRpc(auth, msg);
        writeMessage(result);
      } catch (error) {
        writeMessage({
          jsonrpc: "2.0",
          id: msg && msg.id != null ? msg.id : null,
          error: {
            code: -32000,
            message: error instanceof Error ? error.message : String(error),
          },
        });
      }
    }
  }
}

main().catch((err) => {
  process.stderr.write(String(err && err.stack ? err.stack : err) + "\n");
  process.exit(1);
});
