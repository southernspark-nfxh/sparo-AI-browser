export function cloudApiBase(): string {
  return (process.env.SPARO_CLOUD_API || "http://127.0.0.1:3940").replace(/\/$/, "");
}

export function accountUrl(): string {
  return process.env.SPARO_ACCOUNT_URL || "https://southernspark.dev/sparo/account";
}

export function isMsftChannel(): boolean {
  return process.env.STORE_CHANNEL === "msft";
}

export function chatCompletionsCloudUrl(): string {
  return `${cloudApiBase()}/v1/chat/completions`;
}
