/**
 * Let any agent drive Sparo. The user only needs: program path + one copy.
 * Cursor/Claude shortcuts appear only if that app is actually installed.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { tx } from "../shared/i18n.js";

const nodeRequire = createRequire(import.meta.url);

export type AgentTarget = "cursor" | "claude";

export type AgentConnectStatus = {
  installPath: string;
  cursorInstalled: boolean;
  claudeInstalled: boolean;
  cursorLinked: boolean;
  claudeLinked: boolean;
};

export type AgentConnectResult = {
  ok: boolean;
  message: string;
  target?: AgentTarget;
  status: AgentConnectStatus;
};

type McpFile = {
  mcpServers?: Record<string, Record<string, unknown>>;
  [k: string]: unknown;
};

export function cursorMcpPath(): string {
  return join(homedir(), ".cursor", "mcp.json");
}

export function claudeMcpPath(): string {
  const appData =
    process.env.APPDATA ||
    (process.platform === "darwin"
      ? join(homedir(), "Library", "Application Support")
      : join(homedir(), ".config"));
  return join(appData, "Claude", "claude_desktop_config.json");
}

function localAppData(): string {
  return process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local");
}

function firstExisting(paths: string[]): string | null {
  return paths.find((p) => existsSync(p)) || null;
}

export function cursorExePath(): string | null {
  return firstExisting([
    join(localAppData(), "Programs", "cursor", "Cursor.exe"),
    join(localAppData(), "Programs", "Cursor", "Cursor.exe"),
    join(homedir(), "AppData", "Local", "Programs", "cursor", "Cursor.exe"),
    "/Applications/Cursor.app",
  ]);
}

export function claudeExePath(): string | null {
  return firstExisting([
    join(localAppData(), "AnthropicClaude", "claude.exe"),
    join(localAppData(), "Programs", "Claude", "Claude.exe"),
    join(localAppData(), "claude-desktop", "Claude.exe"),
    "/Applications/Claude.app",
  ]);
}

export function upsertMcpServer(
  file: McpFile,
  name: string,
  server: Record<string, unknown>,
): McpFile {
  const servers = { ...(file.mcpServers || {}) };
  servers[name] = server;
  return { ...file, mcpServers: servers };
}

export function fileHasSparo(file: McpFile | null): boolean {
  if (!file?.mcpServers) return false;
  const entry = file.mcpServers.sparo;
  if (!entry) return false;
  const blob = JSON.stringify(entry).toLowerCase();
  return blob.includes("sparo") || blob.includes("3921") || blob.includes("sparo-agent");
}

function readMcpFile(path: string): McpFile {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8")) as McpFile;
  } catch {
    return {};
  }
}

function writeMcpFile(path: string, file: McpFile): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(file, null, 2) + "\n", "utf8");
}

function configDir(): string {
  return (
    process.env.SPARO_CONFIG_DIR ||
    (process.platform === "win32" && process.env.APPDATA
      ? join(process.env.APPDATA, "sparo-store")
      : join(homedir(), ".config", "sparo-store"))
  );
}

function loadAuth(): { endpoint: string; token: string } | null {
  const p = join(configDir(), "mcp-auth.json");
  if (!existsSync(p)) return null;
  try {
    const raw = JSON.parse(readFileSync(p, "utf8")) as {
      endpoint?: string;
      token?: string;
    };
    if (raw.endpoint && raw.token) return { endpoint: raw.endpoint, token: raw.token };
  } catch {
    /* ignore */
  }
  return null;
}

/** Packaged internals (app.asar) are not a launchable program path. */
export function isUnusableInstallPath(p: string | undefined): boolean {
  if (!p) return true;
  return /app\.asar/i.test(p.replace(/\\/g, "/"));
}

export type InstallPathInput = {
  isPackaged: boolean;
  execPath: string;
  portableFile?: string;
  persistedExe?: string;
  appPath?: string;
  cwd: string;
  exists: (p: string) => boolean;
};

/**
 * What the user double-clicked: installer Sparo.exe, or the portable exe.
 * Never app.asar — that path is invalid after copy/install.
 */
export function pickInstallPath(input: InstallPathInput): string {
  const usable = (p?: string) => Boolean(p && input.exists(p) && !isUnusableInstallPath(p));
  if (usable(input.portableFile)) return input.portableFile as string;
  if (input.isPackaged && input.execPath && !isUnusableInstallPath(input.execPath)) {
    return input.execPath;
  }
  if (usable(input.persistedExe) && /\.exe$/i.test(input.persistedExe as string)) {
    return input.persistedExe as string;
  }
  if (input.appPath && !isUnusableInstallPath(input.appPath)) return input.appPath;
  if (usable(input.persistedExe)) return input.persistedExe as string;
  return input.cwd;
}

export type AgentScriptInput = {
  isPackaged: boolean;
  resourcesPath?: string;
  execDir?: string;
  appPath?: string;
  cwd: string;
  persistedScript?: string;
  exists: (p: string) => boolean;
};

export function pickAgentScript(input: AgentScriptInput): string {
  const candidates: string[] = [];
  if (input.isPackaged) {
    if (input.resourcesPath) candidates.push(join(input.resourcesPath, "sparo-agent.cjs"));
    if (input.execDir) candidates.push(join(input.execDir, "resources", "sparo-agent.cjs"));
  }
  if (input.appPath) candidates.push(join(input.appPath, "resources", "sparo-agent.cjs"));
  candidates.push(join(input.cwd, "resources", "sparo-agent.cjs"));
  if (input.persistedScript) candidates.push(input.persistedScript);
  const hit = candidates.find((p) => input.exists(p) && !isUnusableInstallPath(p));
  return hit || candidates[0];
}

function runtimeApp(): { isPackaged: boolean; appPath?: string } {
  try {
    const { app } = nodeRequire("electron") as typeof import("electron");
    return { isPackaged: app.isPackaged, appPath: app.getAppPath() };
  } catch {
    return { isPackaged: false };
  }
}

function readPersistedInstall(): { exe?: string; agentScript?: string; launchCommand?: string } {
  const p = join(configDir(), "install.json");
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, "utf8")) as {
      exe?: string;
      agentScript?: string;
      launchCommand?: string;
    };
  } catch {
    return {};
  }
}

export function persistInstallInfo(): { exe: string; agentScript: string } {
  const launch = agentLaunchSpec();
  const exe = installPath();
  const info = {
    exe,
    launchCommand: launch.command,
    agentScript: launch.args[0] || "",
    endpointHint: "http://127.0.0.1:3921/mcp",
    updatedAt: new Date().toISOString(),
  };
  const dir = configDir();
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "install.json"), JSON.stringify(info, null, 2), "utf8");
  return { exe, agentScript: info.agentScript };
}

/** Real .exe for installed/portable builds. Never return app.asar. */
export function installPath(): string {
  const rt = runtimeApp();
  const persisted = readPersistedInstall();
  return pickInstallPath({
    isPackaged: rt.isPackaged,
    execPath: process.execPath,
    portableFile: process.env.PORTABLE_EXECUTABLE_FILE,
    persistedExe: persisted.exe,
    appPath: rt.appPath,
    cwd: process.cwd(),
    exists: existsSync,
  });
}

export function agentLaunchSpec(): { command: string; args: string[]; env: Record<string, string> } {
  const env = { ELECTRON_RUN_AS_NODE: "1" };
  const rt = runtimeApp();
  const persisted = readPersistedInstall();
  const script = pickAgentScript({
    isPackaged: rt.isPackaged,
    resourcesPath: process.resourcesPath,
    execDir: dirname(process.execPath),
    appPath: rt.appPath,
    cwd: process.cwd(),
    persistedScript: persisted.agentScript,
    exists: existsSync,
  });
  const command =
    rt.isPackaged && !isUnusableInstallPath(process.execPath)
      ? process.execPath
      : persisted.launchCommand && existsSync(persisted.launchCommand)
        ? persisted.launchCommand
        : process.execPath;
  return { command, args: [script], env };
}

export function connectedStatus(): AgentConnectStatus {
  const cursorInstalled = Boolean(cursorExePath());
  const claudeInstalled = Boolean(claudeExePath());
  return {
    installPath: installPath(),
    cursorInstalled,
    claudeInstalled,
    cursorLinked: cursorInstalled && fileHasSparo(readMcpFile(cursorMcpPath())),
    claudeLinked: claudeInstalled && fileHasSparo(readMcpFile(claudeMcpPath())),
  };
}

export function connectAgent(target: AgentTarget, locale?: string): AgentConnectResult {
  const status = connectedStatus();
  const auth = loadAuth();
  if (!auth) {
    return { ok: false, message: tx(locale, "agent.openFirst"), status };
  }

  if (target === "cursor") {
    if (!status.cursorInstalled) {
      return { ok: false, message: tx(locale, "agent.noCursor"), status };
    }
    writeMcpFile(
      cursorMcpPath(),
      upsertMcpServer(readMcpFile(cursorMcpPath()), "sparo", {
        url: auth.endpoint,
        headers: { Authorization: `Bearer ${auth.token}` },
      }),
    );
    return {
      ok: true,
      target,
      status: { ...status, cursorLinked: true },
      message: tx(locale, "agent.cursorOk"),
    };
  }

  if (!status.claudeInstalled) {
    return { ok: false, message: tx(locale, "agent.noClaude"), status };
  }
  const launch = agentLaunchSpec();
  writeMcpFile(
    claudeMcpPath(),
    upsertMcpServer(readMcpFile(claudeMcpPath()), "sparo", {
      command: launch.command,
      args: launch.args,
      env: launch.env,
    }),
  );
  return {
    ok: true,
    target,
    status: { ...status, claudeLinked: true },
    message: tx(locale, "agent.claudeOk"),
  };
}

export function copyForAgent(locale?: string): { ok: boolean; text: string; message: string } {
  persistInstallInfo();
  const auth = loadAuth();
  const launch = agentLaunchSpec();
  const path = installPath();
  if (isUnusableInstallPath(path)) {
    return {
      ok: false,
      text: "",
      message: tx(locale, "agent.copyFail"),
    };
  }
  const http =
    auth && {
      url: auth.endpoint,
      headers: { Authorization: `Bearer ${auth.token}` },
    };
  const stdio = {
    command: launch.command,
    args: launch.args,
    env: launch.env,
  };
  const text = [
    "请连接并操纵本机 Sparo 浏览器。和用户看到的是同一窗口、同一登录。",
    `程序位置：${path}`,
    "这是用户双击打开的那个程序。Sparo 需要保持开着。发送和提交前必须等人确认。",
    "优先用 url 配置；若你的软件只支持本地命令，用 command 配置。然后先调用 sparo_info。",
    "",
    JSON.stringify(
      {
        程序位置: path,
        mcpServers: {
          sparo: http || stdio,
          sparo_stdio: stdio,
        },
      },
      null,
      2,
    ),
  ].join("\n");
  return {
    ok: true,
    text,
    message: tx(locale, "agent.copyOk"),
  };
}
