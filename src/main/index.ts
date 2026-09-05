import { app, BrowserWindow, session } from "electron";
import { chromeUserAgent } from "./oauth-popups.js";
import { writeFileSync, mkdirSync, existsSync, readFileSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";
import { createBrowser, whenAppReady } from "./browser.js";
import { createToolHandlers } from "./tools/index.js";
import { startMcpServer } from "./mcp-server.js";
import { shouldRotateToken } from "./mcp-security.js";
import { migrateCookiesFromLegacyUserData } from "./sessions/store.js";
import { persistInstallInfo } from "./agent-connect.js";
import { stopAll as stopAllEnvProxy } from "./envs/singbox-runner.js";
import { storeConfigDir } from "./paths.js";

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
  return storeConfigDir();
}

function seedSettingsFromOriginal(configDir: string): void {
  const dest = join(configDir, "settings.json");
  if (existsSync(dest)) return;
  const legacy =
    process.platform === "win32" && process.env.APPDATA
      ? join(process.env.APPDATA, "sparo", "settings.json")
      : join(homedir(), ".config", "sparo", "settings.json");
  if (!existsSync(legacy)) return;
  try {
    copyFileSync(legacy, dest);
    console.log("[sparo] seeded settings.json (key / language). Chat and bookmarks start empty.");
  } catch {
    /* ignore */
  }
}

async function main(): Promise<void> {
  app.setName("Sparo");
  if (process.platform === "win32") {
    app.setAppUserModelId("com.sparo.work-browser");
  }
  // Must run before ready: Google/Apple OAuth blank out on Electron UA + 3P cookie phaseout.
  app.userAgentFallback = chromeUserAgent();
  app.commandLine.appendSwitch(
    "disable-features",
    "ThirdPartyCookiePhaseout,TrackingProtection3pcd",
  );

  // Store edition keeps its own tree so it never shares cookies with the original Sparo.
  const configDir = resolveConfigDir();
  mkdirSync(configDir, { recursive: true });
  // Packaged install is a blank product. Do not copy API keys from the original Sparo.
  if (!app.isPackaged) seedSettingsFromOriginal(configDir);
  app.setPath("userData", configDir);

  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
    return;
  }
  app.on("second-instance", () => {
    const w = BrowserWindow.getAllWindows()[0];
    if (!w) return;
    if (w.isMinimized()) w.restore();
    w.show();
    w.focus();
  });
  // Migrate cookies from older Electron default folder if present (before session opens).
  const mig = migrateCookiesFromLegacyUserData(configDir);
  if (mig.migrated) {
    console.log(`[sparo] session migrate: ${mig.message}`);
  }

  await whenAppReady();
  session.defaultSession.setUserAgent(chromeUserAgent());

  process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = "true";

  const browser = createBrowser();
  browser.attachShell();
  browser.presentWindow();

  try {
    const { nativeImage } = await import("electron");
    const candidates = [
      join(__dirname, "../../resources/icon.ico"),
      join(__dirname, "../../resources/icon.png"),
      join(process.cwd(), "resources/icon.ico"),
      join(app.getAppPath(), "resources/icon.ico"),
    ];
    const iconPath = candidates.find((p) => existsSync(p));
    if (iconPath) {
      const img = nativeImage.createFromPath(iconPath);
      if (!img.isEmpty() && process.platform === "darwin") app.dock?.setIcon(img);
      if (process.platform === "win32") {
        for (const w of BrowserWindow.getAllWindows()) w.setIcon(iconPath);
      }
    }
  } catch {
    /* ignore icon reinforce failures */
  }

  const authToken = resolveMcpToken(configDir);
  const handlers = createToolHandlers(browser);
  let mcp: Awaited<ReturnType<typeof startMcpServer>> | null = null;
  try {
    mcp = await startMcpServer(handlers);
  } catch (e) {
    console.error("[sparo] MCP failed to start (browser still opens):", e);
  }

  if (mcp) {
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
  }
  try {
    persistInstallInfo();
  } catch (e) {
    console.warn("[sparo] persist install path:", e);
  }
  console.log(`[sparo] userData → ${app.getPath("userData")}`);

  app.on("window-all-closed", () => {
    try {
      stopAllEnvProxy();
    } catch {
      /* best-effort cleanup */
    }
    const closer = mcp ? mcp.close() : Promise.resolve();
    void closer.finally(() => app.quit());
  });
}

main().catch((error) => {
  console.error("[sparo] fatal:", error);
  app.exit(1);
});
