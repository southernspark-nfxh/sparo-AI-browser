import { getDeviceId, loadTokens, refreshIfNeeded } from "./auth.js";
import { chatCompletionsCloudUrl, cloudApiBase } from "./config.js";

export function hasCloudSession(configDir: string): boolean {
  return Boolean(loadTokens(configDir)?.access);
}

export async function cloudFetch(
  configDir: string,
  taskId: string,
  url: string,
  init: RequestInit,
): Promise<Response> {
  let tokens = loadTokens(configDir);
  if (!tokens) throw new Error("未登录云端模型");
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${tokens.access}`);
  headers.set("X-Sparo-Task", taskId);
  headers.set("X-Sparo-Device", getDeviceId(configDir));
  const target = url.includes("/chat/completions") ? url : `${cloudApiBase()}/v1/chat/completions`;
  let res = await fetch(target, { ...init, headers });
  if (res.status === 401) {
    tokens = await refreshIfNeeded(configDir);
    if (!tokens) return res;
    headers.set("Authorization", `Bearer ${tokens.access}`);
    res = await fetch(target, { ...init, headers });
  }
  return res;
}

export { chatCompletionsCloudUrl };
