import { afterEach, describe, expect, it } from "vitest";
import {
  bindClientTab,
  candidateTabBusy,
  ensureSidebarClient,
  ownerForTab,
  registerClientName,
  releaseClientLease,
  resetMcpSessions,
  seatForClient,
  seatForTab,
} from "../src/main/agent/mcp-sessions.js";

afterEach(() => resetMcpSessions());

describe("T80 同一 agent 的活任务各用各的标签", () => {
  it("每个新任务都另开标签，未释放时不回到最近页", () => {
    registerClientName("ding", "丁");
    const known = ["user"];
    let seq = 0;
    const create = () => {
      seq += 1;
      const id = `tab-${seq}`;
      known.push(id);
      return id;
    };
    const bind = () =>
      bindClientTab({
        intent: "task",
        clientId: "ding",
        taskId: `job-${seq + 1}`,
        knownTabIds: known,
        createAgentTab: create,
      });

    const first = bind();
    const second = bind();
    const third = bind();
    expect(first).toBe("tab-1");
    expect(second).toBe("tab-2");
    expect(third).toBe("tab-3");
    expect(new Set([first, second, third]).size).toBe(3);
    expect(ownerForTab("tab-1")).toBe("agent:ding");
    expect(ownerForTab("tab-2")).toBe("agent:ding");
    expect(seatForTab("tab-1")).not.toBe(seatForTab("tab-2"));
    expect(seatForClient("ding")).toBe(seatForTab("tab-1"));
  });

  it("不同 client 各绑各的", () => {
    let created = 0;
    const make = (clientId: string) => {
      const known = ["user"];
      return bindClientTab({
        clientId,
        knownTabIds: known,
        createAgentTab: () => {
          created += 1;
          const id = `${clientId}-tab`;
          known.push(id);
          return id;
        },
      });
    };
    expect(make("jia")).toBe("jia-tab");
    expect(make("yi")).toBe("yi-tab");
    expect(created).toBe(2);
    expect(ownerForTab("jia-tab")).toBe("agent:jia");
    expect(ownerForTab("yi-tab")).toBe("agent:yi");
  });

  it("任何 client 的有效占用都禁止复用，显式抢页返回空", () => {
    registerClientName("jia", "甲");
    bindClientTab({
      intent: "task",
      clientId: "jia",
      taskId: "job-jia",
      tabId: "tab-x",
      knownTabIds: ["user", "tab-x"],
      createAgentTab: () => "unused",
    });
    expect(
      candidateTabBusy({
        clientId: "ding",
        candidateTabId: "tab-x",
        live: [],
      }),
    ).toBe(true);
    expect(
      candidateTabBusy({
        clientId: "ding",
        candidateTabId: "tab-y",
        live: [{ clientId: "jia", tabId: "tab-y", state: "done" }],
      }),
    ).toBe(true);
    const stolen = bindClientTab({
      intent: "task",
      clientId: "ding",
      taskId: "job-ding",
      tabId: "tab-x",
      knownTabIds: ["user", "tab-x"],
      createAgentTab: () => {
        throw new Error("should-not");
      },
    });
    expect(stolen).toBeUndefined();
    expect(ownerForTab("tab-x")).toBe("agent:jia");
    const fresh = bindClientTab({
      intent: "task",
      clientId: "ding",
      taskId: "job-ding-2",
      knownTabIds: ["user", "tab-x"],
      createAgentTab: () => "tab-z",
    });
    expect(fresh).toBe("tab-z");
  });

  it("释放后的空闲页才能被显式复用", () => {
    bindClientTab({
      intent: "task",
      clientId: "jia",
      taskId: "job-jia",
      tabId: "tab-x",
      knownTabIds: ["user", "tab-x"],
      createAgentTab: () => "unused",
    });
    releaseClientLease({ tabId: "tab-x" }, "accepted");
    const again = bindClientTab({
      intent: "task",
      clientId: "yi",
      taskId: "job-yi",
      tabId: "tab-x",
      knownTabIds: ["user", "tab-x"],
      createAgentTab: () => "unused",
    });
    expect(again).toBe("tab-x");
    expect(ownerForTab("tab-x")).toBe("agent:yi");
    expect(ownerForTab("tab-z") ).toBe("user");
  });

  it("侧栏工位 0 不占甲的序号", () => {
    ensureSidebarClient();
    bindClientTab({
      clientId: "sidebar",
      knownTabIds: ["side"],
      tabId: "side",
      createAgentTab: () => "unused",
    });
    expect(seatForTab("side")).toBe(0);
    registerClientName("jia", "甲");
    expect(seatForClient("jia")).toBe(1);
  });

  it("侧栏新标签请求激活，别的 client 不抢当前页", () => {
    const seen: boolean[] = [];
    bindClientTab({
      clientId: "sidebar",
      knownTabIds: ["user"],
      createAgentTab: (activate) => {
        seen.push(Boolean(activate));
        return "side-tab";
      },
    });
    bindClientTab({
      clientId: "jia",
      knownTabIds: ["user"],
      createAgentTab: (activate) => {
        seen.push(Boolean(activate));
        return "jia-tab";
      },
    });
    expect(seen).toEqual([true, false]);
  });
});
