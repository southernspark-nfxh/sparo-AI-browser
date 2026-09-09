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

export function accountUrl(locale?: string, plan?: string): string {
  const base = process.env.SPARO_ACCOUNT_URL
    ? process.env.SPARO_ACCOUNT_URL
    : String(locale || "").toLowerCase().startsWith("zh")
      ? "https://southernspark.dev/zh/sparo/account"
      : "https://southernspark.dev/sparo/account";
  if (!plan) return base;
  const join = base.includes("?") ? "&" : "?";
  return `${base}${join}plan=${encodeURIComponent(plan)}`;
}

export function isMsftChannel(): boolean {
  return process.env.STORE_CHANNEL === "msft";
}

export function chatCompletionsCloudUrl(): string {
  return `${cloudApiBase()}/v1/chat/completions`;
}
