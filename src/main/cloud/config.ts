const PROD_CLOUD_API = "https://southernspark.dev/sparo-api";
const LOCAL_CLOUD_API = "http://127.0.0.1:3940";

function defaultCloudApi(): string {
  // 安装包连官网；npm start 连本机。显式环境变量优先。
  const packaged = Boolean(process.versions.electron) && process.defaultApp === undefined;
  return packaged ? PROD_CLOUD_API : LOCAL_CLOUD_API;
}

export function cloudApiBase(): string {
  return (process.env.SPARO_CLOUD_API || defaultCloudApi()).replace(/\/$/, "");
}

export function usesOfficialCloud(): boolean {
  return cloudApiBase().includes("southernspark.dev");
}

export function isOfficialAccountUrl(raw: string): boolean {
  try {
    const u = new URL(String(raw || ""));
    const host = u.hostname.toLowerCase();
    if (host !== "southernspark.dev" && host !== "www.southernspark.dev") return false;
    return /\/sparo\/account\/?$/.test(u.pathname);
  } catch {
    return false;
  }
}

export function accountUrl(locale?: string, plan?: string, access?: string): string {
  const base = process.env.SPARO_ACCOUNT_URL
    ? process.env.SPARO_ACCOUNT_URL
    : String(locale || "").toLowerCase().startsWith("zh")
      ? "https://southernspark.dev/zh/sparo/account"
      : "https://southernspark.dev/sparo/account";
  let out = base;
  const id = String(plan || "").trim();
  if (id) {
    const join = out.includes("?") ? "&" : "?";
    out = `${out}${join}plan=${encodeURIComponent(id)}`;
  }
  const token = String(access || "").trim();
  if (token) {
    out = `${out}#access=${encodeURIComponent(token)}`;
  }
  return out;
}

export function isMsftChannel(): boolean {
  return process.env.STORE_CHANNEL === "msft";
}

export function chatCompletionsCloudUrl(): string {
  return `${cloudApiBase()}/v1/chat/completions`;
}
