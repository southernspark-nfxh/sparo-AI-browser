import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { skillCatalogLines, runSkill } from "../src/main/skills/runner.js";
import type { SkillBrowser } from "../src/main/skills/runner.js";

const dirs: string[] = [];
function tmp() {
  const d = mkdtempSync(join(tmpdir(), "sparo-strict-"));
  dirs.push(d);
  mkdirSync(join(d, "skills"), { recursive: true });
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const browser = {} as SkillBrowser;

function writeSkill(dir: string, id: string, title: string) {
  writeFileSync(
    join(dir, "skills", `${id}.json`),
    JSON.stringify({
      id,
      title,
      intent: "QA",
      source: "taught",
      createdAt: "2026-10-24T00:00:00.000Z",
      updatedAt: "2026-10-24T00:00:00.000Z",
      steps: [{ tool: "navigate", args: { url: "https://www.baidu.com" } }],
      stepCount: 1,
      stats: { success: 0, fail: 0 },
      enabled: true,
    }),
  );
}

function writeTrigger(dir: string, text: string, skillId: string, enabled = true) {
  writeFileSync(
    join(dir, "skill-triggers.json"),
    JSON.stringify({
      triggers: [
        {
          id: "trig0001",
          skillId,
          text,
          addedAt: "2026-10-24T00:00:00.000Z",
          runs: 0,
          fails: 0,
          enabled,
        },
      ],
    }),
  );
}

describe("resolveSkillStrict via runSkill", () => {
  it("runs a skill by exact id", async () => {
    const dir = tmp();
    writeSkill(dir, "qa-gate-demo", "QA门岗演示");
    const r = await runSkill(browser, dir, { id: "qa-gate-demo", dryRun: true });
    expect(r.ok).toBe(true);
    expect(r.message).toContain("qa-gate-demo");
  });

  it("hits an enabled trigger, including width and trailing punctuation, and misses when disabled", async () => {
    const dir = tmp();
    writeSkill(dir, "qa-gate-demo", "QA门岗演示");
    writeTrigger(dir, "今天北京天气怎么样", "qa-gate-demo", true);
    const hit = await runSkill(browser, dir, { query: "今天北京天气怎么样。", dryRun: true });
    expect(hit.ok).toBe(true);
    const wide = await runSkill(browser, dir, { query: "今天北京天气怎么样！", dryRun: true });
    expect(wide.ok).toBe(true);
    writeTrigger(dir, "今天北京天气怎么样", "qa-gate-demo", false);
    const off = await runSkill(browser, dir, { query: "今天北京天气怎么样", dryRun: true });
    expect(off.ok).toBe(false);
    expect(off.message).toContain("未找到妙招");
  });

  it("does not execute a title or a builtin alias", async () => {
    const dir = tmp();
    writeSkill(dir, "life-compare-shop", "电商比价演示");
    writeSkill(dir, "qa-gate-demo", "QA门岗演示");
    const byTitle = await runSkill(browser, dir, { query: "QA门岗演示", dryRun: true });
    expect(byTitle.ok).toBe(false);
    expect(byTitle.message).toBe("未找到妙招「QA门岗演示」");
    const titleIds = ((byTitle.data as { suggestions?: Array<{ id: string }> }).suggestions || []).map((s) => s.id);
    expect(titleIds).toContain("qa-gate-demo");
    const byAlias = await runSkill(browser, dir, { query: "比价", dryRun: true });
    expect(byAlias.ok).toBe(false);
    expect(byAlias.message).toContain("未找到妙招");
    const aliasIds = ((byAlias.data as { suggestions?: Array<{ id: string }> }).suggestions || []).map((s) => s.id);
    expect(aliasIds).toContain("life-compare-shop");
  });

  it("does not execute a one-character title variant", async () => {
    const dir = tmp();
    writeSkill(dir, "qa-gate-demo", "QA门岗演示");
    const r = await runSkill(browser, dir, { query: "QA门岗演示2", dryRun: true });
    expect(r.ok).toBe(false);
    expect(r.message).toContain("未找到妙招");
  });

  it("formats catalog lines and returns empty text for an empty dir", () => {
    const dir = tmp();
    expect(skillCatalogLines("")).toBe("");
    expect(skillCatalogLines(dir)).toBe("");
    writeSkill(dir, "qa-gate-demo", "QA门岗演示");
    expect(skillCatalogLines(dir)).toContain("- qa-gate-demo: QA门岗演示（1 步）");
  });
});
