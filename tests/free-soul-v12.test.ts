import { describe, expect, it } from "vitest";
import { FreeSoul } from "../src/main/agent/free-soul.js";

const NOTICE = "任务继续中；可随时停止或发新指令调整";

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
        function: { name, arguments: JSON.stringify({ direction: "down" }) },
      },
    ],
  };
}

function scripted(count: number, sent: Array<unknown>): typeof fetch {
  let index = 0;
  return async (_url, init) => {
    sent.push(JSON.parse(String(init?.body || "{}")));
    index += 1;
    const message = index <= count
      ? toolCall(`s${index}`, "scroll")
      : { content: "先汇报。" };
    return new Response(JSON.stringify({ choices: [{ message }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
}

function roundsOf(notices: string[]): number[] {
  return notices.map((text) => Number(text.match(/已执行 (\d+) 轮/)?.[1] || 0));
}

describe("轮次软提示", () => {
  it("34 轮任务不在 32 停，第 32 轮提醒后 33、34 轮照常执行", async () => {
    const sent: unknown[] = [];
    const ran: string[] = [];
    const notices: string[] = [];
    const agent = new FreeSoul(config(scripted(34, sent)), async (name) => {
      ran.push(name);
      return { ok: true, message: "已滚动" };
    });
    const result = await agent.run({
      input: "继续看",
      url: "https://weibo.com",
      title: "微博",
      locale: "zh",
      onSidebar: (text) => notices.push(text),
    });
    expect(ran).toHaveLength(34);
    expect(roundsOf(notices)).toEqual([32]);
    expect(notices[0]).toContain(NOTICE);
    expect(result).toEqual({ ok: true, text: "先汇报。" });
    expect(result.text).not.toContain("执行上限");
  });

  it("提醒只在 32、40、48，44 轮不另推", async () => {
    const notices: string[] = [];
    const agent = new FreeSoul(
      config(scripted(48, [])),
      async () => ({ ok: true, message: "已滚动" }),
    );
    await agent.run({
      input: "继续看",
      url: "https://weibo.com",
      title: "微博",
      locale: "zh",
      onSidebar: (text) => notices.push(text),
    });
    expect(roundsOf(notices)).toEqual([32, 40, 48]);
  });

  it("100 轮安全网结束，文案含安全上限和回复继续", async () => {
    let ran = 0;
    const agent = new FreeSoul(
      config(async () => new Response(JSON.stringify({
        choices: [{ message: toolCall(`s${ran + 1}`, "scroll") }],
      }), { status: 200, headers: { "Content-Type": "application/json" } })),
      async () => {
        ran += 1;
        return { ok: true, message: "已滚动" };
      },
    );
    const result = await agent.run({
      input: "一直看",
      url: "https://weibo.com",
      title: "微博",
      locale: "zh",
    });
    expect(ran).toBe(100);
    expect(result.ok).toBe(false);
    expect(result.text).toContain("安全上限");
    expect(result.text).toContain("回复继续");
    expect(result.text).not.toContain("已完成");
    expect(result.text).not.toContain("失败");
  });

  it("32 轮之后 abort 在 2 秒内打断", async () => {
    let calls = 0;
    let hung = false;
    const controller = new AbortController();
    const fetchImpl: typeof fetch = (_url, init) => {
      calls += 1;
      if (calls <= 32) {
        return Promise.resolve(new Response(JSON.stringify({
          choices: [{ message: toolCall(`s${calls}`, "scroll") }],
        }), { status: 200, headers: { "Content-Type": "application/json" } }));
      }
      hung = true;
      return new Promise((_resolve, reject) => {
        const fail = () => {
          const error = new Error("The operation was aborted");
          error.name = "AbortError";
          reject(error);
        };
        if (init?.signal?.aborted) fail();
        else init?.signal?.addEventListener("abort", fail, { once: true });
      });
    };
    const agent = new FreeSoul(config(fetchImpl), async () => ({ ok: true, message: "已滚动" }));
    const pending = agent.run({
      input: "继续看",
      url: "https://weibo.com",
      title: "微博",
      locale: "zh",
      signal: controller.signal,
    });
    const wait = Date.now();
    while (!hung && Date.now() - wait < 5000) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(hung).toBe(true);
    const started = Date.now();
    controller.abort();
    const result = await pending;
    expect(Date.now() - started).toBeLessThan(2000);
    expect(result.interrupted).toBe(true);
    expect(result.text).toContain("未完成");
    expect(result.text).not.toContain("已完成");
  });
});
