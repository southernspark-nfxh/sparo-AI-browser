import { app } from "electron";
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";
import { createBrowser, whenAppReady } from "./browser.js";
import { createToolHandlers } from "./tools/index.js";
import { startMcpServer } from "./mcp-server.js";
import { shouldRotateToken } from "./mcp-security.js";
import { migrateCookiesFromLegacyUserData } from "./sessions/store.js";

/** Reuse mcp-auth.json token unless SPARO_MCP_TOKEN_TTL (seconds) says rotate. */
function resolveMcpToken(configDir: string): { token: string; createdAt: number } {
  const envToken = (process.env.SPARO_MCP_TOKEN || process.env.SPARK_MCP_TOKEN || "").trim();
  const ttlSec = Number(process.env.SPARO_MCP_TOKEN_TTL || 0);
  const authPath = join(configDir, "mcp-auth.json");
  let prev: { token?: string; createdAt?: number } = {};
  if (existsSync(authPath)) {
    try {
      prev = JSON.parse(readFileSync(authPath, "utf8")) as typeof prev;
    } catch {
      /* ignore */
    }
  }
  if (envToken) {
    return { token: envToken, createdAt: Date.now() };
  }
  if (
    prev.token &&
    typeof prev.createdAt === "number" &&
    !shouldRotateToken(prev.createdAt, ttlSec)
  ) {
    process.env.SPARO_MCP_TOKEN = prev.token;
    return { token: prev.token, createdAt: prev.createdAt };
  }
  if (prev.token && !(ttlSec > 0)) {
    // No TTL configured — keep stable token across restarts
    process.env.SPARO_MCP_TOKEN = prev.token;
    return { token: prev.token, createdAt: prev.createdAt || Date.now() };
  }
  const token = randomBytes(24).toString("hex");
  process.env.SPARO_MCP_TOKEN = token;
  return { token, createdAt: Date.now() };
}

function resolveConfigDir(): string {
  return (
    process.env.SPARO_CONFIG_DIR ||
    process.env.SPARK_CONFIG_DIR ||
    (process.platform === "win32" && process.env.APPDATA
      ? join(process.env.APPDATA, "sparo")
      : join(homedir(), ".config", "sparo"))
  );
}

async function main(): Promise<void> {
  app.setName("Sparo Agent Browser");
  if (process.platform === "win32") {
    app.setAppUserModelId("com.sparo.agent-browser");
  }

  // Keep cookies + skills + mcp-auth under the same %APPDATA%/sparo tree.
  const configDir = resolveConfigDir();
  mkdirSync(configDir, { recursive: true });
  app.setPath("userData", configDir);
  // Migrate cookies from older Electron default folder if present (before session opens).
  const mig = migrateCookiesFromLegacyUserData(configDir);
  if (mig.migrated) {
    console.log(`[sparo] session migrate: ${mig.message}`);
  }

  await whenAppReady();

  // Dev / Linux / Windows: reinforce dock/taskbar icon after ready.
  try {
    const { nativeImage } = await import("electron");
    const candidates = [
      join(__dirname, "../../resources/icon.ico"),
      join(__dirname, "../../resources/icon.png"),
      join(app.getAppPath(), "resources/icon.ico"),
      join(app.getAppPath(), "resources/icon.png"),
    ];
    const iconPath = candidates.find((p) => existsSync(p));
    if (iconPath) {
      const img = nativeImage.createFromPath(iconPath);
      if (!img.isEmpty() && process.platform === "darwin") {
        app.dock?.setIcon(img);
      }
    }
  } catch {
    /* ignore icon reinforce failures */
  }

  process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = "true";

  const browser = createBrowser();
  browser.attachShell();

  const authToken = resolveMcpToken(configDir);
  const handlers = createToolHandlers(browser);
  const mcp = await startMcpServer(handlers);

  writeFileSync(
    join(configDir, "mcp-auth.json"),
    JSON.stringify(
      {
        endpoint: mcp.endpoint,
        token: mcp.token,
        createdAt: authToken.createdAt,
        pid: process.pid,
      },
      null,
      2,
    ),
    "utf8",
  );
  console.log(`[sparo] MCP auth → ${join(configDir, "mcp-auth.json")}`);
  console.log(`[sparo] userData → ${app.getPath("userData")}`);

  // Persist whatever logins are already in the Chromium cookie jar.
  try {
    const saved = await browser.saveSessions();
    console.log(`[sparo] sessions: ${saved.message}`);
  } catch (e) {
    console.warn("[sparo] saveSessions on boot:", e);
  }

  app.on("window-all-closed", () => {
    void mcp.close().finally(() => app.quit());
  });
}

main().catch((error) => {
  console.error("[sparo] fatal:", error);
  app.exit(1);
});
