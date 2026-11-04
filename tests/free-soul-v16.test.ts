import { describe, expect, it } from "vitest";
import { FreeSoul } from "../src/main/agent/free-soul.js";
import { SPARO_AGENT_GUIDE } from "../src/main/agent/agent-guide.js";

const SKILL_LINE = "带站点语义的多步任务（发布、上品、采集、生活规划）先 match_skill；命中即优先 run_skill 按剧本走，未命中或剧本执行失败自动回落通用工具路径，不因技能问题中断任务。";

function config(fetchImpl: typeof fetch) {
  return {
    apiKey: "test",
    baseUrl: "https://example.test/v1",
    model: "test-model",
    fetchImpl,
  };
}

function toolCall(id: string, name: string, args: Record<string, unknown>) {
  return {
    content: null,
    tool_calls: [
      {
        id,
        type: "function" as const,
        function: { name, arguments: JSON.stringify(args) },
      },
    ],
  };
}

describe("内核技能工具", () => {
  it("step 和 auto 都要求先匹配技能，失败再回落", async () => {
    const sent: Array<{ messages?: Array<{ content?: string }> }> = [];
    const fetchImpl: typeof fetch = async (_url, init) => {
      sent.push(JSON.parse(String(init?.body || "{}")));
      return new Response(JSON.stringify({ choices: [{ message: { content: "好。" } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
    const agent = new FreeSoul(config(fetchImpl), async () => ({ ok: true, message: "不会执行" }));
    await agent.run({ input: "发微博", url: "https://weibo.com", title: "微博", locale: "zh", execMode: "step" });
    await agent.run({ input: "发微博", url: "https://weibo.com", title: "微博", locale: "zh", execMode: "auto" });
    const step = String(sent[0]?.messages?.[0]?.content || "");
    const auto = String(sent[1]?.messages?.[0]?.content || "");
    const tools = JSON.stringify(sent[0]);
    expect(step).toContain(SKILL_LINE);
    expect(auto).toContain(SKILL_LINE);
    expect(step).toContain("全量授权");
    expect(auto).toContain("直接执行");
    expect(tools).toContain("match_skill");
    expect(tools).toContain("run_skill");
    expect(SPARO_AGENT_GUIDE).toContain("submit_task 的 text 用自然指令即可，命中技能会自动走剧本");
  });

  it("命中后走 run_skill，失败则继续通用路径", async () => {
    const ran: string[] = [];
    const steps = [
      toolCall("m1", "match_skill", { query: "发微博" }),
      toolCall("r1", "run_skill", { id: "weibo-post" }),
      { content: "剧本没走通，已改用页面操作发完。" },
    ];
    let index = 0;
    const fetchImpl: typeof fetch = async () => {
      const message = steps[index++] || { content: "结束" };
      return new Response(JSON.stringify({ choices: [{ message }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
    const agent = new FreeSoul(config(fetchImpl), async (name) => {
      ran.push(name);
      if (name === "match_skill") return { ok: true, message: "best: 微博自动发帖 (9)" };
      if (name === "run_skill") return { ok: false, message: "剧本执行失败" };
      return { ok: false, message: `未知工具：${name}` };
    });
    const result = await agent.run({ input: "发一条微博", url: "https://weibo.com", title: "微博", locale: "zh" });
    expect(ran).toEqual(["match_skill", "run_skill"]);
    expect(result).toEqual({ ok: true, text: "剧本没走通，已改用页面操作发完。" });
  });
});
