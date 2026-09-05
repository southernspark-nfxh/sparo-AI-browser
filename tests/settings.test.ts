import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, afterEach } from "vitest";
import { loadSettings, saveSettings, COMPAT_GATEWAYS, settingsPublicView } from "../src/main/settings/store.js";

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
    expect(s.locale).toBe("en");
  });

  it("persists locale", () => {
    const dir = tmpDir();
    const s = saveSettings(dir, { locale: "ja" });
    expect(s.locale).toBe("ja");
    expect(loadSettings(dir).locale).toBe("ja");
  });

  it("defaults to English when settings.json has no locale", () => {
    const dir = tmpDir();
    expect(loadSettings(dir).locale).toBe("en");
    expect(loadSettings(dir, "zh-CN").locale).toBe("en");
  });

  it("defaults memory saver on and persists idle minutes", () => {
    const dir = tmpDir();
    expect(loadSettings(dir).memorySaver).toBe(true);
    expect(loadSettings(dir).memorySaverIdleMinutes).toBe(2);
    const s = saveSettings(dir, { memorySaver: false, memorySaverIdleMinutes: 5 });
    expect(s.memorySaver).toBe(false);
    expect(s.memorySaverIdleMinutes).toBe(5);
    expect(loadSettings(dir).memorySaver).toBe(false);
    expect(settingsPublicView(s).memorySaverIdleMinutes).toBe(5);
  });

  it("exposes OpenAI-compatible gateways for custom provider", () => {
    expect(COMPAT_GATEWAYS.some((g) => g.id === "openrouter")).toBe(true);
    expect(COMPAT_GATEWAYS.some((g) => g.id === "dashscope")).toBe(true);
    const dir = tmpDir();
    const view = settingsPublicView(loadSettings(dir));
    expect(view.gateways.length).toBeGreaterThan(8);
  });

  it("persists llmMode and defaults to byok", () => {
    const dir = tmpDir();
    expect(loadSettings(dir).llmMode).toBe("byok");
    expect(settingsPublicView(loadSettings(dir)).llmMode).toBe("byok");
    const s = saveSettings(dir, { llmMode: "cloud" });
    expect(s.llmMode).toBe("cloud");
    expect(loadSettings(dir).llmMode).toBe("cloud");
    expect(settingsPublicView(s).llmMode).toBe("cloud");
    expect(settingsPublicView(s).configured).toBe(false);
  });
});
