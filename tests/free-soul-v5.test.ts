import { describe, expect, it } from "vitest";
import { FreeSoul, sanitize } from "../src/main/agent/free-soul.js";

type SentMessage = {
  role: string;
  content?: string | null;
  tool_calls?: Array<{ id?: string; function?: { name?: string } }>;
  tool_call_id?: string;
};

type SentBody = { messages?: SentMessage[] };

function config(fetchImpl: typeof fetch) {
  return {
    apiKey: "test",
    baseUrl: "https://example.test/v1",
    model: "test-model",
    fetchImpl,
  };
}

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
  sent: SentBody[],
): typeof fetch {
  let index = 0;
  return async (_url, init) => {
    sent.push(JSON.parse(String(init?.body || "{}")) as SentBody);
    const reply = replies[index++];
    if (!reply) throw new Error(`unexpected completion ${index}`);
    return new Response(JSON.stringify({ choices: [{ message: reply }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
}

function pageText() {
  return { ok: true, message: "page_text 2 chars", data: { text: "同样", length: 2 } };
}

describe("tool_calls 消息序列", () => {
  it("并行调用触发提示时，user 提示在全部 tool 消息之后、不在中间", async () => {
    const sent: SentBody[] = [];
    const steps = [
      toolCall("p1", "page_text"),
      toolCall("p2", "page_text"),
      {
        content: null,
        tool_calls: [
          {
            id: "p3",
            type: "function" as const,
            function: { name: "page_text", arguments: "{}" },
          },
          {
            id: "t3",
            type: "function" as const,
            function: { name: "get_title", arguments: "{}" },
          },
        ],
      },
      { content: "进度停住了，先汇报。" },
    ];
    const agent = new FreeSoul(config(scripted(steps, sent)), async (name) => {
      if (name === "page_text") return pageText();
      return { ok: true, message: "标题仍是投稿" };
    });
    const result = await agent.run({
      input: "看上传进度",
      url: "https://member.bilibili.com",
      title: "投稿",
      locale: "zh",
    });
    const messages = sent[3]?.messages || [];
    const assistantAt = messages.findIndex((message) => (message.tool_calls?.length || 0) === 2);
    expect(assistantAt).toBeGreaterThanOrEqual(0);
    const assistant = messages[assistantAt];
    const followed = messages.slice(assistantAt + 1);
    expect(followed[0]?.role).toBe("tool");
    expect(followed[1]?.role).toBe("tool");
    expect(followed[0]?.tool_call_id).toBe(assistant.tool_calls?.[0]?.id);
    expect(followed[1]?.tool_call_id).toBe(assistant.tool_calls?.[1]?.id);
    expect(followed[2]?.role).toBe("user");
    expect(followed[2]?.content).toContain("page_text 连续 3 次读到同样内容");
    expect(followed.slice(0, 2).some((message) => message.role === "user")).toBe(false);
    expect(result).toEqual({ ok: true, text: "进度停住了，先汇报。" });
  });

  it("call.id 缺失时 assistant 与 tool 消息 id 一致且不为空", async () => {
    const sent: SentBody[] = [];
    const steps = [
      {
        content: null,
        tool_calls: [
          { type: "function" as const, function: { name: "get_url", arguments: "{}" } },
          { type: "function" as const, function: { name: "get_title", arguments: "{}" } },
        ],
      },
      { content: "看过了。" },
    ];
    const agent = new FreeSoul(config(scripted(steps, sent)), async () => ({
      ok: true,
      message: "已读",
    }));
    await agent.run({ input: "看一下", url: "https://example.com", title: "例", locale: "zh" });
    const messages = sent[1]?.messages || [];
    const assistantAt = messages.findIndex((message) => (message.tool_calls?.length || 0) === 2);
    const assistant = messages[assistantAt];
    const ids = (assistant.tool_calls || []).map((call) => call.id || "");
    expect(ids).toEqual(["1-0", "1-1"]);
    expect(ids.every((id) => id.length > 0)).toBe(true);
    expect(messages[assistantAt + 1]).toMatchObject({ role: "tool", tool_call_id: "1-0" });
    expect(messages[assistantAt + 2]).toMatchObject({ role: "tool", tool_call_id: "1-1" });
  });

  it("sanitize 能修坏序列", () => {
    const broken = [
      {
        role: "assistant" as const,
        content: null,
        tool_calls: [
          { id: "A", type: "function" as const, function: { name: "page_text", arguments: "{}" } },
          { id: "B", type: "function" as const, function: { name: "get_title", arguments: "{}" } },
        ],
      },
      { role: "tool" as const, tool_call_id: "A", name: "page_text", content: "读过" },
      { role: "user" as const, content: "page_text 连续 3 次读到同样内容，页面已无新信息。" },
      { role: "tool" as const, tool_call_id: "B", name: "get_title", content: "标题" },
    ];
    const fixed = sanitize(broken);
    expect(broken[2]?.role).toBe("user");
    const assistantAt = fixed.findIndex((message) => message.role === "assistant");
    const followed = fixed.slice(assistantAt + 1);
    const covered: string[] = [];
    for (const message of followed) {
      if (message.role !== "tool") break;
      covered.push(message.tool_call_id || "");
    }
    expect(covered).toEqual(["A", "B"]);
    expect(followed[1]?.content).toBe("（该工具调用未执行）");
    expect(followed[2]?.role).toBe("user");
  });
});
