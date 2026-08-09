import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type LlmProvider = "deepseek" | "openai" | "custom";

export type SparoSettings = {
  /** @deprecated use apiKey — kept for migration */
  deepseekApiKey?: string;
  deepseekBaseUrl?: string;
  deepseekModel?: string;
  provider: LlmProvider;
  apiKey: string;
  baseUrl: string;
  model: string;
};

/** Presets: picking a brand fills base URL + default model. Key alone is not enough. */
export const PROVIDER_PRESETS: Record<
  LlmProvider,
  { label: string; baseUrl: string; model: string; hint: string }
> = {
  deepseek: {
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-v4-flash",
    hint: "Recommended. Key from platform.deepseek.com",
  },
  openai: {
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4.1-mini",
    hint: "Key from platform.openai.com — uses OpenAI API host",
  },
  custom: {
    label: "Custom (OpenAI-compatible)",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4.1-mini",
    hint: "Any OpenAI-compatible gateway — set Base URL + Model yourself",
  },
};

const DEFAULTS: SparoSettings = {
  provider: "deepseek",
  apiKey: "",
  baseUrl: PROVIDER_PRESETS.deepseek.baseUrl,
  model: PROVIDER_PRESETS.deepseek.model,
};

function settingsPath(configDir: string): string {
  return join(configDir, "settings.json");
}

function readFileSettings(configDir: string): Partial<SparoSettings> {
  const p = settingsPath(configDir);
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, "utf8")) as Partial<SparoSettings>;
  } catch {
    return {};
  }
}

function normalizeModel(model: string): string {
  if (model === "deepseek-chat" || model === "deepseek-reasoner") {
    return "deepseek-v4-flash";
  }
  return model || DEFAULTS.model;
}

function normalizeProvider(p: unknown): LlmProvider {
  if (p === "openai" || p === "custom" || p === "deepseek") return p;
  return DEFAULTS.provider;
}

export function loadSettings(configDir: string): SparoSettings {
  mkdirSync(configDir, { recursive: true });
  const file = readFileSettings(configDir);
  const envKey = (process.env.SPARO_API_KEY || "").trim();
  const envBase = (process.env.SPARO_BASE_URL || "").trim().replace(/\/$/, "");
  const envModel = (process.env.SPARO_MODEL || "").trim();
  const envProvider = normalizeProvider(
    process.env.SPARO_PROVIDER?.trim() || file.provider,
  );

  const provider = envProvider;
  const preset = PROVIDER_PRESETS[provider];
  const apiKey = envKey || String(file.apiKey || file.deepseekApiKey || "").trim();
  const baseUrl =
    envBase ||
    String(file.baseUrl || file.deepseekBaseUrl || preset.baseUrl)
      .trim()
      .replace(/\/$/, "") ||
    preset.baseUrl;
  const model = normalizeModel(
    envModel || String(file.model || file.deepseekModel || preset.model),
  );

  return { provider, apiKey, baseUrl, model };
}

export function saveSettings(
  configDir: string,
  patch: Partial<SparoSettings> & { applyPreset?: boolean },
): SparoSettings {
  mkdirSync(configDir, { recursive: true });
  const file = readFileSettings(configDir);
  const current = loadSettings(configDir);

  const provider = normalizeProvider(
    patch.provider !== undefined ? patch.provider : file.provider || current.provider,
  );
  const preset = PROVIDER_PRESETS[provider];
  const providerChanged =
    patch.provider !== undefined && patch.provider !== current.provider;
  const usePreset = patch.applyPreset === true || providerChanged;

  const next: SparoSettings = {
    provider,
    apiKey:
      patch.apiKey !== undefined
        ? String(patch.apiKey).trim()
        : patch.deepseekApiKey !== undefined
          ? String(patch.deepseekApiKey).trim()
          : String(file.apiKey || file.deepseekApiKey || "").trim(),
    baseUrl:
      (
        patch.baseUrl !== undefined
          ? String(patch.baseUrl).trim()
          : patch.deepseekBaseUrl !== undefined
            ? String(patch.deepseekBaseUrl).trim()
            : usePreset
              ? preset.baseUrl
              : String(file.baseUrl || file.deepseekBaseUrl || preset.baseUrl)
      ).replace(/\/$/, "") || preset.baseUrl,
    model: normalizeModel(
      patch.model !== undefined
        ? String(patch.model).trim() || preset.model
        : patch.deepseekModel !== undefined
          ? String(patch.deepseekModel).trim() || preset.model
          : usePreset
            ? preset.model
            : String(file.model || file.deepseekModel || preset.model),
    ),
  };
  writeFileSync(settingsPath(configDir), JSON.stringify(next, null, 2), "utf8");
  return loadSettings(configDir);
}

/** @deprecated alias */
export type SparkSettings = SparoSettings;

export function settingsPublicView(settings: SparoSettings): {
  configured: boolean;
  fromEnv: boolean;
  provider: string;
  baseUrl: string;
  model: string;
  apiKeyMasked: string;
  presets: typeof PROVIDER_PRESETS;
} {
  const key = settings.apiKey;
  const fromEnv = Boolean((process.env.SPARO_API_KEY || "").trim());
  let apiKeyMasked = "";
  if (key) {
    apiKeyMasked =
      key.length <= 8 ? "••••" + key.slice(-2) : key.slice(0, 4) + "••••" + key.slice(-4);
  }
  return {
    configured: Boolean(key),
    fromEnv,
    provider: settings.provider,
    baseUrl: settings.baseUrl,
    model: settings.model,
    apiKeyMasked,
    presets: PROVIDER_PRESETS,
  };
}
