// 媒体工作台的本地草稿、预检和台账读取。不连接平台，不写发布请求。
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { normalizeAccountState, shownAccountState } from "./studio-accounts.js";
import { buildPrecheckResult, snapshotHash } from "./studio-env.js";
import type { AccountState, PrecheckResult } from "../renderer/studio/types.js";

export type SwitchItem = { id: string; label: string };

export type StudioProfile = {
  id: string;
  name: string;
  limits: {
    titleMin: number | null;
    titleMax: number | null;
    bodyMax: number | null;
    imagesMax: number | null;
    perDay: number | null;
    minGapMinutes: number | null;
  };
  image: {
    rehost: boolean | null;
    stripExternal: boolean | null;
    minDistinctImages: number | null;
    coverMode: string;
  };
  switches: {
    required: SwitchItem[];
    forbidden: SwitchItem[];
    defaults: SwitchItem[];
  };
};

export type PlatformSettings = {
  enabled: boolean;
  title?: string;
  category?: string;
  original?: boolean | null;
  confirmed?: string[];
};

export type StudioDraft = {
  id: string;
  title: string;
  summary: string;
  body: string;
  images: string[];
  cover: string;
  topics: string[];
  primaryPlatform: string;
  platforms: Record<string, PlatformSettings>;
  schedule: Record<string, never>;
  createdAt: string;
  updatedAt: string;
  envId?: string;
  revision?: number;
  association?: "linked" | "unlinked";
  legacyOwner?: string;
};

export type PrecheckOptions = {
  accounts?: Array<{ platform: string; state?: unknown; checkedAt?: string }>;
  /** 为 true 时，登录态未知按未核验处理，必选项未确认不能当成已勾。 */
  strict?: boolean;
};

export type PrecheckRow = {
  platform: string;
  name: string;
  level: "ok" | "warn";
  marks: string[];
  skip: boolean;
};

export type LedgerRow = {
  at?: string;
  platform?: string;
  title?: string;
  ok?: boolean;
  reason?: string;
  hint?: string;
  step?: string;
};

const COVER_FILE = new Set(["硬校验，必须回读到图", "单图", "1张"]);

export function emptyDraft(id: string, now = new Date().toISOString()): StudioDraft {
  return {
    id,
    title: "",
    summary: "",
    body: "",
    images: [],
    cover: "",
    topics: [],
    primaryPlatform: "toutiao",
    platforms: {
      toutiao: { enabled: true },
      baijiahao: { enabled: true },
      dayu: { enabled: true },
      sohu: { enabled: true },
    },
    schedule: {},
    createdAt: now,
    updatedAt: now,
  };
}

export function readProfiles(dir: string): StudioProfile[] {
  const ids = ["toutiao", "baijiahao", "dayu", "sohu"];
  return ids.map((id) => JSON.parse(readFileSync(join(dir, id + ".json"), "utf8")) as StudioProfile);
}

function needsCoverFile(profile: StudioProfile): boolean {
  return COVER_FILE.has(profile.image.coverMode);
}

function effectiveTitle(draft: StudioDraft, platform: string): string {
  const custom = draft.platforms[platform]?.title;
  if (typeof custom === "string" && custom.trim()) return custom;
  return draft.title;
}

function confirmedSwitches(draft: StudioDraft, platform: string): string[] {
  const list = draft.platforms[platform]?.confirmed;
  return Array.isArray(list) ? list.filter((item) => typeof item === "string") : [];
}

function loginMark(state: AccountState): string {
  if (state === "login_missing") return "未登录，只跳过这个平台";
  if (state === "error") return "登录核验失败";
  if (state === "checking") return "正在核验登录";
  return "登录态未核验";
}

export function precheckDraft(draft: StudioDraft, profiles: StudioProfile[], options?: PrecheckOptions): PrecheckRow[] {
  const selected = profiles.filter((profile) => draft.platforms[profile.id]?.enabled);
  return selected.map((profile) => {
    const marks: string[] = [];
    const problems: string[] = [];
    const title = effectiveTitle(draft, profile.id);
    if (profile.limits.titleMin != null && [...title].length < profile.limits.titleMin) {
      problems.push("标题短于 " + profile.limits.titleMin + " 字");
    }
    if (profile.limits.titleMax != null && [...title].length > profile.limits.titleMax) {
      problems.push("标题超过 " + profile.limits.titleMax + " 字");
    }
    if (profile.limits.bodyMax != null && [...draft.body].length > profile.limits.bodyMax) {
      problems.push("正文超过 " + profile.limits.bodyMax + " 字");
    }
    const distinct = new Set(draft.images.filter(Boolean)).size;
    if (profile.image.minDistinctImages != null && distinct < profile.image.minDistinctImages) {
      problems.push("不同图 " + distinct + " 张，需要 " + profile.image.minDistinctImages + " 张");
    }
    if (needsCoverFile(profile) && !draft.cover) {
      problems.push("缺封面");
    } else if (draft.cover && needsCoverFile(profile)) {
      marks.push("封面已选");
    }
    if (profile.image.coverMode) marks.push(profile.image.coverMode);
    const confirmed = confirmedSwitches(draft, profile.id);
    if (options?.strict) {
      for (const item of profile.switches.required) {
        if (confirmed.includes(item.id)) marks.push("已确认「" + item.label + "」");
        else problems.push("还没确认「" + item.label + "」");
      }
      for (const item of profile.switches.forbidden) {
        if (confirmed.includes(item.id)) problems.push("不能勾「" + item.label + "」");
        else marks.push("不勾「" + item.label + "」");
      }
    } else {
      for (const item of profile.switches.required) marks.push("会勾「" + item.label + "」");
      for (const item of profile.switches.forbidden) marks.push("不勾「" + item.label + "」");
    }
    if (options?.strict) {
      const hint = options.accounts?.find((item) => item.platform === profile.id);
      const state = shownAccountState(normalizeAccountState(hint?.state), hint?.checkedAt || "");
      if (state === "ok") marks.push("登录正常");
      else problems.push(loginMark(state));
    }
    if (draft.primaryPlatform === profile.id) marks.push("首发");
    const warn = problems.length > 0;
    return {
      platform: profile.id,
      name: profile.name,
      level: warn ? "warn" : "ok",
      marks: warn ? problems.concat(marks) : ["预检通过"].concat(marks),
      skip: warn,
    };
  });
}

export function overviewFrom(draftCount: number, failures: number): { pending: number; failed: number; login: string } {
  return { pending: draftCount, failed: failures, login: "未检查" };
}

export function readLedgerDir(dir: string): LedgerRow[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".jsonl"))
    .flatMap((name) => readLedger(join(dir, name)));
}

export function readLedger(file: string): LedgerRow[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as LedgerRow;
      } catch {
        return { ok: false, hint: "台账有一行读不了" };
      }
    });
}

function draftFile(dir: string): string {
  return join(dir, "draft.json");
}

export function loadDraftDir(dir: string): StudioDraft | null {
  const file = draftFile(dir);
  if (existsSync(file)) {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as StudioDraft;
    const bodyFile = join(dir, "body.md");
    if (existsSync(bodyFile)) parsed.body = readFileSync(bodyFile, "utf8");
    return parsed;
  }
  const titleFile = join(dir, "title.txt");
  const bodyFile = join(dir, "body.md");
  if (!existsSync(titleFile) && !existsSync(bodyFile)) return null;
  const draft = emptyDraft(basename(dir));
  if (existsSync(titleFile)) draft.title = readFileSync(titleFile, "utf8").trim();
  if (existsSync(bodyFile)) draft.body = readFileSync(bodyFile, "utf8");
  return draft;
}

export function saveDraftDir(root: string, draft: StudioDraft): string {
  const dir = join(root, draft.id);
  mkdirSync(join(dir, "images"), { recursive: true });
  const body = draft.body || "";
  const stored: StudioDraft = { ...draft, body, schedule: {}, updatedAt: new Date().toISOString() };
  if (draft.cover && existsSync(draft.cover)) {
    const target = join(dir, "cover" + (extname(draft.cover) || ".jpg"));
    if (resolveCopy(draft.cover, target)) stored.cover = target;
  }
  stored.images = draft.images.map((file, index) => {
    if (!file || !existsSync(file)) return file;
    const target = join(dir, "images", String(index + 1) + (extname(file) || ".jpg"));
    return resolveCopy(file, target) ? target : file;
  });
  writeFileSync(join(dir, "body.md"), body, "utf8");
  writeFileSync(draftFile(dir), JSON.stringify({ ...stored, body: "" }, null, 2), "utf8");
  return dir;
}

function resolveCopy(from: string, to: string): boolean {
  if (from === to) return true;
  try {
    copyFileSync(from, to);
    return true;
  } catch {
    return false;
  }
}

export function listDrafts(root: string): StudioDraft[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => loadDraftDir(join(root, entry.name)))
    .filter((draft): draft is StudioDraft => Boolean(draft));
}

export function failureCount(rows: LedgerRow[]): number {
  return rows.filter((row) => row.ok === false).length;
}

export type DraftStop = {
  ok: false;
  code: "missing_env" | "unknown_env" | "env_mismatch" | "stale_revision" | "unlinked" | "stale_precheck" | "blocked" | "io";
  message: string;
  envId: string;
};

export type DraftSave = {
  ok: true;
  code: "ok";
  message: string;
  envId: string;
  revision: number;
  savedAt: string;
  draft: StudioDraft;
};

export type Ownership = {
  association: "linked" | "unlinked";
  envId: string;
  label: string;
};

const STOP_ENV = "还没有选择账号环境，已停止。不会改用默认登录。";
const STOP_UNKNOWN = "这个账号环境不存在，已停止。不会改用默认登录。";

type LooseDraft = StudioDraft & Record<string, unknown>;

function envGate(envId: unknown, knownEnvIds?: readonly string[]): { ok: true; envId: string } | DraftStop {
  const id = typeof envId === "string" ? envId.trim() : "";
  if (!id) return { ok: false, code: "missing_env", message: STOP_ENV, envId: "" };
  if (knownEnvIds && !knownEnvIds.includes(id)) {
    return { ok: false, code: "unknown_env", message: STOP_UNKNOWN, envId: id };
  }
  return { ok: true, envId: id };
}

export function profileView(profile: StudioProfile): {
  id: string;
  name: string;
  titleMin: number | null;
  titleMax: number | null;
  bodyMax: number | null;
  coverMode: string;
  needsCover: boolean;
  minDistinctImages: number | null;
  required: SwitchItem[];
  forbidden: SwitchItem[];
  defaults: SwitchItem[];
} {
  return {
    id: profile.id,
    name: profile.name,
    titleMin: profile.limits.titleMin,
    titleMax: profile.limits.titleMax,
    bodyMax: profile.limits.bodyMax,
    coverMode: profile.image.coverMode,
    needsCover: needsCoverFile(profile),
    minDistinctImages: profile.image.minDistinctImages,
    required: profile.switches.required,
    forbidden: profile.switches.forbidden,
    defaults: profile.switches.defaults,
  };
}

export function contentStamp(envId: string, draft: StudioDraft): string {
  const options: Record<string, { title: string; category: string; original: boolean | null; confirmed: string[] }> = {};
  for (const id of Object.keys(draft.platforms).sort()) {
    const item = draft.platforms[id];
    options[id] = {
      title: item?.title || "",
      category: item?.category || "",
      original: item?.original ?? null,
      confirmed: [...(item?.confirmed || [])].filter((entry) => typeof entry === "string").sort(),
    };
  }
  return createHash("sha256")
    .update(JSON.stringify({
      base: snapshotHash(envId, draft),
      primaryPlatform: draft.primaryPlatform || "",
      topics: draft.topics || [],
      options,
    }))
    .digest("hex");
}

export function precheckCurrent(
  precheck: PrecheckResult & { contentStamp?: string },
  envId: string,
  draft: StudioDraft,
): boolean {
  if (!envId || precheck.envId !== envId) return false;
  if (draft.association === "unlinked" || (draft.envId || "") !== envId) return false;
  if (precheck.draftRevision !== (draft.revision ?? 0)) return false;
  if (!precheck.contentStamp || precheck.contentStamp !== contentStamp(envId, draft)) return false;
  if (precheck.snapshotHash !== snapshotHash(envId, draft)) return false;
  const selected = Object.entries(draft.platforms)
    .filter(([, item]) => item?.enabled)
    .map(([id]) => id)
    .sort();
  return selected.join("\n") === [...precheck.platforms].sort().join("\n");
}

export function resolveOwnership(raw: Record<string, unknown>, knownEnvIds: readonly string[]): { draft: Record<string, unknown>; ownership: Ownership } {
  const draft: Record<string, unknown> = { ...raw };
  const declared = typeof raw.envId === "string" ? raw.envId.trim() : "";
  const legacy = typeof raw.legacyOwner === "string" ? raw.legacyOwner.trim() : "";
  if (declared) {
    draft.envId = declared;
    draft.association = "linked";
    return { draft, ownership: { association: "linked", envId: declared, label: "" } };
  }
  if (legacy && knownEnvIds.includes(legacy)) {
    draft.envId = legacy;
    draft.association = "linked";
    return { draft, ownership: { association: "linked", envId: legacy, label: "" } };
  }
  delete draft.envId;
  draft.association = "unlinked";
  return { draft, ownership: { association: "unlinked", envId: "", label: "未关联" } };
}

export function readOwnershipProof(dir: string): string {
  const file = join(dir, "env.txt");
  if (!existsSync(file)) return "";
  const text = readFileSync(file, "utf8").trim();
  if (!text || /\s/.test(text)) return "";
  return text;
}

export function migrateDraftDir(dir: string, knownEnvIds: readonly string[]): Ownership {
  const loaded = loadDraftDir(dir) as LooseDraft | null;
  if (!loaded) return { association: "unlinked", envId: "", label: "未关联" };
  const proof = readOwnershipProof(dir);
  if (!loaded.envId && !loaded.legacyOwner && proof && knownEnvIds.includes(proof)) loaded.legacyOwner = proof;
  const resolved = resolveOwnership(loaded, knownEnvIds);
  const next = resolved.draft as LooseDraft;
  next.id = loaded.id || basename(dir);
  next.association = resolved.ownership.association;
  if (resolved.ownership.association === "unlinked") delete next.envId;
  else next.envId = resolved.ownership.envId;
  saveDraftDir(join(dir, ".."), next);
  return resolved.ownership;
}

export function splitDraftsByEnv<T extends { envId?: string; association?: "linked" | "unlinked" }>(
  drafts: readonly T[],
  envId: string,
): { owned: T[]; unlinked: T[] } {
  if (!envId.trim()) return { owned: [], unlinked: [] };
  const owned: T[] = [];
  const unlinked: T[] = [];
  for (const item of drafts) {
    if (item.association === "unlinked" || !item.envId) unlinked.push(item);
    else if (item.envId === envId) owned.push(item);
  }
  return { owned, unlinked };
}

function draftRef(draft: StudioDraft | null): { linked: boolean; envId: string } {
  if (!draft || draft.association === "unlinked" || !draft.envId?.trim()) return { linked: false, envId: "" };
  return { linked: true, envId: draft.envId.trim() };
}

export function createStudioDraft(
  root: string,
  id: string,
  envId: string,
  knownEnvIds?: readonly string[],
  now = new Date().toISOString(),
): DraftSave | DraftStop {
  const gate = envGate(envId, knownEnvIds);
  if (!gate.ok) return gate;
  const draft = emptyDraft(id, now);
  draft.envId = gate.envId;
  draft.association = "linked";
  draft.revision = 0;
  try {
    saveDraftDir(root, draft);
  } catch {
    return { ok: false, code: "io", message: "草稿没有写成。", envId: gate.envId };
  }
  const stored = loadDraftDir(join(root, id)) || draft;
  return {
    ok: true,
    code: "ok",
    message: "已新建",
    envId: gate.envId,
    revision: stored.revision ?? 0,
    savedAt: stored.updatedAt,
    draft: stored,
  };
}

export function saveStudioDraft(
  root: string,
  input: { envId: string; draft: StudioDraft; revision: number; knownEnvIds?: readonly string[] },
): DraftSave | DraftStop {
  const gate = envGate(input.envId, input.knownEnvIds);
  if (!gate.ok) return gate;
  const previous = input.draft.id ? (loadDraftDir(join(root, input.draft.id)) as LooseDraft | null) : null;
  const link = draftRef(previous);
  if (link.linked && link.envId !== gate.envId) {
    return {
      ok: false,
      code: "env_mismatch",
      message: "这篇草稿属于另一个环境，没有写入当前环境。",
      envId: gate.envId,
    };
  }
  const currentRevision = typeof previous?.revision === "number" ? previous.revision : 0;
  if (previous && currentRevision !== input.revision) {
    return { ok: false, code: "stale_revision", message: "稿件已在别处保存，这次没有覆盖。", envId: gate.envId };
  }
  const merged: LooseDraft = { ...(previous || {}), ...(input.draft as LooseDraft) };
  merged.id = previous?.id || input.draft.id;
  merged.createdAt = previous?.createdAt || input.draft.createdAt;
  merged.schedule = {};
  merged.revision = currentRevision + 1;
  const stayUnlinked = (previous && !link.linked) || (!previous && input.draft.association === "unlinked");
  if (stayUnlinked) {
    merged.association = "unlinked";
    delete merged.envId;
  } else {
    merged.association = "linked";
    merged.envId = gate.envId;
  }
  try {
    saveDraftDir(root, merged);
  } catch {
    return { ok: false, code: "io", message: "未保存", envId: gate.envId };
  }
  const stored = (loadDraftDir(join(root, merged.id)) as LooseDraft | null) || merged;
  const unlinked = stored.association === "unlinked" || !stored.envId;
  return {
    ok: true,
    code: "ok",
    message: unlinked ? "已保存。这篇草稿仍未关联环境。" : "已保存",
    envId: gate.envId,
    revision: stored.revision ?? merged.revision,
    savedAt: stored.updatedAt,
    draft: stored,
  };
}

export function inspectDraft(input: {
  precheckId: string;
  envId: string;
  draft: StudioDraft;
  revision: number;
  profiles: StudioProfile[];
  accounts?: Array<{ platform: string; state?: unknown; checkedAt?: string }>;
  knownEnvIds?: readonly string[];
}): (PrecheckResult & { contentStamp: string }) | DraftStop {
  const gate = envGate(input.envId, input.knownEnvIds);
  if (!gate.ok) return gate;
  const link = draftRef(input.draft);
  if (!link.linked) {
    return { ok: false, code: "unlinked", message: "这篇草稿未关联环境，不会放进当前环境做预检。", envId: gate.envId };
  }
  if (link.envId !== gate.envId) {
    return { ok: false, code: "env_mismatch", message: "这篇草稿属于另一个环境，已停止。", envId: gate.envId };
  }
  if ((input.draft.revision ?? 0) !== input.revision) {
    return { ok: false, code: "stale_revision", message: "稿件已改，请重新预检。", envId: gate.envId };
  }
  const rows = precheckDraft(input.draft, input.profiles, { strict: true, accounts: input.accounts });
  const ready = rows.filter((row) => row.level === "ok" && !row.skip).length;
  const result = buildPrecheckResult({
    precheckId: input.precheckId,
    envId: gate.envId,
    draftRevision: input.revision,
    draft: input.draft,
    rows,
  });
  return Object.assign(result, {
    contentStamp: contentStamp(gate.envId, input.draft),
    message: ready ? "当前可发布 " + ready + " 个平台。需处理的平台会跳过。" : "这次没有可直接发布的平台。",
  });
}

export function sealConfirmation(
  dir: string,
  input: {
    envId: string;
    precheck: PrecheckResult & { contentStamp?: string };
    draft: StudioDraft;
    confirmationId: string;
  },
): {
  ok: true;
  code: "ok";
  message: string;
  envId: string;
  confirmationId: string;
  precheckId: string;
  wroteToPlatform: false;
  publishRun: null;
  publishable: string[];
  skipped: string[];
} | DraftStop {
  const gate = envGate(input.envId);
  if (!gate.ok) return gate;
  if (!input.confirmationId || !input.precheck.precheckId) {
    return { ok: false, code: "stale_precheck", message: "请先预检，再确认。", envId: gate.envId };
  }
  if (!precheckCurrent(input.precheck, gate.envId, input.draft)) {
    return { ok: false, code: "stale_precheck", message: "这份预检已经失效，请重新预检。", envId: gate.envId };
  }
  const publishable = input.precheck.rows.filter((row) => row.level === "ok" && !row.skip).map((row) => row.platform);
  const skipped = input.precheck.rows.filter((row) => row.skip || row.level !== "ok").map((row) => row.platform);
  if (!publishable.length) {
    return { ok: false, code: "blocked", message: "还有平台没准备好，不能跳过必填项直接发布。", envId: gate.envId };
  }
  const file = join(dir, "confirmed.json");
  if (existsSync(file)) {
    try {
      const prev = JSON.parse(readFileSync(file, "utf8")) as { confirmationId?: string; envId?: string };
      if (prev.confirmationId === input.confirmationId && prev.envId === gate.envId) {
        return {
          ok: true,
          code: "ok",
          message: "确认已记下。这一步不向平台写稿。",
          envId: gate.envId,
          confirmationId: input.confirmationId,
          precheckId: input.precheck.precheckId,
          wroteToPlatform: false,
          publishRun: null,
          publishable,
          skipped,
        };
      }
    } catch {
      /* 坏掉的确认单不拿来当成新的发布批次 */
    }
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, JSON.stringify({
    at: new Date().toISOString(),
    envId: gate.envId,
    precheckId: input.precheck.precheckId,
    confirmationId: input.confirmationId,
    draftRevision: input.precheck.draftRevision,
    snapshotHash: input.precheck.snapshotHash,
    publishable,
    skipped,
    wroteToPlatform: false,
    publishRun: null,
  }, null, 2), "utf8");
  return {
    ok: true,
    code: "ok",
    message: "确认已记下。这一步不向平台写稿，也不代你点发布。",
    envId: gate.envId,
    confirmationId: input.confirmationId,
    precheckId: input.precheck.precheckId,
    wroteToPlatform: false,
    publishRun: null,
    publishable,
    skipped,
  };
}

export function applyImageEdit(
  draft: StudioDraft,
  edit:
    | { op: "add"; files: string[] }
    | { op: "remove"; index: number }
    | { op: "move"; index: number; direction: -1 | 1 }
    | { op: "set-cover"; file: string }
    | { op: "clear-cover" },
): StudioDraft {
  const next: StudioDraft = { ...draft, images: [...draft.images], schedule: {} };
  if (edit.op === "add") {
    for (const file of edit.files) {
      const clean = file.trim();
      if (clean && !next.images.includes(clean)) next.images.push(clean);
    }
  } else if (edit.op === "remove") {
    if (edit.index >= 0 && edit.index < next.images.length) next.images.splice(edit.index, 1);
  } else if (edit.op === "move") {
    const to = edit.index + edit.direction;
    if (edit.index >= 0 && to >= 0 && edit.index < next.images.length && to < next.images.length) {
      const [item] = next.images.splice(edit.index, 1);
      next.images.splice(to, 0, item);
    }
  } else if (edit.op === "set-cover") {
    next.cover = edit.file.trim();
  } else if (edit.op === "clear-cover") {
    next.cover = "";
  }
  next.title = draft.title;
  next.body = draft.body;
  return next;
}
