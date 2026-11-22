import { describe, expect, it, vi } from "vitest";
import { parseCommandUtterance, runCommand, type CommandPage, type CommandPorts } from "../src/main/agent/command-room.js";

const pages: CommandPage[] = [
  { tabId: "a", title: "店小秘", taskId: "job-a", state: "running" },
  { tabId: "b", title: "店小秘", taskId: "job-b", state: "idle" },
  { tabId: "c", title: "百度", taskId: "", state: "idle" },
];

function ports(over: Partial<CommandPorts> = {}): CommandPorts & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    openTab: (url) => {
      calls.push(`open:${url || ""}`);
      return { ok: true, tabId: "fresh", message: "已打开" };
    },
    focusTask: (taskId) => {
      calls.push(`focus:${taskId}`);
      return { ok: true, tabId: "a", message: "已回到原页面" };
    },
    switchTab: (tabId) => {
      calls.push(`switch:${tabId}`);
      return { ok: true, message: "switched" };
    },
    dispatch: (tabId, text) => {
      calls.push(`dispatch:${tabId || ""}:${text}`);
      return { ok: true, taskId: "new-job", message: "已派发" };
    },
    stopTask: (taskId) => {
      calls.push(`stop:${taskId}`);
      return { ok: true, message: "已停止" };
    },
    resumeTask: (taskId) => {
      calls.push(`resume:${taskId}`);
      return { ok: true, tabId: "a", message: "已恢复" };
    },
    closeTask: (taskId) => {
      calls.push(`close:${taskId}`);
      return { ok: true, message: "已结束" };
    },
    ackTask: (taskId) => {
      calls.push(`ack:${taskId}`);
      return { ok: true, message: "已知道" };
    },
    ...over,
  };
}

describe("总指挥控制", () => {
  it("唯一定位、停止和继续打到原任务，重名只返回候选", () => {
    const unique = ports();
    const focused = runCommand({ type: "focus", title: "百度" }, pages, unique);
    expect(focused).toMatchObject({ ok: true, tabId: "c" });
    expect(unique.calls).toEqual(["switch:c"]);

    const stopped = ports();
    expect(runCommand({ type: "stop", taskId: "job-a" }, pages, stopped)).toMatchObject({ ok: true, taskId: "job-a" });
    expect(stopped.calls).toEqual(["stop:job-a"]);

    const resumed = ports();
    expect(runCommand({ type: "resume", taskId: "job-a" }, pages, resumed).ok).toBe(true);
    expect(resumed.calls).toEqual(["resume:job-a"]);

    const ambiguous = ports();
    const result = runCommand({ type: "focus", title: "店小秘" }, pages, ambiguous);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("ambiguous");
      expect(result.choices?.map((item) => item.tabId)).toEqual(["a", "b"]);
    }
    expect(ambiguous.calls).toEqual([]);
  });

  it("忙碌页不能派发，空闲页可以，没指定页面就新开，关闭活动页要先确认", () => {
    const busy = ports();
    const denied = runCommand({ type: "dispatch", tabId: "a", text: "再编辑一个" }, pages, busy);
    expect(denied).toMatchObject({ ok: false, code: "tab_busy" });
    expect(busy.calls).toEqual([]);

    const idle = ports();
    const sent = runCommand({ type: "dispatch", tabId: "c", text: "查天气" }, pages, idle);
    expect(sent).toMatchObject({ ok: true, tabId: "c", taskId: "new-job" });
    expect(idle.calls).toEqual(["dispatch:c:查天气"]);

    const opened = ports();
    expect(runCommand({ type: "dispatch", text: "新任务" }, pages, opened).ok).toBe(true);
    expect(opened.calls[0]).toBe("open:");
    expect(opened.calls[1]).toBe("dispatch:fresh:新任务");

    const ask = ports();
    const confirm = runCommand({ type: "close", taskId: "job-a" }, pages, ask);
    expect(confirm).toMatchObject({ ok: false, code: "confirm" });
    expect(ask.calls).toEqual([]);
    const closed = ports();
    expect(runCommand({ type: "close", taskId: "job-a", confirmed: true }, pages, closed).ok).toBe(true);
    expect(closed.calls).toEqual(["close:job-a"]);
  });

  it("停掉京东是停止任务，标题不用和标签全文一致", () => {
    expect(parseCommandUtterance("把刚才京东那页停掉")).toEqual({ type: "stop", title: "京东" });
    expect(parseCommandUtterance("停下淘宝")).toEqual({ type: "stop", title: "淘宝" });
    expect(parseCommandUtterance("停止 商品A")).toEqual({ type: "stop", title: "商品A" });
    const stopped = ports();
    const pagesWithLogin: CommandPage[] = [
      { tabId: "jd", title: "京东-欢迎登录", taskId: "job-jd", state: "failed" },
      { tabId: "tb", title: "淘宝", taskId: "job-tb", state: "failed" },
    ];
    expect(runCommand({ type: "stop", title: "京东" }, pagesWithLogin, stopped)).toMatchObject({
      ok: true,
      tabId: "jd",
      taskId: "job-jd",
    });
    expect(stopped.calls).toEqual(["stop:job-jd"]);
  });

  it("高风险动作仍然走停止和确认，不会被知悉命令混掉", () => {
    const acked = ports();
    expect(runCommand({ type: "ack", taskId: "job-a" }, pages, acked).ok).toBe(true);
    expect(acked.calls).toEqual(["ack:job-a"]);
    expect(acked.calls.join(" ")).not.toContain("close");
  });
});

void vi;
