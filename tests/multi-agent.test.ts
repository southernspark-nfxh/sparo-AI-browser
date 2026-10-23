import { afterEach, describe, expect, it } from "vitest";
import {
  backgroundPoolDecision,
  bindClientTab,
  ownerForTab,
  resetMcpSessions,
} from "../src/main/agent/mcp-sessions.js";

afterEach(() => resetMcpSessions());

function world() {
  const tabs = ["user-tab"];
  let active = "user-tab";
  let n = 0;
  const bind = (clientId: string, tabId?: string) =>
    bindClientTab({
      clientId,
      tabId,
      knownTabIds: tabs,
      createAgentTab: () => {
        n += 1;
        const id = `agent-${n}`;
        tabs.push(id);
        return id;
      },
    });
  return {
    tabs,
    bind,
    active: () => active,
    setActive: (id: string) => {
      active = id;
    },
  };
}

describe("mcp client tabs", () => {
  it("gives two clients their own tabs and leaves the user page alone", () => {
    const box = world();
    const a = box.bind("clientA");
    const b = box.bind("clientB");
    expect(a).toBe("agent-1");
    expect(b).toBe("agent-2");
    expect(a).not.toBe(b);
    expect(box.active()).toBe("user-tab");
    expect(ownerForTab("agent-1")).toBe("agent:clientA");
    expect(ownerForTab("agent-2")).toBe("agent:clientB");
    expect(ownerForTab("user-tab")).toBe("user");
  });

  it("keeps implicit calls on the client's own tab", () => {
    const box = world();
    const first = box.bind("clientA");
    const second = box.bind("clientA");
    expect(second).toBe(first);
    expect(box.tabs.filter((id) => id.startsWith("agent-"))).toEqual(["agent-1"]);
  });

  it("honors an explicit tab id", () => {
    const box = world();
    box.tabs.push("picked");
    const bound = box.bind("clientA", "picked");
    expect(bound).toBe("picked");
    expect(box.bind("clientA")).toBe("picked");
    expect(ownerForTab("picked")).toBe("agent:clientA");
  });

  it("returns pool_full once three background tasks are running", () => {
    expect(backgroundPoolDecision(0).ok).toBe(true);
    expect(backgroundPoolDecision(2).ok).toBe(true);
    expect(backgroundPoolDecision(3)).toEqual({ ok: false, error: "pool_full" });
    expect(backgroundPoolDecision(4)).toEqual({ ok: false, error: "pool_full" });
  });

  it("still defaults to the active tab when no client id is present", () => {
    const box = world();
    expect(box.bind("")).toBeUndefined();
    expect(box.tabs).toEqual(["user-tab"]);
  });
});
