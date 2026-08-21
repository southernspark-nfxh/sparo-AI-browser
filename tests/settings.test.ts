import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, afterEach } from "vitest";
import { loadSettings, saveSettings } from "../src/main/settings/store.js";

const dirs: string[] = [];

afterEach(() => {
  for (const d of dirs.splice(0)) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

function tmpDir(): string {
  const d = mkdtempSync(join(tmpdir(), "sparo-settings-"));
  dirs.push(d);
  return d;
}

describe("loadSettings", () => {
  it("maps legacy deepseekApiKey to apiKey", () => {
    const dir = tmpDir();
    writeFileSync(
      join(dir, "settings.json"),
      JSON.stringify({
        deepseekApiKey: "sk-legacy",
        deepseekBaseUrl: "https://api.deepseek.com",
        deepseekModel: "deepseek-chat",
      }),
      "utf8",
    );
    const s = loadSettings(dir);
    expect(s.apiKey).toBe("sk-legacy");
    expect(s.baseUrl).toBe("https://api.deepseek.com");
    expect(s.model).toBe("deepseek-v4-flash"); // normalized from deepseek-chat
  });

  it("prefers apiKey over deepseekApiKey", () => {
    const dir = tmpDir();
    writeFileSync(
      join(dir, "settings.json"),
      JSON.stringify({ apiKey: "sk-new", deepseekApiKey: "sk-old" }),
      "utf8",
    );
    expect(loadSettings(dir).apiKey).toBe("sk-new");
  });

  it("saveSettings writes canonical fields", () => {
    const dir = tmpDir();
    const s = saveSettings(dir, { apiKey: "sk-x", provider: "deepseek", applyPreset: true });
    expect(s.apiKey).toBe("sk-x");
    expect(s.model).toContain("deepseek");
  });
});
