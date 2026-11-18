import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runSkill, type SkillBrowser } from "../src/main/skills/runner.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("保存不再被技能门拦住", () => {
  it("采集箱技能不再把 save 写成硬门，保存脚本会执行", async () => {
    const raw = readFileSync(join(process.cwd(), "strategies/skills/dxm-crawl-prep.json"), "utf8");
    const skill = JSON.parse(raw) as { human_gates: string[] };
    expect(skill.human_gates).not.toContain("save");
    expect(skill.human_gates).toContain("保存并认领");

    const dir = mkdtempSync(join(tmpdir(), "sparo-save-open-"));
    dirs.push(dir);
    mkdirSync(join(dir, "skills"), { recursive: true });
    writeFileSync(
      join(dir, "skills", "plain-save.json"),
      JSON.stringify({
        id: "plain-save",
        title: "直接保存",
        intent: "测保存不再停门",
        source: "seeded",
        createdAt: "2026-11-18T00:00:00.000Z",
        updatedAt: "2026-11-18T00:00:00.000Z",
        steps: [
          {
            id: "save",
            tool: "execute",
            args: {
              script:
                '(() => { const button = [...document.querySelectorAll("button")].find((el) => el.textContent === "保存"); button.click(); return "已点保存"; })()',
            },
          },
        ],
        stepCount: 1,
        stats: { success: 0, fail: 0 },
        enabled: true,
      }),
    );
    const scripts: string[] = [];
    const browser = {
      getUrl: () => "https://www.dianxiaomi.com/web/productCrawl/edit?id=1",
      navigate: async () => ({ ok: true, message: "opened" }),
      snapshot: async () => ({ ok: true, message: "", data: { elements: [] } }),
      click: async () => ({ ok: true, message: "" }),
      fill: async () => ({ ok: true, message: "" }),
      clickText: async () => ({ ok: true, message: "" }),
      waitFor: async () => ({ ok: true, message: "" }),
      pageText: async () => ({ ok: true, message: "", data: { text: "" } }),
      setPaused: () => undefined,
      execute: async (script: string) => {
        scripts.push(script);
        return { ok: true, message: "ran" };
      },
    } as SkillBrowser;
    const result = await runSkill(browser, dir, { id: "plain-save" });
    expect(result.ok).toBe(true);
    expect(result.message).not.toContain("需确认保存");
    expect(scripts.some((script) => script.includes("保存"))).toBe(true);
  });
});
