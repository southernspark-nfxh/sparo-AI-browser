import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentStep, StepFinding } from "../src/main/agent/loop.js";
import {
  adoptModelMission,
  appendMissionEvent,
  decideRecovery,
  journalCloseUtterance,
  missionWasExecuted,
  parseMissionLine,
  pickInterruptedMission,
  preferredMission,
  recoveryLine,
  replayMissions,
  type MissionEvent,
} from "../src/main/agent/mission-journal.js";
import { applyTurn, holdModelTurn } from "../src/main/agent/runtime.js";
import type { ActiveMission } from "../src/main/agent/runtime.js";

function dir(): string {
  return mkdtempSync(join(tmpdir(), "sparo-mission-"));
}

function mission(id: string, state: ActiveMission["state"] = "running"): ActiveMission {
  return {
    id,
    raw: "下周一从北京去上海出差两天",
    goal: {
      raw: "下周一从北京去上海出差两天",
      intent: "北京去上海出差",
      kind: "trip",
      deliverables: [],
      known: { origin: "北京" },
      unknown: [],
      decision: "act",
      approach: "",
    },
    plan: [],
    findings: [],
    state,
    brainPlan: {
      createdAt: 1,
      steps: [
        { id: "a", label: "查去程机票", cap: "flight_search", covers: ["flights"], status: "done" },
        { id: "b", label: "查上海酒店", cap: "hotel_search", covers: ["stay"], status: "running" },
      ],
    },
  };
}

function finding(text: string): StepFinding {
  const step = { id: "s", label: "查", cap: "act", covers: ["answer"] } as AgentStep;
  return { step, text, url: "https://example.com", ok: true };
}

describe("mission journal", () => {
  it("追加、回放，并折叠成未完成的最新快照", () => {
    const root = dir();
    const open: MissionEvent = { t: 1_700_000_000_000, op: "open", mission: mission("m1") };
    appendMissionEvent(open, root);
    appendMissionEvent(
      {
        t: 1_700_000_100_000,
        op: "turn",
        id: "m1",
        state: "waiting_human",
        plan: mission("m1").brainPlan,
        findings: [finding("查到一家酒店")],
      },
      root,
    );
    const restored = replayMissions(root);
    expect(restored).toHaveLength(1);
    expect(restored[0].mission.state).toBe("waiting_human");
    expect(restored[0].mission.findings[0].text).toBe("查到一家酒店");
    expect(restored[0].openedAt).toBe(1_700_000_000_000);
    appendMissionEvent({ t: 1_700_000_200_000, op: "close", id: "m1", reason: "done" }, root);
    expect(replayMissions(root)).toEqual([]);
  });

  it("损坏行跳过，finding 正文只留 500 字", () => {
    const root = dir();
    const path = join(root, "missions.jsonl");
    const long = "字".repeat(800);
    const lines = [
      JSON.stringify({ t: 10, op: "open", mission: mission("m2") }),
      "这不是 json",
      "{",
      JSON.stringify({ t: 11, op: "turn", id: "m2", state: "running", findings: [finding(long)] }),
      JSON.stringify({ t: 12, op: "nope" }),
    ];
    writeFileSync(path, `${lines.join("\n")}\n`, "utf8");
    expect(parseMissionLine("这不是 json")).toBeNull();
    const restored = replayMissions(root);
    expect(restored).toHaveLength(1);
    expect(restored[0].mission.findings[0].text.length).toBe(500);
  });

  it(
    "超过 2000 行就压成未完成快照加最近 200 行",
    () => {
    const root = dir();
    appendMissionEvent({ t: 1, op: "open", mission: mission("keep") }, root);
    for (let i = 0; i < 2005; i++) {
      appendMissionEvent({ t: 2 + i, op: "turn", id: "keep", state: "running" }, root);
    }
    const text = readFileSync(join(root, "missions.jsonl"), "utf8").trim().split(/\r?\n/);
    expect(text.length).toBeLessThan(250);
    const restored = replayMissions(root);
    expect(restored.map((item) => item.mission.id)).toEqual(["keep"]);
    expect(restored[0].mission.state).toBe("running");
  },
  20000,
);

  it("恢复卡：继续接着跑，算了关掉，七天前带日期", () => {
    expect(decideRecovery("继续")).toBe("resume");
    expect(decideRecovery("算了")).toBe("dismiss");
    expect(decideRecovery("去掉最后一步")).toBeNull();
    const fresh = recoveryLine({ mission: mission("m3"), openedAt: Date.now() - 60_000 });
    expect(fresh).toContain("跑到第 2 步");
    expect(fresh).toContain("继续？");
    expect(fresh).not.toContain("的单");
    const oldAt = Date.now() - 8 * 24 * 60 * 60 * 1000;
    const stale = recoveryLine({ mission: mission("m4", "waiting_human"), openedAt: oldAt });
    expect(stale).toMatch(/（\d{4}-\d{2}-\d{2}的单）/);
    const root = dir();
    appendMissionEvent({ t: oldAt, op: "open", mission: mission("m4", "waiting_human") }, root);
    expect(replayMissions(root)[0].mission.state).toBe("waiting_human");
    appendMissionEvent({ t: Date.now(), op: "close", id: "m4", reason: "算了" }, root);
    expect(replayMissions(root)).toEqual([]);
  });

  it("恢复卡只取执行过且没收尾的最近一张，选取本身不写盘", () => {
    const root = dir();
    const idle = mission("idle");
    idle.brainPlan = {
      createdAt: 1,
      steps: [{ id: "only", label: "行程手册", cap: "act", covers: ["answer"], status: "running" }],
    };
    appendMissionEvent({ t: 1, op: "open", mission: idle }, root);
    const older = mission("older");
    appendMissionEvent({ t: 2, op: "open", mission: older }, root);
    appendMissionEvent({
      t: 3,
      op: "turn",
      id: "older",
      state: "running",
      plan: older.brainPlan,
      findings: [finding("查到机票")],
    }, root);
    const newer = mission("newer");
    newer.raw = "另一句完全不同的话";
    newer.goal = { ...newer.goal, raw: newer.raw, intent: "另一句" };
    appendMissionEvent({ t: 4, op: "open", mission: newer }, root);
    appendMissionEvent({
      t: 5,
      op: "turn",
      id: "newer",
      state: "running",
      plan: newer.brainPlan,
      findings: [finding("还在查")],
    }, root);
    const finished = mission("finished");
    finished.raw = "这句已经做完";
    finished.goal = { ...finished.goal, raw: finished.raw };
    finished.brainPlan = {
      createdAt: 1,
      steps: [
        { id: "a", label: "查完", cap: "act", covers: ["answer"], status: "done" },
        { id: "b", label: "写完", cap: "act", covers: ["answer"], status: "skipped" },
      ],
    };
    appendMissionEvent({ t: 6, op: "open", mission: finished }, root);
    appendMissionEvent({
      t: 7,
      op: "turn",
      id: "finished",
      state: "running",
      plan: finished.brainPlan,
      findings: [finding("汇总过")],
    }, root);

    const before = readFileSync(join(root, "missions.jsonl"), "utf8");
    const pending = replayMissions(root);
    expect(pending.map((item) => item.mission.id)).toEqual(["idle", "older", "newer", "finished"]);
    expect(missionWasExecuted(pending[0])).toBe(false);
    expect(pickInterruptedMission(pending)?.mission.id).toBe("newer");
    expect(readFileSync(join(root, "missions.jsonl"), "utf8")).toBe(before);
  });

  it("算了关掉同一句还开着的单，另一句不动；正常收尾只顺手关没执行过的影子单", () => {
    const root = dir();
    const prev = process.env.SPARO_MISSION_JOURNAL_DIR;
    process.env.SPARO_MISSION_JOURNAL_DIR = root;
    try {
      const executed = mission("executed");
      const shadow = mission("shadow");
      shadow.brainPlan = {
        createdAt: 1,
        steps: [{ id: "book", label: "行程手册", cap: "act", covers: ["answer"], status: "running" }],
      };
      const spaced = mission("spaced");
      spaced.raw = "  下周一从北京去上海出差两天  ";
      spaced.goal = { ...spaced.goal, raw: spaced.raw };
      const other = mission("other");
      other.raw = "帮我看看今天天气";
      other.goal = { ...other.goal, raw: other.raw, intent: "天气" };
      for (const [t, item] of [
        [1, executed],
        [2, shadow],
        [3, spaced],
        [4, other],
      ] as const) {
        appendMissionEvent({ t, op: "open", mission: item }, root);
      }
      appendMissionEvent({
        t: 5,
        op: "turn",
        id: "executed",
        state: "running",
        findings: [finding("查到酒店")],
      }, root);
      appendMissionEvent({
        t: 6,
        op: "turn",
        id: "other",
        state: "running",
        findings: [finding("晴")],
      }, root);

      const closed = journalCloseUtterance(executed.raw, "算了", root, { alsoId: executed.id });
      expect(closed.sort()).toEqual(["executed", "shadow", "spaced"]);
      const left = replayMissions(root);
      expect(left.map((item) => item.mission.id)).toEqual(["other"]);
      const reasons = readFileSync(join(root, "missions.jsonl"), "utf8")
        .split(/\n/)
        .filter((line) => line.includes('"op":"close"'))
        .map((line) => JSON.parse(line) as { id: string; reason: string });
      expect(reasons.map((row) => row.reason)).toEqual(["算了", "算了", "算了"]);
      expect(reasons.map((row) => row.id).sort()).toEqual(["executed", "shadow", "spaced"]);

      const done = mission("done-main");
      const twin = mission("done-twin");
      twin.raw = "周六去杭州";
      twin.goal = { ...twin.goal, raw: twin.raw };
      done.raw = twin.raw;
      done.goal = { ...done.goal, raw: twin.raw };
      const parallel = mission("parallel");
      parallel.raw = twin.raw;
      parallel.goal = { ...parallel.goal, raw: twin.raw };
      appendMissionEvent({ t: 10, op: "open", mission: done }, root);
      appendMissionEvent({ t: 11, op: "open", mission: twin }, root);
      appendMissionEvent({ t: 12, op: "open", mission: parallel }, root);
      appendMissionEvent({
        t: 13,
        op: "turn",
        id: "done-main",
        state: "running",
        findings: [finding("机票")],
      }, root);
      appendMissionEvent({
        t: 14,
        op: "turn",
        id: "parallel",
        state: "running",
        findings: [finding("另一路还在查")],
      }, root);
      const finishedIds = journalCloseUtterance(done.raw, "done", root, { alsoId: done.id, onlyIdle: true });
      expect(finishedIds.sort()).toEqual(["done-main", "done-twin"]);
      expect(replayMissions(root).map((item) => item.mission.id).sort()).toEqual(["other", "parallel"]);

      const shallow = mission("shallow");
      shallow.goal = { ...shallow.goal, kind: "chat", intent: "按原话做事" };
      const research = mission("research-keep");
      research.goal = { ...research.goal, kind: "research", intent: "抽样上百条" };
      appendMissionEvent({ t: 20, op: "open", mission: shallow }, root);
      const duped = adoptModelMission(research, root);
      expect(duped).toEqual(["shallow"]);
      appendMissionEvent({ t: 21, op: "open", mission: research }, root);
      const dupLines = readFileSync(join(root, "missions.jsonl"), "utf8")
        .split(/\n/)
        .filter((line) => line.includes('"reason":"dup"'));
      expect(dupLines.length).toBeGreaterThan(0);
      const openIds = replayMissions(root).map((item) => item.mission.id);
      expect(openIds).toContain("research-keep");
      expect(openIds).not.toContain("shallow");
      expect(preferredMission(shallow, replayMissions(root)).id).toBe("research-keep");
      expect(preferredMission(research, replayMissions(root)).id).toBe("research-keep");
    } finally {
      if (prev === undefined) delete process.env.SPARO_MISSION_JOURNAL_DIR;
      else process.env.SPARO_MISSION_JOURNAL_DIR = prev;
    }
  });

  it("模型分类进行时，启发式不开第二张单", () => {
    const root = dir();
    const prevConfig = process.env.SPARO_CONFIG_DIR;
    const prevJournal = process.env.SPARO_MISSION_JOURNAL_DIR;
    const restore = () => {
      if (prevConfig === undefined) delete process.env.SPARO_CONFIG_DIR;
      else process.env.SPARO_CONFIG_DIR = prevConfig;
      if (prevJournal === undefined) delete process.env.SPARO_MISSION_JOURNAL_DIR;
      else process.env.SPARO_MISSION_JOURNAL_DIR = prevJournal;
    };
    process.env.SPARO_CONFIG_DIR = root;
    process.env.SPARO_MISSION_JOURNAL_DIR = root;
    const release = holdModelTurn("帮我研究一下这个博主");
    try {
      applyTurn("帮我研究一下这个博主");
      expect(replayMissions(root)).toEqual([]);
    } finally {
      release();
      restore();
    }
    process.env.SPARO_CONFIG_DIR = root;
    process.env.SPARO_MISSION_JOURNAL_DIR = root;
    try {
      applyTurn("帮我研究一下这个博主");
      expect(replayMissions(root)).toHaveLength(1);
    } finally {
      restore();
    }
  });
});
