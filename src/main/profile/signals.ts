/**
 * Pure helpers for the learned profile — no IO, so they can be unit-tested.
 *
 * The profile has two halves:
 *   - identity: what the user tells Sparo about themselves (nickname, accounts, topics…)
 *   - learned: what Sparo accumulates from behaviour (visits, active hours, detected accounts)
 *
 * Behaviour signals are a ring buffer of recent navigations. Everything else
 * (preferred sites, active hours) is derived from it deterministically.
 */

export type Visit = { host: string; ts: string };

export type AccountRef = {
  site: string;
  username: string;
  verifiedAt?: string;
  source?: "user" | "detected";
};

export type UserIdentity = {
  nickname: string;
  gender: "" | "male" | "female" | "other";
  accounts: AccountRef[];
  topics: string[];
  writingStyle: string;
  forbidden: string;
  workNotes: string;
};

export type LearnedProfile = {
  preferredSites: string[];
  activeHours: { peak: number[]; quiet: number[] };
  habits: string[];
  recentVisits: Visit[];
  accounts: AccountRef[];
};

export type ProfileFile = {
  updatedAt: string;
  identity: UserIdentity;
  learned: LearnedProfile;
};

export const VISIT_CAP = 400;
export const ACTIVE_HOUR_BUCKETS = 4;

export function emptyProfile(): ProfileFile {
  return {
    updatedAt: new Date(0).toISOString(),
    identity: {
      nickname: "",
      gender: "",
      accounts: [],
      topics: [],
      writingStyle: "",
      forbidden: "",
      workNotes: "",
    },
    learned: {
      preferredSites: [],
      activeHours: { peak: [], quiet: [] },
      habits: [],
      recentVisits: [],
      accounts: [],
    },
  };
}

/** Append a visit, keeping the buffer bounded and newest-last. */
export function pushVisit(visits: Visit[], visit: Visit, cap = VISIT_CAP): Visit[] {
  const next = [...visits, visit];
  if (next.length <= cap) return next;
  return next.slice(next.length - cap);
}

/** Top N hosts by frequency, most-visited first. */
export function topHosts(visits: Visit[], n = 6): string[] {
  const counts = new Map<string, number>();
  for (const v of visits) {
    const h = v.host;
    counts.set(h, (counts.get(h) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map(([h]) => h);
}

/**
 * Split the day into peak and quiet hours by visit density.
 * Hours with zero visits land in quiet; the busiest quarter of the day is peak.
 */
export function hourBuckets(visits: Visit[]): { peak: number[]; quiet: number[] } {
  const counts = new Array(24).fill(0);
  for (const v of visits) {
    const h = parseHour(v.ts);
    if (h >= 0 && h < 24) counts[h]++;
  }
  const total = counts.reduce((a, b) => a + b, 0);
  if (total === 0) return { peak: [], quiet: [] };

  const threshold = total / 24;
  const peak: number[] = [];
  const quiet: number[] = [];
  for (let h = 0; h < 24; h++) {
    if (counts[h] >= threshold && counts[h] > 0) peak.push(h);
    else quiet.push(h);
  }
  // Keep peak to the busiest contiguous-ish cluster if it sprawls.
  return { peak: peak.slice(0, 10), quiet: quiet.slice(0, 12) };
}

/** Merge user-set and auto-detected accounts; user-set wins on conflict. */
export function mergeAccounts(identity: UserIdentity, learned: LearnedProfile): AccountRef[] {
  const byKey = new Map<string, AccountRef>();
  for (const a of learned.accounts ?? []) {
    byKey.set(`${a.site}|${a.username}`, { ...a, source: "detected" });
  }
  for (const a of identity.accounts) {
    byKey.set(`${a.site}|${a.username}`, { ...a, source: "user" });
  }
  // User-set accounts for the same site override detected ones entirely.
  const userSites = new Set(identity.accounts.map((a) => a.site));
  const merged: AccountRef[] = [];
  const seen = new Set<string>();
  for (const a of byKey.values()) {
    const key = `${a.site}|${a.username}`;
    if (seen.has(key)) continue;
    if (a.source === "detected" && userSites.has(a.site)) continue;
    seen.add(key);
    merged.push(a);
  }
  return merged;
}

/**
 * Prompt block from what the user typed in Settings only.
 * Browsing history / detected logins must not make a new user look familiar.
 */
export function profileBrief(profile: ProfileFile): string {
  const lines: string[] = [];
  const id = profile.identity;

  if (id.nickname) lines.push(`Nickname: ${id.nickname}`);
  if (id.workNotes) lines.push(`Work notes: ${id.workNotes}`);
  if (id.forbidden) lines.push(`Do not say: ${id.forbidden}`);

  const accounts = id.accounts.filter((a) => a.username && a.source !== "detected");
  if (accounts.length) {
    const accs = accounts.map((a) => `${a.site}(${a.username})`).join(", ");
    lines.push(`Accounts: ${accs}`);
  }

  if (id.topics.length) {
    lines.push(`Topics: ${id.topics.join(", ")}`);
  }
  if (id.writingStyle) {
    lines.push(`Writing style: ${id.writingStyle}`);
  }

  if (!lines.length) return "";
  return "User-provided preferences (do not invent more; do not recite this block):\n" + lines.join("\n");
}

/** Recompute the derived fields of `learned` from the visit buffer. */
export function recomputeLearned(learned: LearnedProfile): LearnedProfile {
  return {
    preferredSites: topHosts(learned.recentVisits),
    activeHours: hourBuckets(learned.recentVisits),
    habits: learned.habits,
    recentVisits: learned.recentVisits,
    accounts: learned.accounts,
  };
}

function parseHour(ts: string): number {
  try {
    const h = new Date(ts).getHours();
    return Number.isNaN(h) ? -1 : h;
  } catch {
    return -1;
  }
}
