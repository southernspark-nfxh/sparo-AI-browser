import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { migrateMemorySaverMode, pickTabsToDiscard } from "../src/main/memory-policy.js";
import { loadSettings } from "../src/main/settings/store.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function dir(): string {
  const next = mkdtempSync(join(tmpdir(), "sparo-mem-"));
  dirs.push(next);
  return next;
}

const now = 1_000_000;
const idle = 5 * 60_000;

describe("保活策略", () => {
  it("智能档内存宽裕时不卸用户页，也不卸已完成工位", () => {
    const ids = pickTabsToDiscard({
      mode: "smart",
      now,
      idleMs: idle,
      activeIds: ["looking"],
      freeRatio: 0.5,
      tabs: [
        { id: "looking", userOwned: true, lastActiveAt: now - idle * 2 },
        { id: "user-old", userOwned: true, lastActiveAt: now - idle * 3 },
        { id: "agent-done", userOwned: false, agentDone: true, lastActiveAt: now - idle * 3 },
      ],
    });
    expect(ids).toEqual([]);
  });

  it("内存紧时先收已完成工位，再收一张最久没看的用户页，各窗当前页和活任务留下", () => {
    const ids = pickTabsToDiscard({
      mode: "smart",
      now,
      idleMs: idle,
      activeIds: ["win-a", "win-b"],
      freeRatio: 0.1,
      tabs: [
        { id: "win-a", userOwned: true, lastActiveAt: 0 },
        { id: "win-b", userOwned: true, lastActiveAt: 0 },
        { id: "agent-done", userOwned: false, agentDone: true, lastActiveAt: now - 1000 },
        { id: "agent-older", userOwned: false, agentDone: true, lastActiveAt: now - 5000 },
        { id: "agent-running", userOwned: false, agentDone: true, taskState: "running", lastActiveAt: 0 },
        { id: "agent-wait", userOwned: false, taskState: "waiting_human", lastActiveAt: 0 },
        { id: "user-older", userOwned: true, lastActiveAt: now - 9000 },
        { id: "user-newer", userOwned: true, lastActiveAt: now - 1000 },
        { id: "user-sound", userOwned: true, audible: true, lastActiveAt: 0 },
      ],
    });
    expect(ids).toEqual(["agent-older", "agent-done", "user-older"]);
  });

  it("激进档按闲置时间卸后台页，仍留下各窗当前页和等人的工位", () => {
    const ids = pickTabsToDiscard({
      mode: "aggressive",
      now,
      idleMs: idle,
      activeIds: ["win-a", "win-b"],
      freeRatio: 0.9,
      tabs: [
        { id: "win-b", userOwned: true, lastActiveAt: 0 },
        { id: "fresh", userOwned: true, lastActiveAt: now - idle + 1000 },
        { id: "stale-user", userOwned: true, lastActiveAt: now - idle },
        { id: "waiting", userOwned: false, taskState: "waiting_human", lastActiveAt: 0 },
      ],
    });
    expect(ids).toEqual(["stale-user"]);
  });

  it("全保活什么都不卸", () => {
    expect(
      pickTabsToDiscard({
        mode: "off",
        now,
        idleMs: 0,
        activeIds: [],
        freeRatio: 0,
        tabs: [{ id: "a", userOwned: true, lastActiveAt: 0 }],
      }),
    ).toEqual([]);
  });
});

describe("设置迁移", () => {
  it("没写、写了 true、写了 false 三条路", () => {
    expect(migrateMemorySaverMode({})).toBe("smart");
    expect(migrateMemorySaverMode({ memorySaver: true })).toBe("smart");
    expect(migrateMemorySaverMode({ memorySaver: false })).toBe("off");
    expect(migrateMemorySaverMode({ memorySaver: true, memorySaverMode: "aggressive" })).toBe("aggressive");

    const fresh = loadSettings(dir());
    expect(fresh.memorySaverMode).toBe("smart");

    const onDir = dir();
    writeFileSync(join(onDir, "settings.json"), JSON.stringify({ memorySaver: true, locale: "zh" }));
    expect(loadSettings(onDir).memorySaverMode).toBe("smart");

    const offDir = dir();
    const raw = JSON.stringify({ memorySaver: false, memorySaverIdleMinutes: 2, locale: "zh" });
    writeFileSync(join(offDir, "settings.json"), raw);
    expect(loadSettings(offDir).memorySaverMode).toBe("off");
    expect(loadSettings(offDir).memorySaver).toBe(false);
  });
});
