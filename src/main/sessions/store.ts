/**
 * Logged-in site session registry (metadata only — cookies stay in Chromium store).
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  statSync,
} from "node:fs";
import { join } from "node:path";

export type SessionSite = {
  id: string;
  title: string;
  homeUrl: string;
  domains: string[];
  cookieCount?: number;
  cookieNames?: string[];
  verifiedAt?: string;
  note?: string;
};

export type SessionsFile = {
  updatedAt: string;
  userDataHint: string;
  sites: SessionSite[];
};

export const DEFAULT_SESSION_SITES: SessionSite[] = [
  {
    id: "xiaohongshu",
    title: "小红书",
    homeUrl: "https://creator.xiaohongshu.com/publish/publish?target=article",
    domains: ["xiaohongshu.com", ".xiaohongshu.com", "creator.xiaohongshu.com"],
    note: "创作平台长文发布",
  },
  {
    id: "weibo",
    title: "微博",
    homeUrl: "https://weibo.com/",
    domains: ["weibo.com", ".weibo.com", "sina.com.cn", ".sina.com.cn"],
    note: "weibo.com 主站",
  },
  {
    id: "zhihu",
    title: "知乎",
    homeUrl: "https://www.zhihu.com/",
    domains: ["zhihu.com", ".zhihu.com", "www.zhihu.com"],
    note: "知乎主站",
  },
];

export function sessionsPath(configDir: string): string {
  return join(configDir, "sessions.json");
}

export function loadSessions(configDir: string): SessionsFile {
  const p = sessionsPath(configDir);
  if (!existsSync(p)) {
    return {
      updatedAt: new Date(0).toISOString(),
      userDataHint: configDir,
      sites: DEFAULT_SESSION_SITES.map((s) => ({ ...s })),
    };
  }
  try {
    const raw = JSON.parse(readFileSync(p, "utf8")) as SessionsFile;
    return {
      updatedAt: raw.updatedAt || new Date(0).toISOString(),
      userDataHint: raw.userDataHint || configDir,
      sites: Array.isArray(raw.sites) ? raw.sites : DEFAULT_SESSION_SITES.map((s) => ({ ...s })),
    };
  } catch {
    return {
      updatedAt: new Date(0).toISOString(),
      userDataHint: configDir,
      sites: DEFAULT_SESSION_SITES.map((s) => ({ ...s })),
    };
  }
}

export function saveSessionsFile(configDir: string, data: SessionsFile): void {
  mkdirSync(configDir, { recursive: true });
  writeFileSync(sessionsPath(configDir), JSON.stringify(data, null, 2), "utf8");
}

/** One-time: copy Chromium Network cookies from old Electron userData name. */
export function migrateCookiesFromLegacyUserData(configDir: string): {
  migrated: boolean;
  from?: string;
  message: string;
} {
  const legacy =
    process.platform === "win32" && process.env.APPDATA
      ? join(process.env.APPDATA, "Sparo Agent Browser")
      : "";
  if (!legacy || legacy === configDir || !existsSync(legacy)) {
    return { migrated: false, message: "no legacy userData" };
  }
  const srcNet = join(legacy, "Network");
  const dstNet = join(configDir, "Network");
  const srcCookies = join(srcNet, "Cookies");
  const dstCookies = join(dstNet, "Cookies");
  if (!existsSync(srcCookies)) {
    return { migrated: false, from: legacy, message: "legacy has no Cookies" };
  }
  mkdirSync(dstNet, { recursive: true });
  let srcStat: { mtimeMs: number; size: number } | null = null;
  let dstStat: { mtimeMs: number; size: number } | null = null;
  try {
    const s = statSync(srcCookies);
    srcStat = { mtimeMs: s.mtimeMs, size: s.size };
  } catch {
    srcStat = null;
  }
  if (existsSync(dstCookies)) {
    try {
      const s = statSync(dstCookies);
      dstStat = { mtimeMs: s.mtimeMs, size: s.size };
    } catch {
      dstStat = null;
    }
  }
  // Prefer newer / larger cookie DB
  if (dstStat && srcStat && dstStat.mtimeMs >= srcStat.mtimeMs && dstStat.size >= srcStat.size) {
    return { migrated: false, from: legacy, message: "destination cookies already newer" };
  }
  try {
    copyFileSync(srcCookies, dstCookies);
    const journal = join(srcNet, "Cookies-journal");
    if (existsSync(journal)) {
      copyFileSync(journal, join(dstNet, "Cookies-journal"));
    }
    const nps = join(srcNet, "Network Persistent State");
    if (existsSync(nps)) {
      copyFileSync(nps, join(dstNet, "Network Persistent State"));
    }
    return { migrated: true, from: legacy, message: "copied Network/Cookies from Sparo Agent Browser" };
  } catch (e) {
    return {
      migrated: false,
      from: legacy,
      message: e instanceof Error ? e.message : String(e),
    };
  }
}
