import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeLocale, type AppLocale } from "../../shared/i18n.js";

export type LlmProvider = "deepseek" | "openai" | "custom";
export type LlmMode = "byok" | "cloud";

export type SparoSettings = {
  /** @deprecated use apiKey — kept for migration */
  deepseekApiKey?: string;
  deepseekBaseUrl?: string;
  deepseekModel?: string;
  provider: LlmProvider;
  apiKey: string;
  baseUrl: string;
  model: string;
  locale: AppLocale;
  /** byok = 用户自己的 key；cloud = 走 sparo-pay 代理（key 不进本机） */
  llmMode: LlmMode;
  /** Discard inactive tab renderers to free RAM (Chrome-style Memory Saver). */
  memorySaver: boolean;
  /** Minutes a background tab may stay alive before discard. */
  memorySaverIdleMinutes: number;
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

/** OpenAI-compatible hosts. Native Anthropic / Gemini APIs are not this path. */
export type CompatGateway = {
  id: string;
  label: string;
  baseUrl: string;
  model: string;
};

export const COMPAT_GATEWAYS: CompatGateway[] = [
  { id: "openrouter", label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", model: "openai/gpt-4.1-mini" },
  { id: "groq", label: "Groq", baseUrl: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile" },
  { id: "xai", label: "xAI Grok", baseUrl: "https://api.x.ai/v1", model: "grok-3-mini" },
  { id: "mistral", label: "Mistral", baseUrl: "https://api.mistral.ai/v1", model: "mistral-small-latest" },
  { id: "together", label: "Together", baseUrl: "https://api.together.xyz/v1", model: "meta-llama/Llama-3.3-70B-Instruct-Turbo" },
  { id: "siliconflow", label: "硅基流动 SiliconFlow", baseUrl: "https://api.siliconflow.cn/v1", model: "deepseek-ai/DeepSeek-V3" },
  { id: "dashscope", label: "通义 compatible", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-plus" },
  { id: "moonshot", label: "Kimi 月之暗面", baseUrl: "https://api.moonshot.cn/v1", model: "moonshot-v1-auto" },
  { id: "zhipu", label: "智谱 GLM", baseUrl: "https://open.bigmodel.cn/api/paas/v4", model: "glm-4-flash" },
  { id: "volcengine", label: "火山方舟 Ark", baseUrl: "https://ark.cn-beijing.volces.com/api/v3", model: "deepseek-v3-250324" },
  { id: "ollama", label: "Ollama 本机", baseUrl: "http://127.0.0.1:11434/v1", model: "llama3.2" },
];

function clampIdleMinutes(n: unknown): number {
  const v = Number(n);
  if (!Number.isFinite(v) || v < 1) return 2;
  return Math.min(60, Math.round(v));
}

const DEFAULTS: SparoSettings = {
  provider: "deepseek",
  apiKey: "",
  baseUrl: PROVIDER_PRESETS.deepseek.baseUrl,
  model: PROVIDER_PRESETS.deepseek.model,
  locale: "en",
  llmMode: "byok",
  memorySaver: true,
  memorySaverIdleMinutes: 2,
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

function normalizeMode(p: unknown): LlmMode {
  return p === "cloud" ? "cloud" : "byok";
}

function normalizeProvider(p: unknown): LlmProvider {
  if (p === "openai" || p === "custom" || p === "deepseek") return p;
  return DEFAULTS.provider;
}

export function loadSettings(configDir: string, _fallbackLocale?: string): SparoSettings {
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
  const locale = file.locale
    ? normalizeLocale(file.locale)
    : DEFAULTS.locale;

  return {
    provider,
    apiKey,
    baseUrl,
    model,
    locale,
    llmMode: normalizeMode(file.llmMode),
    memorySaver: file.memorySaver !== false,
    memorySaverIdleMinutes: clampIdleMinutes(file.memorySaverIdleMinutes),
  };
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
    locale:
      patch.locale !== undefined
        ? normalizeLocale(patch.locale)
        : file.locale
          ? normalizeLocale(file.locale)
          : current.locale,
    llmMode: normalizeMode(
      patch.llmMode !== undefined ? patch.llmMode : file.llmMode || current.llmMode,
    ),
    memorySaver:
      patch.memorySaver !== undefined
        ? Boolean(patch.memorySaver)
        : file.memorySaver !== false,
    memorySaverIdleMinutes: clampIdleMinutes(
      patch.memorySaverIdleMinutes !== undefined
        ? patch.memorySaverIdleMinutes
        : file.memorySaverIdleMinutes,
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
  locale: AppLocale;
  llmMode: LlmMode;
  presets: typeof PROVIDER_PRESETS;
  gateways: CompatGateway[];
  memorySaver: boolean;
  memorySaverIdleMinutes: number;
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
    locale: settings.locale,
    llmMode: settings.llmMode,
    presets: PROVIDER_PRESETS,
    gateways: COMPAT_GATEWAYS,
    memorySaver: settings.memorySaver !== false,
    memorySaverIdleMinutes: clampIdleMinutes(settings.memorySaverIdleMinutes),
  };
}
