import { afterEach, describe, expect, it } from "vitest";
import {
  bindClientTab,
  candidateTabBusy,
  clientTabId,
  ensureSidebarClient,
  ownerForTab,
  registerClientName,
  resetMcpSessions,
  seatForClient,
  seatForTab,
} from "../src/main/agent/mcp-sessions.js";

afterEach(() => resetMcpSessions());

describe("T80 同一 agent 的活任务各用各的标签", () => {
  it("活任务占着当前标签就另开，结束后复用，不开第三张", () => {
    registerClientName("ding", "丁");
    const known = ["user"];
    let seq = 0;
    const create = () => {
      seq += 1;
      const id = seq === 1 ? "tab-x" : "tab-y";
      known.push(id);
      return id;
    };
    const live: Array<{ clientId: string; tabId: string; state: string }> = [];
    const bind = () =>
      bindClientTab({
        clientId: "ding",
        knownTabIds: known,
        createAgentTab: create,
        candidateBusy: candidateTabBusy({
          clientId: "ding",
          candidateTabId: clientTabId("ding") || "",
          live,
        }),
      });

    const first = bind();
    expect(first).toBe("tab-x");
    live.push({ clientId: "ding", tabId: "tab-x", state: "running" });

    const second = bind();
    expect(second).toBe("tab-y");
    expect(second).not.toBe(first);
    expect(ownerForTab("tab-x")).toBe("agent:ding");
    expect(ownerForTab("tab-y")).toBe("agent:ding");
    expect(seatForTab("tab-x")).not.toBe(seatForTab("tab-y"));
    expect(seatForClient("ding")).toBe(seatForTab("tab-x"));

    live.length = 0;
    const before = known.length;
    const third = bind();
    expect(known.length).toBe(before);
    expect(third === "tab-x" || third === "tab-y").toBe(true);
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

  it("别的 client 占着候选标签时不新建", () => {
    registerClientName("ding", "丁");
    bindClientTab({
      clientId: "ding",
      knownTabIds: ["user", "tab-x"],
      tabId: "tab-x",
      createAgentTab: () => "unused",
    });
    const busy = candidateTabBusy({
      clientId: "ding",
      candidateTabId: "tab-x",
      live: [{ clientId: "jia", tabId: "tab-x", state: "running" }],
    });
    expect(busy).toBe(false);
    const again = bindClientTab({
      clientId: "ding",
      knownTabIds: ["user", "tab-x"],
      createAgentTab: () => "should-not",
      candidateBusy: busy,
    });
    expect(again).toBe("tab-x");
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
