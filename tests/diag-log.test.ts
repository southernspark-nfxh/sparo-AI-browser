import { describe, expect, it } from "vitest";
import {
  crashLogFileName,
  crashStamp,
  formatDiagEvent,
  formatErrorDetail,
  formatMemLine,
  formatPushMinute,
  formatShellCrashContext,
  formatShellMemLine,
} from "../src/main/diag-log.js";

describe("T56 崩溃取证", () => {
  it("日志文件名带到分钟秒", () => {
    const date = new Date(2026, 10, 6, 16, 4, 7);
    expect(crashStamp(date)).toBe("20261106-160407");
    expect(crashLogFileName(date)).toBe("crash-20261106-160407.log");
  });

  it("异常和渲染进程退出都带原因", () => {
    const date = new Date("2026-11-06T08:00:00.000Z");
    expect(formatDiagEvent("uncaughtException", formatErrorDetail(new Error("diag-probe")), date)).toContain(
      "[uncaughtException] diag-probe",
    );
    expect(
      formatDiagEvent("render-process-gone", "reason=oom exitCode=536870904 url=https://zh.wikipedia.org/", date),
    ).toContain("reason=oom exitCode=536870904 url=https://zh.wikipedia.org/");
  });

  it("内存行按 MB 和标签数、运行中任务数", () => {
    const line = formatMemLine({
      rss: 180 * 1024 * 1024,
      heapUsed: 40 * 1024 * 1024,
      heapTotal: 60 * 1024 * 1024,
      external: 2 * 1024 * 1024,
      tabs: 4,
      running: 1,
    });
    expect(line).toBe("[mem] rss=180 heapUsed=40 heapTotal=60 external=2 tabs=4 running=1");
  });
});

describe("T72 壳层崩溃取证", () => {
  it("壳层内存、推送计数和崩溃现场都是一行", () => {
    expect(
      formatShellMemLine({ privateKb: 80 * 1024, sharedKb: 20 * 1024, residentKb: 90 * 1024, rendererCount: 2, rendererMb: 40 }),
    ).toBe("[mem-shell] private=80 shared=20 resident=90 renderers=2 rendererMb=40 note=ok");
    expect(
      formatPushMinute({ chromeReq: 40, chromeFlush: 10, chromeBytes: 25000, sidebarReq: 12, sidebarFlush: 12, sidebarBytes: 36000 }),
    ).toBe("[push] chrome req=40 flush=10 avgBytes=2500 sidebar req=12 flush=12 avgBytes=3000");
    expect(
      formatShellCrashContext({
        reason: "crashed",
        exitCode: -1,
        bounds: "0,0,1280x800",
        tabs: 3,
        chats: "user:4,agent:jia:20",
        tasks: "done:1",
        sinceUnresponsiveMs: 1500,
        chromeReq: 8,
        chromeFlush: 2,
        sidebarReq: 6,
        sidebarBytes: 9000,
      }),
    ).toContain("reason=crashed exitCode=-1 bounds=0,0,1280x800 tabs=3 chats=user:4,agent:jia:20 tasks=done:1 sinceUnresponsiveMs=1500");
  });

  it("还没假死过就写 none", () => {
    expect(
      formatShellCrashContext({
        reason: "crashed",
        exitCode: -1,
        bounds: "unknown",
        tabs: 0,
        chats: "none",
        tasks: "none",
        sinceUnresponsiveMs: null,
        chromeReq: 0,
        chromeFlush: 0,
        sidebarReq: 0,
        sidebarBytes: 0,
      }),
    ).toContain("sinceUnresponsiveMs=none");
  });
});
