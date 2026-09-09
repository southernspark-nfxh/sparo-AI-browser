import { fetchMe, getDeviceId, loadTokens, refreshIfNeeded } from "./auth.js";
import { cloudApiBase } from "./config.js";
import { sanitizePlans, type CloudPlanPublic } from "./pricing.js";
import type { QuotaSnap } from "./auth.js";

export type CloudTask = {
  taskId: string;
  snap: QuotaSnap;
};

async function authed(
  configDir: string,
  path: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  let tokens = loadTokens(configDir);
  if (!tokens) throw new Error("未登录云端模型");
  const call = async (access: string) => {
    const res = await fetch(`${cloudApiBase()}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${access}`,
        "X-Sparo-Device": getDeviceId(configDir),
      },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { res, json };
  };
  let { res, json } = await call(tokens.access);
  if (res.status === 401) {
    tokens = await refreshIfNeeded(configDir);
    if (!tokens) throw new Error("请重新登录云端模型");
    ({ res, json } = await call(tokens.access));
  }
  if (!res.ok) {
    throw new Error(String(json.error || json.message || `HTTP ${res.status}`));
  }
  return json;
}

export async function assertAndStartTask(configDir: string): Promise<CloudTask> {
  const json = await authed(configDir, "/tasks/start", { kind: "chat" });
  return {
    taskId: String(json.taskId || ""),
    snap: {
      canStart: true,
      points: Number(json.points || 0),
      bonus: Number(json.bonus || 0),
      approxTasks: Number(json.approxTasks || 0),
      trial: (json.trial as QuotaSnap["trial"]) || { used: 0, left: 0, cap: 0 },
      subscription: (json.subscription as QuotaSnap["subscription"]) || {
        active: false,
        plan: null,
      },
    },
  };
}

export async function settleCloudTask(
  configDir: string,
  taskId: string,
): Promise<{ approxTasksUsed: number; approxTasks: number; points: number }> {
  const json = await authed(configDir, "/tasks/settle", { taskId });
  const me = await fetchMe(configDir);
  return {
    approxTasksUsed: Number(json.approxTasksUsed || 0),
    approxTasks: me?.approxTasks ?? 0,
    points: Number(json.points || 0),
  };
}

export async function fetchCloudPlans(): Promise<CloudPlanPublic[]> {
  try {
    const res = await fetch(`${cloudApiBase()}/plans`);
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return sanitizePlans(json.plans);
  } catch {
    return [];
  }
}

export async function createCloudCheckout(
  configDir: string,
  plan: string,
  type = "alipay",
): Promise<{ payUrl?: string; plan?: string; money?: string }> {
  const json = await authed(configDir, "/pay/create", { plan, type });
  return {
    payUrl: json.payUrl ? String(json.payUrl) : undefined,
    plan: json.plan ? String(json.plan) : plan,
    money: json.money ? String(json.money) : undefined,
  };
}
