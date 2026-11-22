import { afterEach, describe, expect, it } from "vitest";
import {
  acquireLease,
  activeLeaseForTab,
  assertOwnership,
  listActiveLeases,
  releaseLease,
  resetPageLeases,
} from "../src/main/agent/page-lease.js";
import {
  allocateClientTab,
  ownerForTab,
  releaseClientLease,
  resetMcpSessions,
} from "../src/main/agent/mcp-sessions.js";

afterEach(() => {
  resetPageLeases();
  resetMcpSessions();
});

describe("页面租约", () => {
  it("同一空闲页并发占用最多成功一个", () => {
    const first = acquireLease({ tabId: "tab", taskId: "a", clientId: "jia" });
    const second = acquireLease({ tabId: "tab", taskId: "b", clientId: "yi" });
    expect(first.ok).toBe(true);
    expect(second).toEqual({ ok: false, error: "tab_busy" });
    expect(listActiveLeases()).toHaveLength(1);
  });

  it("原任务续跑必须 task、tab、client 三者一致", () => {
    acquireLease({ tabId: "tab", taskId: "job", clientId: "jia" });
    const ok = assertOwnership({ tabId: "tab", clientId: "jia", taskId: "job" });
    const otherTask = assertOwnership({ tabId: "tab", clientId: "jia", taskId: "other" });
    const otherClient = assertOwnership({ tabId: "tab", clientId: "yi", taskId: "job" });
    expect(ok.ok).toBe(true);
    expect(otherTask).toEqual({ ok: false, error: "tab_busy" });
    expect(otherClient).toEqual({ ok: false, error: "tab_busy" });
    expect(listActiveLeases()).toHaveLength(1);
  });

  it("重复释放不会清掉后来的新租约", () => {
    const first = acquireLease({ tabId: "tab", taskId: "job", clientId: "jia" });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const released = releaseLease({ leaseId: first.lease.leaseId }, "compensate");
    expect(released.ok && released.already).toBe(false);
    const again = releaseLease({ leaseId: first.lease.leaseId }, "compensate");
    expect(again.ok && again.already).toBe(true);
    const next = acquireLease({ tabId: "tab", taskId: "next", clientId: "yi" });
    expect(next.ok).toBe(true);
    const late = releaseLease({ leaseId: first.lease.leaseId }, "compensate");
    expect(late.ok && late.already).toBe(true);
    expect(activeLeaseForTab("tab")?.taskId).toBe("next");
  });
});

describe("分配器", () => {
  it("两个 client 的新任务得到两个页面", () => {
    const known = ["user"];
    let n = 0;
    const open = (clientId: string) =>
      allocateClientTab({
        intent: "task",
        clientId,
        taskId: clientId,
        knownTabIds: known,
        createAgentTab: () => {
          n += 1;
          const id = `${clientId}-tab`;
          known.push(id);
          return id;
        },
      });
    const a = open("jia");
    const b = open("yi");
    expect(a.ok && a.tabId).toBe("jia-tab");
    expect(b.ok && b.tabId).toBe("yi-tab");
    expect(n).toBe(2);
  });

  it("同一 client 连续两个新任务不复用最近页", () => {
    const known = ["user"];
    let n = 0;
    const open = (taskId: string) =>
      allocateClientTab({
        intent: "task",
        clientId: "jia",
        taskId,
        knownTabIds: known,
        createAgentTab: () => {
          n += 1;
          const id = `tab-${n}`;
          known.push(id);
          return id;
        },
      });
    const first = open("a");
    const second = open("b");
    expect(first.ok && first.tabId).toBe("tab-1");
    expect(second.ok && second.tabId).toBe("tab-2");
  });

  it("已绑定页上的连续工具调用只核对所有权", () => {
    const known = ["user"];
    let n = 0;
    const create = () => {
      n += 1;
      const id = "mine";
      known.push(id);
      return id;
    };
    const first = allocateClientTab({
      intent: "address",
      clientId: "jia",
      knownTabIds: known,
      createAgentTab: create,
    });
    const second = allocateClientTab({
      intent: "address",
      clientId: "jia",
      knownTabIds: known,
      createAgentTab: () => {
        throw new Error("should-not");
      },
    });
    const third = allocateClientTab({
      intent: "address",
      clientId: "jia",
      tabId: "mine",
      knownTabIds: known,
      createAgentTab: () => {
        throw new Error("should-not");
      },
    });
    expect(first.ok && first.created).toBe(true);
    expect(second.ok && second.created).toBe(false);
    expect(third.ok && third.tabId).toBe("mine");
    expect(n).toBe(1);
    expect(listActiveLeases()).toHaveLength(1);
  });

  it("续跑留在原页，别的任务不能冒充", () => {
    const known = ["user", "tab"];
    const opened = allocateClientTab({
      intent: "task",
      clientId: "jia",
      taskId: "job",
      tabId: "tab",
      knownTabIds: known,
      createAgentTab: () => "nope",
    });
    expect(opened.ok).toBe(true);
    const resumed = allocateClientTab({
      intent: "task",
      resume: true,
      clientId: "jia",
      taskId: "job",
      tabId: "tab",
      knownTabIds: known,
      createAgentTab: () => "nope",
    });
    const impersonated = allocateClientTab({
      intent: "task",
      resume: true,
      clientId: "jia",
      taskId: "other",
      tabId: "tab",
      knownTabIds: known,
      createAgentTab: () => "nope",
    });
    expect(resumed.ok && resumed.tabId).toBe("tab");
    expect(impersonated).toEqual({ ok: false, error: "tab_busy" });
    expect(ownerForTab("tab")).toBe("agent:jia");
  });

  it("排队前已经持有租约，补偿释放后页面才空闲", () => {
    const known = ["user", "tab"];
    const queued = allocateClientTab({
      intent: "task",
      clientId: "jia",
      taskId: "job",
      tabId: "tab",
      knownTabIds: known,
      createAgentTab: () => "nope",
    });
    expect(queued.ok).toBe(true);
    expect(activeLeaseForTab("tab")?.taskId).toBe("job");
    releaseClientLease({ taskId: "job" }, "compensate");
    const taken = allocateClientTab({
      intent: "task",
      clientId: "yi",
      taskId: "next",
      tabId: "tab",
      knownTabIds: known,
      createAgentTab: () => "nope",
    });
    expect(taken.ok && taken.tabId).toBe("tab");
    expect(ownerForTab("tab")).toBe("agent:yi");
  });
});
