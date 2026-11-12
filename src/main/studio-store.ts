// 媒体工作台的本地草稿、预检和台账读取。不连接平台，不写发布请求。
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";

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

export type StudioDraft = {
  id: string;
  title: string;
  summary: string;
  body: string;
  images: string[];
  cover: string;
  topics: string[];
  primaryPlatform: string;
  platforms: Record<string, { enabled: boolean }>;
  schedule: Record<string, never>;
  createdAt: string;
  updatedAt: string;
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

export function precheckDraft(draft: StudioDraft, profiles: StudioProfile[]): PrecheckRow[] {
  const selected = profiles.filter((profile) => draft.platforms[profile.id]?.enabled);
  return selected.map((profile) => {
    const marks: string[] = [];
    const problems: string[] = [];
    if (profile.limits.titleMin != null && [...draft.title].length < profile.limits.titleMin) {
      problems.push("标题短于 " + profile.limits.titleMin + " 字");
    }
    if (profile.limits.titleMax != null && [...draft.title].length > profile.limits.titleMax) {
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
    for (const item of profile.switches.required) marks.push("会勾「" + item.label + "」");
    for (const item of profile.switches.forbidden) marks.push("不勾「" + item.label + "」");
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
  writeFileSync(join(dir, "body.md"), body, "utf8");
  writeFileSync(draftFile(dir), JSON.stringify({ ...stored, body: "" }, null, 2), "utf8");
  if (draft.cover && existsSync(draft.cover)) {
    const target = join(dir, "cover" + (extname(draft.cover) || ".jpg"));
    if (resolveCopy(draft.cover, target)) stored.cover = target;
  }
  draft.images.forEach((file, index) => {
    if (!file || !existsSync(file)) return;
    const target = join(dir, "images", String(index + 1) + (extname(file) || ".jpg"));
    resolveCopy(file, target);
  });
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
