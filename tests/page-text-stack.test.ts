import { describe, expect, it } from "vitest";
import { FreeSoul } from "../src/main/agent/free-soul.js";

/**
 * T56 结论（只证明，不修；修复另立 T63）：
 * page_text 单次最多 80000 字，送进模型前 serializeResult 把单条压到约 2.4 万字。
 * 压过的正文每一轮都追加进 messages，旧轮不淘汰，一轮任务里没有字符预算。
 */
describe("T56 page_text 入栈", () => {
  it("截断后的正文每轮追加，旧轮还在", async () => {
    const page = "甲".repeat(80000);
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
          if (round <= 3) {
            return {
              ok: true,
              status: 200,
              json: async () => ({
                choices: [
                  {
                    message: {
                      content: "",
                      tool_calls: [
                        {
                          id: `call-${round}`,
                          type: "function",
                          function: { name: "page_text", arguments: "{}" },
                        },
                      ],
                    },
                  },
                ],
              }),
            };
          }
          return {
            ok: true,
            status: 200,
            json: async () => ({ choices: [{ message: { content: "读完了" } }] }),
          };
        }) as typeof fetch,
      },
      async (name) => {
        if (name !== "page_text") return { ok: false, message: "未用" };
        return { ok: true, message: `page_text ${page.length} chars`, data: { text: page, length: page.length } };
      },
    );

    const result = await soul.run({ input: "读维基", url: "https://zh.wikipedia.org/wiki/第二次世界大战", title: "第二次世界大战" });
    expect(result.ok).toBe(true);
    expect(bodies.length).toBe(4);
    const last = bodies[3];
    expect(last.includes(page)).toBe(false);
    expect(last.split("工具结果过长，中间已省略").length - 1).toBe(3);
    expect(last.includes("call-1")).toBe(true);
    expect(last.includes("call-3")).toBe(true);
    expect(bodies[3].length).toBeGreaterThan(bodies[2].length);
    expect(bodies[2].length).toBeGreaterThan(bodies[1].length);
  });
});
