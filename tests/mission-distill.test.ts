import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  parseDistillSkill,
  parseOneShotVerdict,
  saveDistilledSkill,
} from "../src/main/agent/distill.js";
import { getSkill } from "../src/main/skills/store.js";

const dirs: string[] = [];
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), "sparo-distill-"));
  dirs.push(d);
  mkdirSync(join(d, "skills"), { recursive: true });
  return d;
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

const GOOD = {
  title: "核对电费户号",
  intent: "通知单和电表对一下户号",
  aliases: ["对户号"],
  route: [
    { kind: "fixed", tool: "navigate", args: { url: "https://example.com/bill/{{id}}" } },
    { kind: "fixed", tool: "click", args: { selector: "#go" } },
    { kind: "open", goal: "读通知单上的户号", tools: ["page_text"] },
    { kind: "open", goal: "" },
  ],
  params: { id: { type: "string", required: true } },
  pitfalls: [{ milestone: 1, note: "页面可能要登录", from: "qa" }],
  contract: { deliverable: "report", fields: ["户号"] },
};

describe("parseDistillSkill", () => {
  it("keeps a legal four-piece draft and drops illegal route segments", () => {
    const draft = parseDistillSkill(JSON.stringify(GOOD));
    expect(draft?.title).toBe("核对电费户号");
    expect(draft?.intent).toContain("户号");
    expect(draft?.aliases).toEqual(["对户号"]);
    expect(draft?.route.map((row) => row.kind)).toEqual(["fixed", "open"]);
    expect(draft?.route[0]).toMatchObject({ tool: "navigate" });
    expect(draft?.params.id?.required).toBe(true);
    expect(draft?.pitfalls[0]?.note).toContain("登录");
    expect(draft?.contract.deliverable).toBe("report");
  });

  it("returns null for an empty route, bad JSON, or a missing title", () => {
    expect(parseDistillSkill(JSON.stringify({ ...GOOD, route: [] }))).toBeNull();
    expect(parseDistillSkill("不是 json")).toBeNull();
    expect(parseDistillSkill(JSON.stringify({ ...GOOD, title: "  " }))).toBeNull();
  });

  it("truncates a route longer than 8 and drops an open segment without a goal", () => {
    const route = Array.from({ length: 9 }, (_, i) => ({
      kind: "fixed",
      tool: "page_text",
      args: { url: `https://example.com/${i}` },
    }));
    const draft = parseDistillSkill(JSON.stringify({ ...GOOD, route }));
    expect(draft?.route).toHaveLength(8);
    const onlyOpen = parseDistillSkill(
      JSON.stringify({ ...GOOD, route: [{ kind: "open", goal: "   " }] }),
    );
    expect(onlyOpen).toBeNull();
  });
});

describe("saveDistilledSkill", () => {
  it("writes a taught distilled skill and refuses to overwrite the same title", () => {
    const dir = tempDir();
    const saved = saveDistilledSkill(dir, parseDistillSkill(JSON.stringify(GOOD))!);
    expect(saved).not.toBeNull();
    expect(saved!.id.startsWith("taught-")).toBe(true);
    expect(saved!.source).toBe("taught");
    expect(saved!.distilled).toBe(true);
    expect(saved!.steps).toEqual([]);
    expect(saved!.stats).toEqual({ success: 0, fail: 0 });
    const onDisk = JSON.parse(readFileSync(join(dir, "skills", `${saved!.id}.json`), "utf8")) as {
      distilled?: boolean;
      steps?: unknown[];
      route?: unknown[];
    };
    expect(onDisk.distilled).toBe(true);
    expect(onDisk.steps).toEqual([]);
    expect(onDisk.route?.length).toBeGreaterThan(0);
    const again = saveDistilledSkill(dir, parseDistillSkill(JSON.stringify(GOOD))!);
    expect(again).toBeNull();
    expect(getSkill(dir, saved!.id)?.title).toBe("核对电费户号");
  });
});

describe("parseOneShotVerdict", () => {
  it("reads true, false, and treats anything else as unknown", () => {
    expect(parseOneShotVerdict('{"oneShot":true}')).toBe(true);
    expect(parseOneShotVerdict("好的 {\"oneShot\":false} 结束")).toBe(false);
    expect(parseOneShotVerdict("看情况")).toBeNull();
    expect(parseOneShotVerdict('{"ok":true}')).toBeNull();
  });
});
