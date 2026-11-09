import { describe, expect, it, vi } from "vitest";
import { FreeSoul, foldToolResults, limitHistory, noteToolRound, TOOL_RESULT_BUDGET } from "../src/main/agent/free-soul.js";

type ToolMessage = {
  role: "tool";
  tool_call_id: string;
  name: string;
  content: string;
};

function stackFive(budget: number): { messages: Array<{ role: string; content?: string | null; tool_call_id?: string; name?: string }>; logs: string[] } {
  const messages: Array<{ role: "user" | "assistant" | "tool"; content: string | null; tool_call_id?: string; name?: string; tool_calls?: Array<{ id: string }> }> = [];
  const logs: string[] = [];
  const spy = vi.spyOn(console, "log").mockImplementation((line?: unknown) => {
    logs.push(String(line ?? ""));
  });
  try {
    for (let round = 1; round <= 5; round += 1) {
      messages.push({ role: "user", content: `用户${round}` });
      messages.push({
        role: "assistant",
        content: null,
        tool_calls: [{ id: `call-${round}` }],
      });
      const tool: ToolMessage = {
        role: "tool",
        tool_call_id: `call-${round}`,
        name: "page_text",
        content: `${"甲".repeat(200)}轮${round}${"乙".repeat(23000)}`,
      };
      noteToolRound(tool, round);
      messages.push(tool);
      foldToolResults(messages, budget);
    }
  } finally {
    spy.mockRestore();
  }
  return { messages, logs };
}

describe("T63 跨轮工具结果预算", () => {
  it("5 轮 23K、预算 60K 时从第 3 轮起折叠最老的，消息条数和配对不变", () => {
    const { messages, logs } = stackFive(60_000);
    const tools = messages.filter((message) => message.role === "tool");
    const users = messages.filter((message) => message.role === "user");
    const assistants = messages.filter((message) => message.role === "assistant");
    expect(tools).toHaveLength(5);
    expect(users).toHaveLength(5);
    expect(assistants).toHaveLength(5);
    expect(users.map((message) => message.content).join("")).toBe("用户1用户2用户3用户4用户5");
    expect(tools.map((message) => message.tool_call_id)).toEqual(["call-1", "call-2", "call-3", "call-4", "call-5"]);
    expect(String(tools[0]?.content)).toMatch(/^\[早期工具结果已折叠 r1 page_text 原 \d+ 字符\]\n/);
    expect(String(tools[1]?.content)).toContain("早期工具结果已折叠 r2");
    expect(String(tools[2]?.content)).toContain("早期工具结果已折叠 r3");
    expect(String(tools[3]?.content)).toContain("轮4");
    expect(String(tools[4]?.content)).toContain("轮5");
    expect(String(tools[0]?.content).length).toBeLessThan(500);
    expect(logs.some((line) => /\[free-soul\] fold r1 page_text \d+→\d+ chars budget=\d+\/60000/.test(line))).toBe(true);
    const total = tools.reduce((sum, message) => sum + String(message.content || "").length, 0);
    expect(total).toBeLessThanOrEqual(60_000);
  });

  it("预算内不折叠", () => {
    const { messages, logs } = stackFive(200_000);
    const tools = messages.filter((message) => message.role === "tool");
    expect(tools.every((message) => !String(message.content).includes("早期工具结果已折叠"))).toBe(true);
    expect(logs.some((line) => line.includes("[free-soul] fold"))).toBe(false);
    expect(TOOL_RESULT_BUDGET).toBe(150_000);
  });

  it("两次 run 各自计算，前一次折叠不会让下一次提前折叠", async () => {
    const page = "丙".repeat(80000);
    const runOnce = async () => {
      const bodies: string[] = [];
      let round = 0;
      const soul = new FreeSoul(
        {
          apiKey: "k",
          baseUrl: "https://example.test/v1",
          model: "m",
          mode: "local",
          fetchImpl: (async (_url: string, init?: RequestInit) => {
            bodies.push(String(init?.body || ""));
            round += 1;
            if (round <= 4) {
              return {
                ok: true,
                status: 200,
                json: async () => ({
                  choices: [{
                    message: {
                      content: "",
                      tool_calls: [{ id: `call-${round}`, type: "function", function: { name: "page_text", arguments: "{}" } }],
                    },
                  }],
                }),
              };
            }
            return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "这段先到这" } }] }) };
          }) as typeof fetch,
        },
        async () => ({ ok: true, message: "page_text", data: { text: page, length: page.length } }),
      );
      const result = await soul.run({ input: "读一节", url: "https://zh.wikipedia.org/wiki/第二次世界大战", title: "第二次世界大战" });
      return { result, bodies };
    };
    const first = await runOnce();
    const second = await runOnce();
    for (const item of [first, second]) {
      expect(item.result.ok).toBe(true);
      expect(item.bodies.at(-1)).not.toContain("早期工具结果已折叠");
      expect(item.bodies.at(-1)?.split("工具结果过长，中间已省略").length).toBe(5);
    }
  });

  it("超过 15 万字符后折叠最老的 page_text，但 tool_call_id 还在", async () => {
    const page = "丁".repeat(80000);
    const bodies: string[] = [];
    const logs: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((line?: unknown) => {
      logs.push(String(line ?? ""));
    });
    let round = 0;
    const soul = new FreeSoul(
      {
        apiKey: "k",
        baseUrl: "https://example.test/v1",
        model: "m",
        mode: "local",
        fetchImpl: (async (_url: string, init?: RequestInit) => {
          bodies.push(String(init?.body || ""));
          round += 1;
          if (round <= 8) {
            return {
              ok: true,
              status: 200,
              json: async () => ({
                choices: [{
                  message: {
                    content: "",
                    tool_calls: [{ id: `call-${round}`, type: "function", function: { name: "page_text", arguments: "{}" } }],
                  },
                }],
              }),
            };
          }
          return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "三十节里最后一节已读完，下面按时间顺序汇总。" } }] }) };
        }) as typeof fetch,
      },
      async () => ({ ok: true, message: "page_text", data: { text: page, length: page.length } }),
    );
    const result = await soul.run({ input: "逐节读维基", url: "https://zh.wikipedia.org/wiki/第二次世界大战", title: "第二次世界大战" });
    spy.mockRestore();
    expect(result.text.startsWith("三十节里最后一节已读完")).toBe(true);
    const last = bodies.at(-1) || "";
    expect(last).toContain("早期工具结果已折叠 r1 page_text");
    expect(last).toContain("call-1");
    expect(last).toContain("call-8");
    expect(logs.some((line) => /\[free-soul\] fold r1 page_text \d+→\d+ chars budget=\d+\/150000/.test(line))).toBe(true);
    expect(logs.some((line) => line.includes("BUDGET_HINT"))).toBe(false);
  });
});

describe("T63 历史预算", () => {
  it("超限历史被截，最近的条目保持完整", () => {
    const logs: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((line?: unknown) => {
      logs.push(String(line ?? ""));
    });
    const oldText = `旧${"甲".repeat(8000)}`;
    const midText = `中${"乙".repeat(8000)}`;
    const recent = `新${"丙".repeat(4000)}完整结尾`;
    const kept = limitHistory([
      { role: "user" as const, text: oldText },
      { role: "assistant" as const, text: midText },
      { role: "user" as const, text: "   " },
      { role: "assistant" as const, text: recent },
    ], 12_000);
    spy.mockRestore();
    expect(kept).toHaveLength(1);
    expect(kept[0]?.text).toBe(recent);
    expect(kept.some((item) => item.text.includes("旧"))).toBe(false);
    expect(logs.some((line) => /\[free-soul\] history trim kept=1 dropped=2 chars=\d+\/12000/.test(line))).toBe(true);
  });

  it("最新一条等于预算时原样保留，超过预算时截到预算内", () => {
    const budget = 32;
    const exact = `界${"甲".repeat(budget - 1)}`;
    const older = "更早的一句";
    const atLimit = limitHistory([
      { role: "user" as const, text: older },
      { role: "assistant" as const, text: exact },
    ], budget);
    expect(atLimit).toHaveLength(1);
    expect(atLimit[0]?.text).toBe(exact);
    expect(atLimit.reduce((sum, item) => sum + item.text.length, 0)).toBe(budget);

    const over = `头${"乙".repeat(budget)}尾`;
    const capped = limitHistory([{ role: "user" as const, text: over }], budget);
    expect(capped).toHaveLength(1);
    expect(capped[0]?.text.length).toBe(budget);
    expect(capped[0]?.text.endsWith("尾")).toBe(true);
    expect(capped[0]?.text).not.toBe(over);
  });
});

describe("T63 复审：折叠不能破坏可继续执行的结果", () => {
  it("结构化结果和素材路径保留，短结果不会被折得更长", () => {
    const logs: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((line?: unknown) => {
      logs.push(String(line ?? ""));
    });
    const workflow = `${"前".repeat(2500)}{"workOrderId":"wo-keep","draftFingerprint":"fp-keep"}`;
    const snapshot = `${"页".repeat(2500)}{"ref":"ref-keep","path":"D:\\\\shots\\\\cover.png"}`;
    const short = "只有二十个字的页面正文";
    const messages = [
      { role: "tool" as const, tool_call_id: "w", name: "run_workflow", content: workflow },
      { role: "tool" as const, tool_call_id: "s", name: "snapshot", content: snapshot },
      { role: "tool" as const, tool_call_id: "p", name: "page_text", content: short },
      { role: "tool" as const, tool_call_id: "i", name: "save_image", content: "D:\\shots\\cover.png" },
    ];
    foldToolResults(messages, 1000);
    spy.mockRestore();
    expect(messages[0]?.content).toBe(workflow);
    expect(messages[1]?.content).toContain("ref-keep");
    expect(messages[1]?.content).toContain("cover.png");
    expect(messages[2]?.content).toBe(short);
    expect(messages[3]?.content).toBe("D:\\shots\\cover.png");
    expect(messages.map((message) => message.tool_call_id)).toEqual(["w", "s", "p", "i"]);
    expect(logs.some((line) => /\[free-soul\] fold stop chars budget=\d+\/1000/.test(line))).toBe(true);
    expect(logs.some((line) => line.includes("[free-soul] fold r"))).toBe(false);
  });
});
