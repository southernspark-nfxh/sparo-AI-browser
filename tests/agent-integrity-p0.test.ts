import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { freeSoulToolNames } from "../src/main/agent/free-soul.js";
import { runSkill, type SkillBrowser } from "../src/main/skills/runner.js";
import {
  DXM_SMT_WORKFLOW_IDS,
  PREVIEW_CLOSED_DATA,
  PREVIEW_CLOSED_MESSAGE,
  gateDxmSmtSkill,
  gateFreeSoulWorkflow,
  previewClosedToolResult,
} from "../src/main/workflows/dxm-smt-preview.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("P0-01 预览关闭", () => {
  it("五个白名单和主技能返回同一句文案和同一结构", () => {
    for (const id of DXM_SMT_WORKFLOW_IDS) {
      const gate = gateFreeSoulWorkflow(id, {});
      expect(gate.action).toBe("closed");
      expect(gate.message).toBe(PREVIEW_CLOSED_MESSAGE);
    }
    const skill = gateDxmSmtSkill("dxm-smt-listing", {});
    expect(skill?.message).toBe(PREVIEW_CLOSED_MESSAGE);
    const workflow = previewClosedToolResult();
    const main = previewClosedToolResult({ skillId: "dxm-smt-listing" });
    expect(workflow.message).toBe(PREVIEW_CLOSED_MESSAGE);
    expect(workflow.data).toMatchObject(PREVIEW_CLOSED_DATA);
    expect(main.data).toMatchObject(PREVIEW_CLOSED_DATA);
    expect(main.data.closed).toBe(true);
    expect(workflow.message).toContain("通用页面工具");
    expect(workflow.message).toContain("保存、认领、发布、付费仍需确认");
  });

  it("关闭时 run_skill 主技能带回 code 和回落提示", async () => {
    const previous = process.env.SPARO_DXM_SMT_PREVIEW;
    delete process.env.SPARO_DXM_SMT_PREVIEW;
    const dir = mkdtempSync(join(tmpdir(), "sparo-preview-"));
    dirs.push(dir);
    mkdirSync(join(dir, "skills"), { recursive: true });
    writeFileSync(
      join(dir, "skills", "dxm-smt-listing.json"),
      readFileSync(join(process.cwd(), "strategies/skills/dxm-smt-listing.json"), "utf8"),
    );
    try {
      const result = await runSkill({} as SkillBrowser, dir, { id: "dxm-smt-listing" });
      expect(result.ok).toBe(false);
      expect(result.message).toBe(PREVIEW_CLOSED_MESSAGE);
      expect(result.data).toMatchObject({
        ...PREVIEW_CLOSED_DATA,
        skillId: "dxm-smt-listing",
      });
    } finally {
      if (previous === undefined) delete process.env.SPARO_DXM_SMT_PREVIEW;
      else process.env.SPARO_DXM_SMT_PREVIEW = previous;
    }
  });
});

describe("P0-02 蒸馏技能合同", () => {
  it("declared_actions 都是 FreeSoul 工具，且没有 execute", () => {
    const names = new Set(freeSoulToolNames());
    expect(names.has("execute")).toBe(false);
    expect(names.has("click_text")).toBe(true);
    const root = join(process.cwd(), "strategies", "skills");
    const misses: string[] = [];
    for (const file of readdirSync(root)) {
      if (!file.endsWith(".json") || file.startsWith("_")) continue;
      const skill = JSON.parse(readFileSync(join(root, file), "utf8")) as {
        id?: string;
        distilled?: boolean;
        declared_actions?: string[];
      };
      if (skill.distilled !== true || !skill.id || !Array.isArray(skill.declared_actions)) continue;
      for (const action of skill.declared_actions) {
        if (!names.has(action)) misses.push(`${skill.id}:${action}`);
      }
    }
    expect(misses).toEqual([]);
    const editor = JSON.parse(readFileSync(join(root, "dxm-smt-editor-ops.json"), "utf8")) as {
      declared_actions: string[];
      agentPlaybook: string[];
    };
    expect(editor.declared_actions).not.toContain("execute");
    expect(editor.agentPlaybook.join("\n")).toContain("click_text");
    expect(editor.agentPlaybook.join("\n")).toContain("「保存」");
  });
});
