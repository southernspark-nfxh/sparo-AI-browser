import { afterEach, describe, expect, it } from "vitest";
import {
  agentClientFromScope,
  bindClientTab,
  claimTabForClient,
  ownerForTab,
  registerClientName,
  resetMcpSessions,
} from "../src/main/agent/mcp-sessions.js";

afterEach(() => resetMcpSessions());

describe("T60 一个 agent 多张标签", () => {
  it("作用域里连续三张都归同一个 agent，作用域外的第四张不归", () => {
    registerClientName("jia", "验收甲");
    for (const id of ["t1", "t2", "t3"]) {
      const clientId = agentClientFromScope("agent:jia");
      expect(clientId).toBe("jia");
      claimTabForClient(clientId, id);
    }
    expect(ownerForTab("t1")).toBe("agent:jia");
    expect(ownerForTab("t2")).toBe("agent:jia");
    expect(ownerForTab("t3")).toBe("agent:jia");
    expect(agentClientFromScope("user")).toBe("");
    expect(ownerForTab("t4")).toBe("user");
    expect(
      bindClientTab({
        clientId: "jia",
        knownTabIds: ["t1", "t2", "t3"],
        createAgentTab: () => "nope",
      }),
    ).toBe("t3");
  });

  it("从已归属的页面打开，继承同一个 agent", () => {
    claimTabForClient("jia", "origin");
    const clientId = agentClientFromScope(undefined, ownerForTab("origin"));
    expect(clientId).toBe("jia");
    claimTabForClient(clientId, "child");
    expect(ownerForTab("child")).toBe("agent:jia");
    expect(ownerForTab("origin")).toBe("agent:jia");
    expect(agentClientFromScope(undefined, "user")).toBe("");
  });
});
