import { describe, expect, it } from "vitest";
import { FreeSoul } from "../src/main/agent/free-soul.js";

describe("T49 云端计量按调用传", () => {
  it("两个并发任务的 X-Sparo-Task 各自等于自己的任务 ID", async () => {
    const seen: string[] = [];
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const soul = new FreeSoul(
      {
        apiKey: "k",
        baseUrl: "https://example.test/v1",
        model: "m",
        mode: "cloud",
        fetchImpl: (async (_url: string, init?: RequestInit) => {
          const headers = (init?.headers || {}) as Record<string, string>;
          seen.push(headers["X-Sparo-Task"] || "");
          if (seen.length >= 2) release();
          await gate;
          return {
            ok: true,
            status: 200,
            json: async () => ({ choices: [{ message: { content: "好" } }] }),
          };
        }) as typeof fetch,
      },
      async () => ({ ok: true, message: "" }),
    );

    const [a, b] = await Promise.all([
      soul.run({ input: "甲", url: "https://a.example", title: "甲", taskId: "cloud-jia" }),
      soul.run({ input: "乙", url: "https://b.example", title: "乙", taskId: "cloud-yi" }),
    ]);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(seen.slice().sort()).toEqual(["cloud-jia", "cloud-yi"]);
  });
});
