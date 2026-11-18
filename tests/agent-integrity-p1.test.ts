import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { agentCapabilityBrief } from "../src/main/agent/intent-router.js";
import { sealWorkOrder } from "../src/main/agent/loop.js";
import { recoveryLine, stepNeedsFreshConfirm } from "../src/main/agent/mission-journal.js";
import { analyzeSlots } from "../src/main/agent/slots.js";
import { FreeSoul, freeSoulToolNames, systemPrompt } from "../src/main/agent/free-soul.js";
import {
  readTaskSummaries,
  upsertTaskSummary,
  writeTaskSummaries,
} from "../src/main/agent/task-summary.js";
import { runSkill, runnerFailureCode, type SkillBrowser } from "../src/main/skills/runner.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("P1-02 内联稿件", () => {
  it("只给平台和内联标题正文时不再问目录", () => {
    const text = "发到头条\n标题：QA无目录\n正文：这是一段验收正文，用来填进编辑器。";
    const snap = analyzeSlots(text);
    expect(snap.unknown).not.toContain("articleDir");
    const sealed = sealWorkOrder({
      raw: text,
      intent: "发头条",
      kind: "publish",
      deliverables: [],
      known: { platform: "toutiao" },
      unknown: [],
      decision: "act",
      approach: "",
    });
    expect(sealed.blockedSlot).not.toBe("articleDir");
    expect(sealed.decision).not.toBe("ask");
  });

  it("英文路由不再索要目录，也不再写旧句", () => {
    const en = agentCapabilityBrief("en");
    expect(en).not.toContain("ask for two things");
    expect(en).not.toContain("do not just open the publish page");
    expect(en).toContain("inline title");
  });
});

describe("P1-03 失败码", () => {
  it("临时失败、校验失败和硬门各有代码", () => {
    expect(runnerFailureCode("页面找不到按钮")).toBe("transient_tool_failure");
    expect(runnerFailureCode("未找到技能「x」")).toBe("validation_failed");
    expect(runnerFailureCode("需要登录")).toBe("hard_gate");
    expect(runnerFailureCode("需确认保存")).toBe("waiting_human");
  });

  it("找不到技能时把 validation_failed 交回模型", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sparo-code-"));
    dirs.push(dir);
    const result = await runSkill({} as SkillBrowser, dir, { id: "missing-skill" });
    expect(result.ok).toBe(false);
    expect((result.data as { code?: string }).code).toBe("validation_failed");
  });
});

describe("P1-05 与 P1-01", () => {
  it("new_tab 已注册，提示里有三档提问", async () => {
    expect(freeSoulToolNames()).toContain("new_tab");
    const prompt = systemPrompt("https://www.dianxiaomi.com", "店小秘", "step");
    expect(prompt).toContain("提问分三档");
    expect(prompt).toContain("页面事实");
    expect(prompt).toContain("保存、认领、发布、付费不在字段自决范围内");
    const sent: Array<{ tools?: Array<{ function?: { name?: string; description?: string } }> }> = [];
    const agent = new FreeSoul(
      {
        apiKey: "test",
        baseUrl: "https://example.test/v1",
        model: "test-model",
        fetchImpl: async (_url, init) => {
          sent.push(JSON.parse(String(init?.body || "{}")));
          return new Response(JSON.stringify({ choices: [{ message: { content: "好。" } }] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        },
      },
      async () => ({ ok: true, message: "不会执行" }),
    );
    await agent.run({ input: "看一下", url: "https://example.com", title: "例" });
    const spec = sent[0]?.tools?.find((item) => item.function?.name === "new_tab");
    expect(spec?.function?.description).toContain("不抢用户正在看的页面焦点");
    const workflow = sent[0]?.tools?.find((item) => item.function?.name === "run_workflow");
    expect(workflow?.function?.description).toContain("waiting_human");
    expect(workflow?.function?.description).toContain("hard_gate");
    expect(workflow?.function?.description).toContain("禁止绕过保存、认领、发布、付费");
  });
});

describe("P1-04 恢复与摘要", () => {
  it("危险步骤要重新确认，只读步骤不用", () => {
    expect(stepNeedsFreshConfirm({ label: "保存", cap: "click_text" })).toBe(false);
    expect(stepNeedsFreshConfirm({ label: "保存并认领", cap: "click_text" })).toBe(true);
    expect(stepNeedsFreshConfirm({ label: "删除", cap: "click_text" })).toBe(true);
    expect(stepNeedsFreshConfirm({ label: "查车票", cap: "train_search" })).toBe(false);
  });

  it("恢复预览带上目标、完成步骤、页面和待确认", () => {
    const line = recoveryLine({
      openedAt: Date.now(),
      mission: {
        id: "m1",
        raw: "改这个商品",
        goal: {
          raw: "改这个商品",
          intent: "改商品标题",
          kind: "form",
          deliverables: [],
          known: {},
          unknown: [],
          decision: "act",
          approach: "",
        },
        plan: [],
        findings: [{ step: { id: "r", cap: "page_text", label: "读页", covers: ["page"] }, text: "编辑页", url: "https://www.dianxiaomi.com/edit?id=1", ok: true }],
        state: "waiting_human",
        ask: "确认保存吗",
        brainPlan: {
          createdAt: 1,
          steps: [
            { id: "a", label: "读标题", cap: "page_text", covers: ["page"], status: "done" },
            { id: "b", label: "保存", cap: "click_text", covers: ["form"], status: "pending" },
          ],
        },
      },
    });
    expect(line).toContain("未关任务");
    expect(line).toContain("改商品标题");
    expect(line).toContain("读标题");
    expect(line).toContain("https://www.dianxiaomi.com/edit?id=1");
    expect(line).toContain("确认保存吗");
  });

  it("任务摘要写盘后还能读回", () => {
    const dir = mkdtempSync(join(tmpdir(), "sparo-summary-"));
    dirs.push(dir);
    writeTaskSummaries(dir, upsertTaskSummary([], {
      taskId: "t1",
      goal: "读店小秘首页",
      status: "done",
      lastStep: "已打开首页",
      at: 1,
    }));
    expect(readTaskSummaries(dir)).toEqual([
      { taskId: "t1", goal: "读店小秘首页", status: "done", lastStep: "已打开首页", at: 1 },
    ]);
  });
});
