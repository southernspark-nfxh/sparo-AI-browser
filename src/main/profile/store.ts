/**
 * Profile IO: load/save the user profile, plus the small mutations Sparo
 * applies as it watches the user browse and chat.
 *
 * The file lives at `<configDir>/profile.json`. It is the only place Sparo
 * keeps "who the user is" — settings.json stays for the LLM provider config.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  emptyProfile,
  mergeAccounts,
  profileBrief,
  pushVisit,
  recomputeLearned,
  type AccountRef,
  type LearnedProfile,
  type ProfileFile,
  type UserIdentity,
  type Visit,
} from "./signals.js";

function profilePath(configDir: string): string {
  return join(configDir, "profile.json");
}

export function loadProfile(configDir: string): ProfileFile {
  const p = profilePath(configDir);
  if (!existsSync(p)) return emptyProfile();
  try {
    const raw = JSON.parse(readFileSync(p, "utf8")) as Partial<ProfileFile>;
    return normalize(raw);
  } catch {
    return emptyProfile();
  }
}

export function saveProfile(configDir: string, profile: ProfileFile): ProfileFile {
  mkdirSync(configDir, { recursive: true });
  const next: ProfileFile = {
    updatedAt: new Date().toISOString(),
    identity: normalizeIdentity(profile.identity),
    learned: recomputeLearned(normalizeLearned(profile.learned)),
  };
  writeFileSync(profilePath(configDir), JSON.stringify(next, null, 2), "utf8");
  return next;
}

/** Patch the user-set identity fields. Detected accounts are never touched here. */
export function saveIdentity(
  configDir: string,
  patch: Partial<UserIdentity>,
): ProfileFile {
  const current = loadProfile(configDir);
  const identity: UserIdentity = {
    nickname: patch.nickname ?? current.identity.nickname,
    gender: patch.gender ?? current.identity.gender,
    accounts: patch.accounts ?? current.identity.accounts,
    topics: patch.topics ?? current.identity.topics,
    writingStyle: patch.writingStyle ?? current.identity.writingStyle,
    forbidden: patch.forbidden ?? current.identity.forbidden,
    workNotes: patch.workNotes ?? current.identity.workNotes,
  };
  return saveProfile(configDir, { ...current, identity });
}

/** Record a navigation. Cheap: appends to the ring buffer and recomputes derived fields. */
export function recordVisit(configDir: string, host: string): ProfileFile {
  const current = loadProfile(configDir);
  const visit: Visit = { host, ts: new Date().toISOString() };
  const learned: LearnedProfile = {
    ...current.learned,
    recentVisits: pushVisit(current.learned.recentVisits, visit),
  };
  return saveProfile(configDir, { ...current, learned });
}

/** Sparo detected which account the user is logged in as on a site. */
export function upsertDetectedAccount(
  configDir: string,
  site: string,
  username: string,
): ProfileFile {
  if (!site || !username) return loadProfile(configDir);
  const current = loadProfile(configDir);
  const existing = current.learned.accounts ?? [];
  const without = existing.filter(
    (a) => !(a.site === site && a.username === username),
  );
  const accounts: AccountRef[] = [
    ...without,
    { site, username, verifiedAt: new Date().toISOString(), source: "detected" },
  ];
  return saveProfile(configDir, {
    ...current,
    learned: { ...current.learned, accounts },
  });
}

export function addHabit(configDir: string, habit: string): ProfileFile {
  const trimmed = (habit || "").trim();
  if (!trimmed) return loadProfile(configDir);
  const current = loadProfile(configDir);
  const habits = [...current.learned.habits.filter((h) => h !== trimmed), trimmed];
  return saveProfile(configDir, {
    ...current,
    learned: { ...current.learned, habits: habits.slice(-12) },
  });
}

/** The system-prompt block. Empty string when nothing is known yet. */
export function profileBriefFor(configDir: string): string {
  return profileBrief(loadProfile(configDir));
}

/** All known accounts, user-set and detected, merged. */
export function knownAccounts(configDir: string): AccountRef[] {
  const p = loadProfile(configDir);
  return mergeAccounts(p.identity, p.learned);
}

/** Forget everything — used when the user clears their profile. */
export function clearProfile(configDir: string): ProfileFile {
  const fresh = emptyProfile();
  saveProfile(configDir, fresh);
  return fresh;
}

function normalize(raw: Partial<ProfileFile>): ProfileFile {
  const base = emptyProfile();
  return {
    updatedAt: raw.updatedAt || base.updatedAt,
    identity: normalizeIdentity(raw.identity),
    learned: normalizeLearned(raw.learned),
  };
}

function normalizeIdentity(raw: unknown): UserIdentity {
  const r = (raw || {}) as Partial<UserIdentity>;
  return {
    nickname: typeof r.nickname === "string" ? r.nickname : "",
    gender:
      r.gender === "male" || r.gender === "female" || r.gender === "other"
        ? r.gender
        : "",
    accounts: Array.isArray(r.accounts) ? r.accounts.map(normalizeAccount) : [],
    topics: Array.isArray(r.topics) ? r.topics.filter((t) => typeof t === "string") : [],
    writingStyle: typeof r.writingStyle === "string" ? r.writingStyle : "",
    forbidden: typeof r.forbidden === "string" ? r.forbidden : "",
    workNotes: typeof r.workNotes === "string" ? r.workNotes : "",
  };
}

function normalizeLearned(raw: unknown): LearnedProfile {
  const r = (raw || {}) as Partial<LearnedProfile>;
  const visits = Array.isArray(r.recentVisits) ? r.recentVisits.map(normalizeVisit) : [];
  const accounts = Array.isArray(r.accounts) ? r.accounts.map(normalizeAccount) : [];
  return {
    preferredSites: Array.isArray(r.preferredSites)
      ? r.preferredSites.filter((s) => typeof s === "string")
      : [],
    activeHours:
      r.activeHours && Array.isArray(r.activeHours.peak) && Array.isArray(r.activeHours.quiet)
        ? { peak: r.activeHours.peak, quiet: r.activeHours.quiet }
        : { peak: [], quiet: [] },
    habits: Array.isArray(r.habits) ? r.habits.filter((h) => typeof h === "string") : [],
    recentVisits: visits,
    accounts,
  };
}

function normalizeAccount(raw: unknown): AccountRef {
  const r = (raw || {}) as Partial<AccountRef>;
  return {
    site: typeof r.site === "string" ? r.site : "",
    username: typeof r.username === "string" ? r.username : "",
    verifiedAt: typeof r.verifiedAt === "string" ? r.verifiedAt : undefined,
    source: r.source === "user" || r.source === "detected" ? r.source : undefined,
  };
}

function normalizeVisit(raw: unknown): Visit {
  const r = (raw || {}) as Partial<Visit>;
  return {
    host: typeof r.host === "string" ? r.host : "",
    ts: typeof r.ts === "string" ? r.ts : new Date(0).toISOString(),
  };
}
