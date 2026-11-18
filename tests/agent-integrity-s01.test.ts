import { afterEach, describe, expect, it } from "vitest";
import { FreeSoul } from "../src/main/agent/free-soul.js";
import { gateClickText, resetClickConfirm } from "../src/main/agent/publish-gate.js";

afterEach(() => {
  resetClickConfirm();
});

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

function scripted(messages: Array<Record<string, unknown>>) {
  let index = 0;
  const fetchImpl: typeof fetch = async () => {
    const message = messages[Math.min(index, messages.length - 1)];
    index += 1;
    return new Response(JSON.stringify({ choices: [{ message }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  return fetchImpl;
}

describe("确认往返", () => {
  it("逐步确认下，确认发布之后才放行同一次发布", async () => {
    const ask = new FreeSoul(
      config(scripted([toolCall("c1", "request_confirm", { action: "发布", detail: "这篇笔记" })])),
      async () => ({ ok: true, message: "不应执行" }),
    );
    const asked = await ask.run({
      input: "发小红书",
      url: "https://creator.xiaohongshu.com",
      title: "发布",
      locale: "zh",
      execMode: "step",
    });
    expect(asked.awaitingConfirm).toBe(true);
    expect(gateClickText(true, "发布", "step").ok).toBe(false);

    const follow = new FreeSoul(
      config(scripted([{ content: "好，我再点发布。" }])),
      async () => ({ ok: true, message: "不会点" }),
    );
    await follow.run({
      input: "确认",
      url: "https://creator.xiaohongshu.com",
      title: "发布",
      locale: "zh",
      execMode: "step",
    });
    expect(gateClickText(true, "保存并认领", "auto").ok).toBe(false);
    expect(gateClickText(true, "发布", "step")).toMatchObject({ ok: true });
  });
});
