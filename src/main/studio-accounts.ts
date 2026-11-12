/**
 * 当前环境的平台账号状态。
 * 只记录核验结论，不读取、不展示、不落盘 token 与 Cookie。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { AccountState } from "../renderer/studio/types.js";

export const ACCOUNT_STATES: readonly AccountState[] = ["checking", "ok", "login_missing", "error", "unknown"];

export const PLATFORM_BACKSTAGE: Record<string, string> = {
  toutiao: "https://mp.toutiao.com/",
  baijiahao: "https://baijiahao.baidu.com/",
  dayu: "https://mp.dayu.com/",
  sohu: "https://mp.sohu.com/",
};

const PLATFORMS = ["toutiao", "baijiahao", "dayu", "sohu"] as const;

export type AccountRecord = {
  envId: string;
  platform: string;
  state: AccountState;
  displayName: string;
  checkedAt: string;
  detail: string;
};

export type AccountError = {
  ok: false;
  code: "missing_env" | "unknown_platform" | "env_mismatch" | "bad_book";
  message: string;
  envId: string;
};

export type OpenBackstage = {
  ok: true;
  code: "ok";
  message: string;
  envId: string;
  platform: string;
  url: string;
  partition: string;
  reuseTab: false;
};

type Book = { envId: string; rows: AccountRecord[] };

export function requireEnvId(envId: unknown): { ok: true; envId: string } | AccountError {
  const id = typeof envId === "string" ? envId.trim() : "";
  if (!id) {
    return {
      ok: false,
      code: "missing_env",
      message: "还没有选择账号环境，已停止。不会改用默认登录。",
      envId: "",
    };
  }
  return { ok: true, envId: id };
}

/** 只有五个状态字面量有效。空值、别名和 unknown 都不会变成 ok。 */
export function normalizeAccountState(value: unknown): AccountState {
  if (value === "checking" || value === "ok" || value === "login_missing" || value === "error" || value === "unknown") {
    return value;
  }
  return "unknown";
}

export function accountStatusLabel(state: AccountState): string {
  if (state === "checking") return "正在核验";
  if (state === "ok") return "正常";
  if (state === "login_missing") return "登录失效";
  if (state === "error") return "核验失败";
  return "未核验";
}

export function shownAccountState(state: AccountState, checkedAt: string): AccountState {
  if (state === "ok" && !checkedAt.trim()) return "unknown";
  return state;
}

function cleanName(value: unknown): string {
  if (typeof value !== "string") return "未识别";
  const name = value.trim();
  if (!name || /cookie|token|set-cookie|authorization/i.test(name)) return "未识别";
  return [...name].slice(0, 80).join("");
}

function cleanDetail(value: unknown): string {
  if (typeof value !== "string") return "";
  const text = value.trim();
  if (!text || /cookie|token|set-cookie|authorization/i.test(text)) return "";
  return [...text].slice(0, 120).join("");
}

export function blankAccounts(envId: string, platforms: readonly string[] = PLATFORMS): AccountRecord[] {
  return platforms.map((platform) => ({
    envId,
    platform,
    state: "unknown",
    displayName: "未识别",
    checkedAt: "",
    detail: "",
  }));
}

function samePlatform(records: AccountRecord[], envId: string, platform: string): AccountRecord[] {
  if (records.some((row) => row.platform === platform && row.envId === envId)) return records;
  return records.concat(blankAccounts(envId, [platform]));
}

export function applyAccountObservation(
  records: readonly AccountRecord[],
  envId: unknown,
  observation: {
    platform?: unknown;
    state?: unknown;
    displayName?: unknown;
    checkedAt?: unknown;
    detail?: unknown;
    cookie?: unknown;
    token?: unknown;
  },
): { ok: true; rows: AccountRecord[] } | AccountError {
  const gate = requireEnvId(envId);
  if (!gate.ok) return gate;
  const platform = typeof observation.platform === "string" ? observation.platform.trim() : "";
  if (!platform || !PLATFORMS.includes(platform as (typeof PLATFORMS)[number])) {
    return { ok: false, code: "unknown_platform", message: "没有这个平台，没有改其他平台的状态。", envId: gate.envId };
  }
  const checkedAt = typeof observation.checkedAt === "string" ? observation.checkedAt.trim() : "";
  let state = normalizeAccountState(observation.state);
  state = shownAccountState(state, checkedAt);
  const nextRow: AccountRecord = {
    envId: gate.envId,
    platform,
    state,
    displayName: cleanName(observation.displayName),
    checkedAt: state === "unknown" && !checkedAt ? "" : checkedAt,
    detail: cleanDetail(observation.detail),
  };
  const base = samePlatform(records.filter((row) => row.envId === gate.envId), gate.envId, platform);
  return {
    ok: true,
    rows: base.map((row) => (row.platform === platform ? nextRow : row)),
  };
}

function sanitizeRow(row: AccountRecord, envId: string): AccountRecord {
  const checkedAt = typeof row?.checkedAt === "string" ? row.checkedAt : "";
  const state = shownAccountState(normalizeAccountState(row?.state), checkedAt);
  return {
    envId,
    platform: typeof row?.platform === "string" ? row.platform : "",
    state,
    displayName: cleanName(row?.displayName),
    checkedAt,
    detail: cleanDetail(row?.detail),
  };
}

export function readAccountBook(file: string, envId: unknown): { ok: true; rows: AccountRecord[] } | AccountError {
  const gate = requireEnvId(envId);
  if (!gate.ok) return gate;
  if (!existsSync(file)) return { ok: true, rows: blankAccounts(gate.envId) };
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Book;
    if (!parsed || parsed.envId !== gate.envId) {
      return {
        ok: false,
        code: "env_mismatch",
        message: "这份账号状态属于另一个环境，已停止。不会拿来当作当前环境。",
        envId: gate.envId,
      };
    }
    const rows = Array.isArray(parsed.rows) ? parsed.rows.map((row) => sanitizeRow(row, gate.envId)) : blankAccounts(gate.envId);
    return { ok: true, rows };
  } catch {
    return { ok: false, code: "bad_book", message: "账号状态读不出来，没有改成正常。", envId: gate.envId };
  }
}

export function writeAccountBook(file: string, envId: unknown, records: readonly AccountRecord[]): { ok: true; envId: string } | AccountError {
  const gate = requireEnvId(envId);
  if (!gate.ok) return gate;
  const rows = records
    .filter((row) => row.envId === gate.envId)
    .map((row) => sanitizeRow(row, gate.envId));
  const payload: Book = { envId: gate.envId, rows };
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(payload, null, 2), "utf8");
  return { ok: true, envId: gate.envId };
}

export function openBackstage(envId: unknown, platform: unknown): OpenBackstage | AccountError {
  const gate = requireEnvId(envId);
  if (!gate.ok) return gate;
  const id = typeof platform === "string" ? platform.trim() : "";
  const url = PLATFORM_BACKSTAGE[id];
  if (!url) {
    return { ok: false, code: "unknown_platform", message: "没有这个平台的后台。", envId: gate.envId };
  }
  return {
    ok: true,
    code: "ok",
    message: "",
    envId: gate.envId,
    platform: id,
    url,
    partition: "persist:env_" + gate.envId,
    reuseTab: false,
  };
}
