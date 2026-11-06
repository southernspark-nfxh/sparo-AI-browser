import { describe, expect, it } from "vitest";
import { crashLogFileName, crashStamp, formatDiagEvent, formatErrorDetail, formatMemLine } from "../src/main/diag-log.js";

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
