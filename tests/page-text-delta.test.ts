import { describe, expect, it } from "vitest";
import { DeepSeekAgentProvider, pageTextGrowthNote } from "../src/main/agent/deepseek.js";

describe("page_text 增量标注", () => {
  it("第一次没有上次；同文本 +0；变长 +N", () => {
    expect(pageTextGrowthNote(undefined, "微博甲")).toBeUndefined();
    expect(pageTextGrowthNote("微博甲", "微博甲")).toBe("较上次 +0 字");
    const more = "微博甲新增一条";
    expect(pageTextGrowthNote("微博甲", more)).toBe(`较上次 +${more.length - "微博甲".length} 字`);
  });

  it("同 tab 连续 page_text：第二次起把增量写进工具结果", async () => {
    const sent: Array<{ messages?: Array<{ role?: string; content?: string }> }> = [];
    const texts = ["微博甲", "微博甲", "微博甲新增一条"];
    let read = 0;
    const replies = [
      toolCall("1", "page_text"),
      toolCall("2", "page_text"),
      toolCall("3", "page_text"),
      { content: "采完了" },
    ];
    const agent = new DeepSeekAgentProvider(
      { apiKey: "test", baseUrl: "https://example.test/v1", model: "m", fetchImpl: scripted(replies, sent) },
      async (name) => {
        if (name !== "page_text") return { ok: true, message: `${name} ok` };
        const text = texts[read++] || "";
        return { ok: true, message: `page_text ${text.length} chars`, data: { text, length: text.length } };
      },
    );
    const reply = await agent.chat("把这页采下来", { url: "https://weibo.com/", title: "微博", locale: "zh" });
    expect(reply).toBe("采完了");
    const toolBodies = (sent.at(-1)?.messages || []).filter((m) => m.role === "tool");
    expect(toolBodies).toHaveLength(3);
    expect(toolBodies[0]?.content).not.toContain("较上次");
    expect(toolBodies[1]?.content).toContain("较上次 +0 字");
    expect(toolBodies[2]?.content).toContain(`较上次 +${"新增一条".length} 字`);
  });

  it("repeatStop 掐断后，返回文本里留着掐断句", async () => {
    let presses = 0;
    const replies = [
      toolCall("1", "press", { key: "End" }),
      toolCall("2", "press", { key: "End" }),
      toolCall("3", "press", { key: "End" }),
      toolCall("4", "press", { key: "End" }),
      { content: "" },
    ];
    const agent = new DeepSeekAgentProvider(
      { apiKey: "test", baseUrl: "https://example.test/v1", model: "m", fetchImpl: scripted(replies, []) },
      async (name) => {
        if (name === "press") presses += 1;
        return { ok: true, message: `${name} ok` };
      },
    );
    const reply = await agent.chat("往下翻", { url: "https://weibo.com/", title: "微博", locale: "zh" });
    expect(presses).toBe(3);
    expect(reply).toContain("你陷入了重复工具调用");
    expect(reply.trim().length).toBeGreaterThan(8);
  });
});

function toolCall(id: string, name: string, args: Record<string, unknown> = {}) {
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

function scripted(
  replies: Array<{ content?: string | null; tool_calls?: unknown[] }>,
  sent: Array<{ messages?: Array<{ role?: string; content?: string }> }>,
): typeof fetch {
  let i = 0;
  return async (_url, init) => {
    sent.push(JSON.parse(String(init?.body || "{}")));
    const reply = replies[i++];
    if (!reply) throw new Error(`unexpected completion ${i}`);
    return new Response(JSON.stringify({ choices: [{ message: reply }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
}
