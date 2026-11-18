import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const dir = join(process.cwd(), "strategies/skills");
const files = readdirSync(dir).filter((f) => f.endsWith(".json") && !f.startsWith("_"));

describe("官方技能包：本机能跑的最低字段", () => {
  it("每个种子包有 id / title / intent / steps，agentPlaybook 若有则是数组", () => {
    expect(files.length).toBeGreaterThan(20);
    for (const f of files) {
      const skill = JSON.parse(readFileSync(join(dir, f), "utf8")) as {
        id?: string;
        title?: string;
        intent?: string;
        steps?: unknown;
        agentPlaybook?: unknown;
      };
      expect(skill.id, f).toBeTruthy();
      expect(skill.title, f).toBeTruthy();
      expect(skill.intent, f).toBeTruthy();
      expect(Array.isArray(skill.steps), f).toBe(true);
      if (skill.agentPlaybook !== undefined) {
        expect(Array.isArray(skill.agentPlaybook), `${f} agentPlaybook 应是数组，不要改成对象`).toBe(
          true,
        );
      }
    }
  });

  it("店小秘编辑技能只用页面工具，保存走 click_text", () => {
    const skill = JSON.parse(readFileSync(join(dir, "dxm-smt-editor-ops.json"), "utf8")) as {
      declared_actions?: string[];
      agentPlaybook?: string[];
    };
    expect(skill.declared_actions).not.toContain("execute");
    const text = (skill.agentPlaybook || []).join("\n");
    expect(text).toContain("click_text");
    expect(text).toContain("保存");
    expect(text).not.toContain("window.__jobRes");
    expect(text).not.toContain("requestAnimationFrame");
  });
});
