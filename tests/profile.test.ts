import { describe, expect, it } from "vitest";
import {
  emptyProfile,
  hourBuckets,
  mergeAccounts,
  profileBrief,
  pushVisit,
  recomputeLearned,
  topHosts,
  type LearnedProfile,
  type ProfileFile,
} from "../src/main/profile/signals.js";

const ts = (h: number) =>
  new Date(2026, 0, 1, h, 0, 0).toISOString();

describe("pushVisit", () => {
  it("keeps the buffer bounded", () => {
    let visits: { host: string; ts: string }[] = [];
    for (let i = 0; i < 500; i++)
      visits = pushVisit(visits, { host: "h" + (i % 5), ts: ts(10) }, 100);
    expect(visits.length).toBe(100);
    expect(visits.at(-1)!.host).toBe("h4");
  });

  it("preserves order newest-last", () => {
    let visits: { host: string; ts: string }[] = [];
    visits = pushVisit(visits, { host: "a", ts: ts(1) });
    visits = pushVisit(visits, { host: "b", ts: ts(2) });
    expect(visits.map((v) => v.host)).toEqual(["a", "b"]);
  });
});

describe("topHosts", () => {
  it("ranks by frequency and breaks ties by name", () => {
    const visits = [
      { host: "weibo", ts: ts(1) },
      { host: "weibo", ts: ts(2) },
      { host: "zhihu", ts: ts(3) },
      { host: "xhs", ts: ts(4) },
      { host: "xhs", ts: ts(5) },
      { host: "xhs", ts: ts(6) },
    ];
    expect(topHosts(visits, 3)).toEqual(["xhs", "weibo", "zhihu"]);
  });

  it("returns empty for no visits", () => {
    expect(topHosts([], 3)).toEqual([]);
  });
});

describe("hourBuckets", () => {
  it("splits peak and quiet by density", () => {
    const visits = [
      { host: "a", ts: ts(22) },
      { host: "a", ts: ts(23) },
      { host: "a", ts: ts(21) },
      { host: "a", ts: ts(22) },
    ];
    const { peak, quiet } = hourBuckets(visits);
    expect(peak).toContain(22);
    expect(quiet).toContain(3);
    expect(quiet).toContain(5);
  });

  it("returns empty buckets when there are no visits", () => {
    expect(hourBuckets([])).toEqual({ peak: [], quiet: [] });
  });
});

describe("mergeAccounts", () => {
  const id = {
    nickname: "",
    gender: "" as const,
    accounts: [{ site: "weibo", username: "myname", source: "user" as const }],
    topics: [],
    writingStyle: "",
    forbidden: "",
    workNotes: "",
  };
  const learned: LearnedProfile = {
    preferredSites: [],
    activeHours: { peak: [], quiet: [] },
    habits: [],
    recentVisits: [],
    accounts: [
      { site: "weibo", username: "detected-old", verifiedAt: "x", source: "detected" },
      { site: "zhihu", username: "zhi-user", verifiedAt: "x", source: "detected" },
    ],
  };

  it("drops detected accounts for sites the user set themselves", () => {
    const merged = mergeAccounts(id, learned);
    const weibo = merged.filter((a) => a.site === "weibo");
    expect(weibo).toHaveLength(1);
    expect(weibo[0].username).toBe("myname");
  });

  it("keeps detected accounts for sites the user did not set", () => {
    const merged = mergeAccounts(id, learned);
    expect(merged.find((a) => a.site === "zhihu")?.username).toBe("zhi-user");
  });
});

describe("profileBrief", () => {
  it("is empty when nothing is known", () => {
    expect(profileBrief(emptyProfile())).toBe("");
  });

  it("ignores learned visits so a new user stays a stranger", () => {
    const profile: ProfileFile = {
      updatedAt: ts(1),
      identity: emptyProfile().identity,
      learned: {
        preferredSites: ["google.com.hk", "xiaohongshu.com"],
        activeHours: { peak: [21], quiet: [] },
        habits: ["opens Google"],
        recentVisits: [{ host: "google.com.hk", ts: ts(1) }],
        accounts: [{ site: "xiaohongshu", username: "auto", source: "detected" }],
      },
    };
    expect(profileBrief(profile)).toBe("");
  });

  it("lists what is known without raw visits", () => {
    const profile: ProfileFile = {
      updatedAt: ts(1),
      identity: {
        nickname: "老王",
        gender: "male",
        accounts: [{ site: "weibo", username: "laowang", source: "user" }],
        topics: ["AI", "修仙"],
        writingStyle: "短句、口语",
        forbidden: "",
        workNotes: "",
      },
      learned: {
        preferredSites: ["weibo.com", "zhihu.com"],
        activeHours: { peak: [21, 22, 23], quiet: [] },
        habits: ["深夜发微博"],
        recentVisits: [],
        accounts: [],
      },
    };
    const brief = profileBrief(profile);
    expect(brief).toContain("老王");
    expect(brief).toContain("weibo(laowang)");
    expect(brief).toContain("AI");
    expect(brief).toContain("短句、口语");
    expect(brief).not.toContain("weibo.com");
    expect(brief).not.toContain("21:00");
    expect(brief).not.toContain("深夜发微博");
    expect(brief).not.toContain("recentVisits");
  });
});

describe("recomputeLearned", () => {
  it("recomputes preferred sites and active hours from visits, keeps accounts", () => {
    const learned: LearnedProfile = {
      preferredSites: [],
      activeHours: { peak: [], quiet: [] },
      habits: ["a habit"],
      recentVisits: [
        { host: "weibo.com", ts: ts(22) },
        { host: "weibo.com", ts: ts(23) },
      ],
      accounts: [{ site: "weibo", username: "x", source: "detected" }],
    };
    const out = recomputeLearned(learned);
    expect(out.preferredSites).toEqual(["weibo.com"]);
    expect(out.habits).toEqual(["a habit"]);
    expect(out.accounts).toHaveLength(1);
  });
});
