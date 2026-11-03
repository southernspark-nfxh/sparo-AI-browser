import fs from "node:fs";
import path from "node:path";

const TBD = "[TBD]";

export function emptyUsage() {
  return {
    reportedPromptTokens: TBD,
    uncachedInputTokens: TBD,
    cachedInputTokens: TBD,
    outputTokens: TBD,
    priceVersion: TBD,
    cost: TBD,
  };
}

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return TBD;
  }
}

export function describeConfiguredModel() {
  const file = path.join(process.env.APPDATA || "", "sparo-store", "settings.json");
  if (!file || !fs.existsSync(file)) {
    return { available: false, reason: "no settings.json", modelVersion: TBD, llmMode: TBD };
  }
  const settings = JSON.parse(fs.readFileSync(file, "utf8"));
  return {
    available: settings.llmMode === "byok" && Boolean(settings.apiKey || settings.deepseekApiKey),
    llmMode: settings.llmMode || TBD,
    provider: settings.provider || TBD,
    modelVersion: settings.model || settings.deepseekModel || TBD,
    baseHost: hostOf(settings.baseUrl || settings.deepseekBaseUrl || ""),
    reason: settings.llmMode === "cloud" ? "cloud session is not called from this facility" : "",
  };
}

export async function callConfiguredModel(body) {
  if (process.env.SPARO_EVAL_ALLOW_MODEL !== "1") {
    return { called: false, reason: "model call not enabled", usage: emptyUsage(), text: "" };
  }
  const described = describeConfiguredModel();
  if (!described.available) {
    return { called: false, reason: described.reason || "model unavailable", usage: emptyUsage(), text: "", described };
  }
  const file = path.join(process.env.APPDATA, "sparo-store", "settings.json");
  const settings = JSON.parse(fs.readFileSync(file, "utf8"));
  const apiKey = String(settings.apiKey || settings.deepseekApiKey || "");
  const baseUrl = String(settings.baseUrl || settings.deepseekBaseUrl || "").replace(/\/$/, "");
  const model = settings.model || settings.deepseekModel;
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: body.messages,
      temperature: 0,
    }),
  });
  const json = await response.json();
  const usage = json.usage || {};
  const cached = usage.prompt_tokens_details?.cached_tokens;
  return {
    called: response.ok,
    reason: response.ok ? "" : `http ${response.status}`,
    text: json.choices?.[0]?.message?.content || "",
    described,
    usage: {
      reportedPromptTokens: typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : TBD,
      uncachedInputTokens: numberOrTbd(usage.prompt_tokens, cached),
      cachedInputTokens: typeof cached === "number" ? cached : TBD,
      outputTokens: typeof usage.completion_tokens === "number" ? usage.completion_tokens : TBD,
      priceVersion: TBD,
      cost: TBD,
    },
  };
}

function numberOrTbd(total, cached) {
  if (typeof total !== "number" || typeof cached !== "number") return TBD;
  return Math.max(0, total - cached);
}
