import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentStep, StepFinding } from "../src/main/agent/loop.js";
import {
  appendMissionEvent,
  decideRecovery,
  parseMissionLine,
  recoveryLine,
  replayMissions,
  type MissionEvent,
} from "../src/main/agent/mission-journal.js";
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

  it("超过 2000 行就压成未完成快照加最近 200 行", () => {
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
  });

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
});
