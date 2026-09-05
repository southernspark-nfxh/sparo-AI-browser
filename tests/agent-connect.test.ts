import { describe, expect, it } from "vitest";
import {
  fileHasSparo,
  isUnusableInstallPath,
  pickAgentScript,
  pickInstallPath,
  upsertMcpServer,
} from "../src/main/agent-connect.js";

describe("upsertMcpServer", () => {
  it("keeps other servers when adding sparo", () => {
    const next = upsertMcpServer(
      { mcpServers: { other: { command: "x" } } },
      "sparo",
      { url: "http://127.0.0.1:3921/mcp" },
    );
    expect(next.mcpServers?.other).toEqual({ command: "x" });
    expect(next.mcpServers?.sparo).toEqual({ url: "http://127.0.0.1:3921/mcp" });
  });
});

describe("fileHasSparo", () => {
  it("detects sparo url config", () => {
    expect(
      fileHasSparo({
        mcpServers: { sparo: { url: "http://127.0.0.1:3921/mcp" } },
      }),
    ).toBe(true);
  });

  it("is false when empty", () => {
    expect(fileHasSparo({})).toBe(false);
    expect(fileHasSparo(null)).toBe(false);
  });
});

describe("packaged install path", () => {
  const exists = (p: string) =>
    p === "C:\\Users\\me\\AppData\\Local\\Programs\\Sparo\\Sparo.exe" ||
    p === "D:\\download\\Sparo便携版.exe" ||
    p === "C:\\Users\\me\\AppData\\Local\\Programs\\Sparo\\resources\\sparo-agent.cjs" ||
    p === "C:\\temp\\resources\\sparo-agent.cjs";

  it("rejects app.asar", () => {
    expect(isUnusableInstallPath("C:\\app\\resources\\app.asar")).toBe(true);
    expect(isUnusableInstallPath("C:\\app\\Sparo.exe")).toBe(false);
  });

  it("installer copy uses Sparo.exe not asar", () => {
    const path = pickInstallPath({
      isPackaged: true,
      execPath: "C:\\Users\\me\\AppData\\Local\\Programs\\Sparo\\Sparo.exe",
      appPath: "C:\\Users\\me\\AppData\\Local\\Programs\\Sparo\\resources\\app.asar",
      cwd: "C:\\Users\\me\\AppData\\Local\\Programs\\Sparo",
      exists,
    });
    expect(path).toBe("C:\\Users\\me\\AppData\\Local\\Programs\\Sparo\\Sparo.exe");
    expect(isUnusableInstallPath(path)).toBe(false);
  });

  it("portable copy uses the exe the user double-clicked", () => {
    const path = pickInstallPath({
      isPackaged: true,
      execPath: "C:\\Users\\me\\AppData\\Local\\Temp\\Sparo\\Sparo.exe",
      portableFile: "D:\\download\\Sparo便携版.exe",
      appPath: "C:\\Users\\me\\AppData\\Local\\Temp\\Sparo\\resources\\app.asar",
      cwd: "C:\\Users\\me\\AppData\\Local\\Temp\\Sparo",
      exists,
    });
    expect(path).toBe("D:\\download\\Sparo便携版.exe");
  });

  it("never falls back to asar even if that is appPath", () => {
    const path = pickInstallPath({
      isPackaged: false,
      execPath: "C:\\dev\\node.exe",
      appPath: "C:\\dev\\resources\\app.asar",
      persistedExe: "C:\\Users\\me\\AppData\\Local\\Programs\\Sparo\\Sparo.exe",
      cwd: "C:\\dev",
      exists,
    });
    expect(path).toBe("C:\\Users\\me\\AppData\\Local\\Programs\\Sparo\\Sparo.exe");
  });

  it("packaged agent script is outside asar", () => {
    const script = pickAgentScript({
      isPackaged: true,
      resourcesPath: "C:\\Users\\me\\AppData\\Local\\Programs\\Sparo\\resources",
      execDir: "C:\\Users\\me\\AppData\\Local\\Programs\\Sparo",
      appPath: "C:\\Users\\me\\AppData\\Local\\Programs\\Sparo\\resources\\app.asar",
      cwd: "C:\\Users\\me\\AppData\\Local\\Programs\\Sparo",
      exists,
    });
    expect(script).toBe(
      "C:\\Users\\me\\AppData\\Local\\Programs\\Sparo\\resources\\sparo-agent.cjs",
    );
    expect(isUnusableInstallPath(script)).toBe(false);
  });
});
