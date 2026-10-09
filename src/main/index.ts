import { app, BrowserWindow, session, crashReporter } from "electron";
import { chromeUserAgent } from "./oauth-popups.js";
import { writeFileSync, mkdirSync, existsSync, readFileSync, copyFileSync, unlinkSync } from "node:fs";
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
  mkdirSync(join(configDir, "diag"), { recursive: true });
  app.setPath("userData", configDir);
  try {
    app.setPath("crashDumps", join(configDir, "diag", "dumps"));
  } catch {
    /* 某些版本没有这个 path */
  }

  const gpuFlag = join(configDir, "diag", "disable-gpu");
  if (existsSync(gpuFlag)) {
    app.disableHardwareAcceleration();
    console.log("[sparo] last GPU crash — hardware acceleration off this launch");
  }

  // 黑匣子：崩溃/异常落盘，下次好查。
  const crashLog = join(configDir, "diag", "crash.log");
  const appendCrash = (tag: string, err: unknown) => {
    try {
      mkdirSync(join(configDir, "diag"), { recursive: true });
      const msg =
        err instanceof Error ? `${err.message}\n${err.stack || ""}` : String(err);
      writeFileSync(
        crashLog,
        `${new Date().toISOString()} [${tag}] ${msg}\n`,
        { flag: "a" },
      );
    } catch {
      /* 写不进就算了 */
    }
  };
  process.on("uncaughtException", (err) => appendCrash("uncaughtException", err));
  process.on("unhandledRejection", (err) => appendCrash("unhandledRejection", err));
  app.on("child-process-gone", (_e, details) => {
    appendCrash(
      "child-process-gone",
      `${details.type} reason=${details.reason} code=${details.exitCode}`,
    );
    if (String(details.type).toLowerCase() === "gpu") {
      try {
        writeFileSync(gpuFlag, new Date().toISOString());
      } catch {
        /* ignore */
      }
    }
  });
  app.on("render-process-gone", (_e, _wc, details) =>
    appendCrash("render-process-gone", `reason=${details.reason}`),
  );

  // 原生崩溃转储 + 事件循环卡顿哨兵（AppHang 取证）。
  try {
    crashReporter.start({ productName: "Sparo", submitURL: "", uploadToServer: false });
  } catch {
    /* 某些环境起不来 */
  }
  let lastBeat = Date.now();
  setInterval(() => {
    const now = Date.now();
    if (now - lastBeat > 13_000) {
      appendCrash("event-loop-blocked", `主进程事件循环卡住约 ${Math.round((now - lastBeat) / 1000)} 秒`);
    }
    lastBeat = now;
  }, 5_000);
  setTimeout(() => {
    try {
      if (existsSync(gpuFlag)) unlinkSync(gpuFlag);
    } catch {
      /* ignore */
    }
  }, 90_000);
  // Packaged install is a blank product. Do not copy API keys from the original Sparo.
  if (!app.isPackaged) seedSettingsFromOriginal(configDir);

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
