import { describe, expect, it } from "vitest";
import { PiAgentCore } from "../src/main/agent/pi-core.js";

type SentBody = {
  messages?: Array<{
    role?: string;
    content?: string | null;
    tool_calls?: unknown[];
  }>;
  tools?: unknown[];
};

describe("Pi Agent 核心循环", () => {
  it("连续完成打开搜索页、读取正文、模型汇报，并保留完整工具事实", async () => {
    const sent: SentBody[] = [];
    const calls: string[] = [];
    const tail = "来源尾句：这是模型汇报必须能看到的证据。";
    const pageText = "搜索结果正文".padEnd(5000, "甲") + tail;
    const agent = new PiAgentCore(
      config(scripted([
        toolCall("nav-1", "navigate", { url: "https://www.bing.com/search?q=Sparo" }),
        toolCall("read-1", "page_text"),
        { content: "已根据搜索结果完成汇报。" },
      ], sent)),
      async (name) => {
        calls.push(name);
        if (name === "page_text") {
          return {
            ok: true,
            message: `page_text ${pageText.length} chars`,
            data: { text: pageText, length: pageText.length },
          };
        }
        return {
          ok: true,
          message: "已打开搜索结果",
          data: { url: "https://www.bing.com/search?q=Sparo", title: "Sparo - 搜索" },
        };
      },
    );

    const result = await agent.run({
      input: "搜索 Sparo 并汇报",
      url: "about:blank",
      title: "",
      locale: "zh",
    });

    expect(result).toEqual({ ok: true, text: "已根据搜索结果完成汇报。" });
    expect(calls).toEqual(["navigate", "page_text"]);
    expect(sent).toHaveLength(3);
    expect(sent[0]?.tools?.length).toBeGreaterThan(0);
    const finalMessages = sent[2]?.messages || [];
    expect(finalMessages.map((message) => message.role)).toEqual([
      "system",
      "user",
      "assistant",
      "tool",
      "assistant",
      "tool",
    ]);
    expect(finalMessages.at(-1)?.content).toContain(tail);
  });

  it("达到模型轮次上限时如实停止，不伪造任务完成", async () => {
    const agent = new PiAgentCore(
      {
        ...config(scripted([
          toolCall("nav-1", "navigate", { url: "https://example.com/" }),
          toolCall("read-1", "page_text"),
        ], [])),
        maxRounds: 2,
      },
      async () => ({ ok: true, message: "执行成功" }),
    );

    const result = await agent.run({ input: "持续浏览", url: "", title: "", locale: "zh" });

    expect(result.ok).toBe(false);
    expect(result.text).toContain("执行上限");
    expect(result.text).not.toContain("已完成");
  });

  it("系统提示要求两次就换路，并带上确认门和结果页通道", async () => {
    const sent: SentBody[] = [];
    const agent = new PiAgentCore(
      config(scripted([{ content: "好的。" }], sent)),
      async () => ({ ok: true, message: "不会执行" }),
    );
    await agent.run({ input: "看一下", url: "https://example.com", title: "例", locale: "zh" });
    const system = String(sent[0]?.messages?.[0]?.content || "");
    expect(system).toContain("连点");
    expect(system).toContain("验证码");
    expect(system).toContain("较上次 +N 字");
    expect(system).toContain("截至第 N 条");
    expect(system).toContain("request_confirm");
    expect(system).toContain("search_site");
    expect(system).toContain("口语段落");
    expect(system).toContain("set_file");
    expect(system).toContain("历史");
    expect(system).toContain("重置");
    expect(system).toContain("实际查看");
    expect(system).toContain("全量授权");
    expect(system).toContain("自主连续执行");
    expect(system).toContain("全部匹配");
    expect(system).toContain("连按");
    expect(system).toContain("重载");
    expect(system).not.toContain("已连续 3 次无效果");
    expect(system).not.toContain("核心版不执行发布");
    const names = ((sent[0]?.tools || []) as Array<{ function?: { name?: string } }>).map((item) => item.function?.name);
    expect(names).toContain("request_confirm");
    expect(names).toContain("search_site");
    expect(names).toContain("set_file");
    expect(names).toContain("reload");
  });

  it("模型调用 reload 会真执行一次", async () => {
    const seen: string[] = [];
    const agent = new PiAgentCore(
      config(scripted([
        toolCall("r1", "reload"),
        { content: "页面已重载。" },
      ], [])),
      async (name) => {
        seen.push(name);
        return { ok: true, message: "Reloaded" };
      },
    );
    const result = await agent.run({ input: "点按没反应", url: "https://mail.google.com", title: "Gmail", locale: "zh" });
    expect(seen).toEqual(["reload"]);
    expect(result).toEqual({ ok: true, text: "页面已重载。" });
  });

  it("同一点击连续 3 次无变化后注入换策略提示，仍按轮次上限结束", async () => {
    const sent: SentBody[] = [];
    const agent = new PiAgentCore(
      { ...config(alwaysSameClick(sent)), maxRounds: 4 },
      async () => ({ ok: true, message: "点了但页面没变" }),
    );
    const result = await agent.run({
      input: "点这个按钮",
      url: "https://kyfw.12306.cn/otn/leftTicket/init",
      title: "车票查询",
      locale: "zh",
    });
    const hint = "同一操作已连续 3 次无效果";
    expect(JSON.stringify(sent[2]?.messages || [])).not.toContain(hint);
    expect(JSON.stringify(sent[3]?.messages || [])).toContain(hint);
    expect(JSON.stringify(sent[3]?.messages || [])).toContain("整页重载");
    expect(JSON.stringify(sent[3]?.messages || [])).toContain("禁止继续重复同一操作");
    expect(result.ok).toBe(false);
    expect(result.text).toContain("执行上限");
    expect(result.text).not.toContain("已完成");
    expect(result.text).not.toContain("已放弃");
    expect(result.awaitingConfirm).toBeUndefined();
  });

  it("request_confirm 用成功态结束本轮，不执行后续工具", async () => {
    const ran: string[] = [];
    const agent = new PiAgentCore(
      config(scripted([
        toolCall("ask-1", "request_confirm", { action: "发送微博", detail: "内容是吐槽股市" }),
        toolCall("click-1", "click", { ref: "send" }),
      ], [])),
      async (name) => {
        ran.push(name);
        return { ok: true, message: "已点击" };
      },
    );
    const result = await agent.run({
      input: "发一条微博",
      url: "https://weibo.com",
      title: "微博",
      locale: "zh",
    });
    expect(ran).toEqual([]);
    expect(result).toEqual({
      ok: true,
      awaitingConfirm: true,
      text: "我准备执行：发送微博。内容是吐槽股市 确认吗？",
    });
  });

  it("用户确认后，模型再点发送时工具会执行", async () => {
    const ran: string[] = [];
    const agent = new PiAgentCore(
      config(scripted([
        toolCall("click-1", "click", { ref: "send" }),
        { content: "已发送。" },
      ], [])),
      async (name) => {
        ran.push(name);
        return { ok: true, message: "已点击发送" };
      },
    );
    const result = await agent.run({
      input: "确认",
      url: "https://weibo.com",
      title: "微博",
      locale: "zh",
      history: [
        { role: "user", text: "发一条微博" },
        { role: "assistant", text: "我准备执行：发送微博。确认吗？" },
      ],
    });
    expect(ran).toEqual(["click"]);
    expect(result).toEqual({ ok: true, text: "已发送。" });
  });

  it("page_text 从第二次起标注较上次字数，下一次 run 重新计数", async () => {
    const sent: SentBody[] = [];
    const texts = ["微博甲", "微博甲", "微博甲新增一条", "甲"];
    let read = 0;
    const agent = new PiAgentCore(
      config(scripted([
        toolCall("p1", "page_text"),
        toolCall("p2", "page_text"),
        toolCall("p3", "page_text"),
        { content: "第一轮汇报" },
      ], sent)),
      async (name) => {
        if (name !== "page_text") return { ok: true, message: `${name} ok` };
        const text = texts[read++] || "";
        return { ok: true, message: `page_text ${text.length} chars`, data: { text, length: text.length } };
      },
    );
    const first = await agent.run({ input: "读微博", url: "https://weibo.com", title: "微博", locale: "zh" });
    expect(first).toEqual({ ok: true, text: "第一轮汇报" });
    const tools = (sent.at(-1)?.messages || []).filter((message) => message.role === "tool");
    expect(tools).toHaveLength(3);
    expect(tools[0]?.content).not.toContain("较上次");
    expect(tools[1]?.content).toContain("较上次 +0 字");
    expect(tools[2]?.content).toContain(`较上次 +${"新增一条".length} 字`);

    const secondSent: SentBody[] = [];
    agent.updateConfig({
      ...config(scripted([
        toolCall("p4", "page_text"),
        { content: "第二轮" },
      ], secondSent)),
    });
    const shrunk = "甲";
    read = 3;
    await agent.run({ input: "再读一次", url: "https://weibo.com", title: "微博", locale: "zh" });
    const again = (secondSent.at(-1)?.messages || []).filter((message) => message.role === "tool");
    expect(again).toHaveLength(1);
    expect(again[0]?.content).not.toContain("较上次");
    expect(shrunk.length).toBeLessThan(texts[2].length);
  });

  it("正文变短时写成较上次负数", async () => {
    const sent: SentBody[] = [];
    const texts = ["微博甲乙丙", "甲"];
    let read = 0;
    const agent = new PiAgentCore(
      config(scripted([
        toolCall("p1", "page_text"),
        toolCall("p2", "page_text"),
        { content: "短了" },
      ], sent)),
      async () => {
        const text = texts[read++] || "";
        return { ok: true, message: `page_text ${text.length} chars`, data: { text, length: text.length } };
      },
    );
    await agent.run({ input: "再读", url: "https://weibo.com", title: "微博", locale: "zh" });
    const tools = (sent.at(-1)?.messages || []).filter((message) => message.role === "tool");
    expect(tools[1]?.content).toContain(`较上次 -${"微博甲乙丙".length - "甲".length} 字`);
  });

  it("三次相同 page_text 中间夹滚动仍注入正文提示，并且继续执行", async () => {
    const sent: SentBody[] = [];
    const ran: string[] = [];
    const steps = [
      toolCall("p1", "page_text"),
      toolCall("s1", "scroll", { direction: "down" }),
      toolCall("p2", "page_text"),
      toolCall("s2", "scroll", { direction: "down" }),
      toolCall("p3", "page_text"),
      toolCall("s3", "scroll", { direction: "down" }),
      { content: "截至目前读到 2 条。" },
    ];
    const agent = new PiAgentCore(
      { ...config(scripted(steps, sent)), maxRounds: 24 },
      async (name) => {
        ran.push(name);
        if (name === "page_text") {
          return { ok: true, message: "page_text 4 chars", data: { text: "同样", length: 2 } };
        }
        return { ok: true, message: "已向下滚动" };
      },
    );
    const result = await agent.run({ input: "总结微博", url: "https://weibo.com", title: "微博", locale: "zh" });
    const hint = "page_text 连续 3 次读到同样内容";
    expect(JSON.stringify(sent[4]?.messages || [])).not.toContain(hint);
    expect(JSON.stringify(sent[5]?.messages || [])).toContain(hint);
    expect(ran).toEqual(["page_text", "scroll", "page_text", "scroll", "page_text", "scroll"]);
    expect(result).toEqual({ ok: true, text: "截至目前读到 2 条。" });
    expect(result.text).not.toContain("执行上限");
  });

  it("第 24/32 轮注入一次预算提示，不伪造最终回复", async () => {
    const sent: SentBody[] = [];
    const steps = [
      ...Array.from({ length: 23 }, (_, index) => toolCall(`s${index}`, "scroll", { direction: "down" })),
      { content: "信息够了，先汇报。" },
    ];
    const agent = new PiAgentCore(
      config(scripted(steps, sent)),
      async () => ({ ok: true, message: "已滚动" }),
    );
    const result = await agent.run({ input: "继续看", url: "https://weibo.com", title: "微博", locale: "zh" });
    const hint = "已执行 24/32 轮";
    expect(JSON.stringify(sent[22]?.messages || [])).not.toContain(hint);
    const last = JSON.stringify(sent[23]?.messages || []);
    expect(last).toContain(hint);
    expect(last.split(hint).length - 1).toBe(1);
    expect(result).toEqual({ ok: true, text: "信息够了，先汇报。" });
  });
});

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

function alwaysSameClick(sent: SentBody[]): typeof fetch {
  return async (_url, init) => {
    sent.push(JSON.parse(String(init?.body || "{}")) as SentBody);
    return new Response(JSON.stringify({ choices: [{ message: toolCall("click-same", "click", { ref: "e12" }) }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
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
