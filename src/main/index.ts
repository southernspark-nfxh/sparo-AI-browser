import { app } from "electron";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { createBrowser, whenAppReady } from "./browser.js";
import { createToolHandlers } from "./tools/index.js";
import { startMcpServer } from "./mcp-server.js";

async function main(): Promise<void> {
  app.setName("Sparo Agent Browser");
  if (process.platform === "win32") {
    app.setAppUserModelId("com.sparo.agent-browser");
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

  const handlers = createToolHandlers(browser);
  const mcp = await startMcpServer(handlers);

  const configDir =
    process.env.SPARO_CONFIG_DIR ||
    process.env.SPARK_CONFIG_DIR ||
    (process.platform === "win32" && process.env.APPDATA
      ? join(process.env.APPDATA, "sparo")
      : join(homedir(), ".config", "sparo"));
  mkdirSync(configDir, { recursive: true });
  writeFileSync(
    join(configDir, "mcp-auth.json"),
    JSON.stringify(
      {
        endpoint: mcp.endpoint,
        token: mcp.token,
        pid: process.pid,
      },
      null,
      2,
    ),
    "utf8",
  );
  console.log(`[sparo] MCP auth → ${join(configDir, "mcp-auth.json")}`);

  app.on("window-all-closed", () => {
    void mcp.close().finally(() => app.quit());
  });
}

main().catch((error) => {
  console.error("[sparo] fatal:", error);
  app.exit(1);
});
