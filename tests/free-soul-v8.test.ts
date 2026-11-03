import { describe, expect, it } from "vitest";
import { FreeSoul } from "../src/main/agent/free-soul.js";

const INTERRUPTED = "（任务被用户打断，未完成的步骤不做宣称。已做的操作以工具记录为准。）";

function config(fetchImpl: typeof fetch) {
  return {
    apiKey: "test",
    baseUrl: "https://example.test/v1",
    model: "test-model",
    fetchImpl,
  };
}

function toolCall(id: string, name: string) {
  return {
    content: null,
    tool_calls: [
      {
        id,
        type: "function" as const,
        function: { name, arguments: "{}" },
      },
    ],
  };
}

describe("随时可打断", () => {
  it("模型请求一直不返回时，abort 在 1 秒内如实打断", async () => {
    const fetchImpl: typeof fetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        const fail = () => {
          const error = new Error("The operation was aborted");
          error.name = "AbortError";
          reject(error);
        };
        if (init?.signal?.aborted) fail();
        else init?.signal?.addEventListener("abort", fail, { once: true });
      });
    const agent = new FreeSoul(config(fetchImpl), async () => ({ ok: true, message: "不会执行" }));
    const controller = new AbortController();
    const started = Date.now();
    const pending = agent.run({
      input: "看一下",
      url: "https://example.com",
      title: "例",
      locale: "zh",
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 30);
    const result = await pending;
    expect(Date.now() - started).toBeLessThan(1000);
    expect(result).toEqual({ ok: true, text: INTERRUPTED, interrupted: true });
    expect(result.text).not.toContain("已完成");
    expect(result.text).not.toContain("失败");
  });

  it("正常轮次之间 abort，不把半截 assistant/tool 发给模型", async () => {
    const sent: Array<{ messages?: Array<{ role?: string; tool_calls?: unknown[]; tool_call_id?: string }> }> = [];
    const controller = new AbortController();
    let calls = 0;
    const fetchImpl: typeof fetch = async (_url, init) => {
      calls += 1;
      sent.push(JSON.parse(String(init?.body || "{}")));
      return new Response(JSON.stringify({ choices: [{ message: toolCall("c1", "get_title") }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
    const agent = new FreeSoul(config(fetchImpl), async () => {
      controller.abort();
      return { ok: true, message: "标题" };
    });
    const result = await agent.run({
      input: "看标题",
      url: "https://example.com",
      title: "例",
      locale: "zh",
      signal: controller.signal,
    });
    expect(result).toEqual({ ok: true, text: INTERRUPTED, interrupted: true });
    expect(calls).toBe(1);
    const messages = sent[0]?.messages || [];
    const assistantAt = messages.findIndex((message) => (message.tool_calls?.length || 0) > 0);
    expect(assistantAt).toBe(-1);
    expect(messages.some((message) => message.role === "tool")).toBe(false);
  });
});
