/**
 * 工作台唯一的环境校验入口。
 * 缺 envId 或环境不存在就停止，不回退到默认登录态。
 */
import { createHash } from "node:crypto";
import { getEnv, listEnvs } from "./envs/store.js";
import type { PrecheckResult, PrecheckRow } from "../renderer/studio/types.js";

export type StudioEnvOk = {
  ok: true;
  code: "ok";
  message: string;
  envId: string;
  name: string;
};

export type StudioEnvError = {
  ok: false;
  code: "missing_env" | "unknown_env";
  message: string;
  envId: string;
};

export type HashDraft = {
  title?: string;
  summary?: string;
  body?: string;
  cover?: string;
  images?: string[];
  platforms?: Record<string, { enabled?: boolean }>;
};

export function listStudioEnvs(configDir: string): Array<{ envId: string; name: string }> {
  return listEnvs(configDir).map((env) => ({
    envId: env.id,
    name: env.account?.name || env.id,
  }));
}

export function resolveStudioEnv(configDir: string, envId: unknown): StudioEnvOk | StudioEnvError {
  const id = typeof envId === "string" ? envId.trim() : "";
  if (!id) {
    return {
      ok: false,
      code: "missing_env",
      message: "还没有选择账号环境，已停止。不会改用默认登录。",
      envId: "",
    };
  }
  const env = getEnv(configDir, id);
  if (!env || env.id !== id) {
    return {
      ok: false,
      code: "unknown_env",
      message: "这个账号环境不存在，已停止。不会改用默认登录。",
      envId: id,
    };
  }
  return { ok: true, code: "ok", message: "", envId: env.id, name: env.account?.name || env.id };
}

/** 只接受列表里真实存在的 envId。空列表或对不上时返回空字符串。 */
export function initialEnvChoice(
  available: Array<{ envId: string }>,
  requested: string,
): string {
  const id = requested.trim();
  if (id && available.some((item) => item.envId === id)) return id;
  if (!id && available.length === 1) return available[0].envId;
  return "";
}

export function snapshotHash(envId: string, draft: HashDraft): string {
  const platforms = Object.keys(draft.platforms || {}).sort();
  const enabled: Record<string, boolean> = {};
  for (const name of platforms) enabled[name] = Boolean(draft.platforms?.[name]?.enabled);
  const body = JSON.stringify({
    envId,
    title: draft.title || "",
    summary: draft.summary || "",
    body: draft.body || "",
    cover: draft.cover || "",
    images: draft.images || [],
    platforms: enabled,
  });
  return createHash("sha256").update(body).digest("hex");
}

export function buildPrecheckResult(input: {
  precheckId: string;
  envId: string;
  draftRevision: number;
  draft: HashDraft;
  rows: PrecheckRow[];
}): PrecheckResult {
  const platforms = Object.entries(input.draft.platforms || {})
    .filter(([, item]) => item?.enabled)
    .map(([id]) => id);
  return {
    ok: true,
    code: "ok",
    message: "",
    precheckId: input.precheckId,
    envId: input.envId,
    draftRevision: input.draftRevision,
    snapshotHash: snapshotHash(input.envId, input.draft),
    platforms,
    rows: input.rows,
  };
}

export function unsupported(envId: string, message: string): {
  ok: false;
  code: "unsupported";
  message: string;
  envId: string;
} {
  return { ok: false, code: "unsupported", message, envId };
}
