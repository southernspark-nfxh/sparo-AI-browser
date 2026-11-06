import { afterEach, describe, expect, it } from "vitest";
import {
  AGENT_COLORS,
  bindClientTab,
  colorForClient,
  listClientSessions,
  registerClientName,
  resetMcpSessions,
} from "../src/main/agent/mcp-sessions.js";

afterEach(() => resetMcpSessions());

describe("T51 agent 显示名与颜色", () => {
  it("不带名字时按接入顺序叫甲、乙，同一 client 颜色恒定", () => {
    const first = registerClientName("alpha", "");
    const second = registerClientName("beta", "");
    expect(first.name).toBe("Agent 甲");
    expect(second.name).toBe("Agent 乙");
    expect(colorForClient("alpha")).toBe(first.color);
    expect(colorForClient("alpha")).toBe(colorForClient("alpha"));
    expect(AGENT_COLORS).toContain(first.color);
    expect(AGENT_COLORS).toContain(second.color);
    const renamed = registerClientName("alpha", "Cursor");
    expect(renamed.name).toBe("Cursor");
    expect(renamed.color).toBe(first.color);
    expect(renamed.seat).toBe(first.seat);
  });

  it("验收甲原样保留，超长按字符而不是字节截断", () => {
    expect(registerClientName("jia", "验收甲").name).toBe("验收甲");
    const raw = "审".repeat(30);
    const named = registerClientName("long", raw);
    expect(named.name).toBe("审".repeat(24));
    expect(named.name).toHaveLength(24);
    expect(Buffer.byteLength(named.name, "utf8")).toBe(72);
  });

  it("名字超过 24 字会截断，绑定标签不冲掉已有名字", () => {
    const raw = "一二三四五六七八九十一二三四五六七八九十额外的字啊";
    const named = registerClientName("gamma", raw);
    expect(named.name).toHaveLength(24);
    expect(named.name).toBe(raw.slice(0, 24));
    bindClientTab({
      clientId: "gamma",
      knownTabIds: [],
      createAgentTab: () => "tab-gamma",
    });
    expect(listClientSessions().find((item) => item.clientId === "gamma")?.name).toBe(raw.slice(0, 24));
    expect(listClientSessions().find((item) => item.clientId === "gamma")?.tabId).toBe("tab-gamma");
  });
});
