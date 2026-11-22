import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("electron", () => ({
  BrowserWindow: class BrowserWindow {},
  WebContentsView: class WebContentsView {},
  Menu: { buildFromTemplate: () => ({ popup: () => undefined }), setApplicationMenu: () => undefined },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
  app: {
    getPath: () => process.cwd(),
    getAppPath: () => process.cwd(),
    isReady: () => true,
    isPackaged: false,
    on: () => undefined,
    whenReady: () => Promise.resolve(),
    getAppMetrics: () => [],
  },
  ipcMain: { handle: () => undefined, on: () => undefined, removeHandler: () => undefined },
  session: { defaultSession: {}, fromPartition: () => ({}) },
  clipboard: { writeText: () => undefined, readText: () => "" },
  shell: { openExternal: async () => undefined, openPath: async () => "" },
  screen: {
    getPrimaryDisplay: () => ({
      workArea: { x: 0, y: 0, width: 1280, height: 800 },
      workAreaSize: { width: 1280, height: 800 },
    }),
    getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1280, height: 800 } }),
  },
}));

import { SparkBrowser } from "../src/main/browser.js";
import { MCP_HANDOFF_HINT } from "../src/main/mcp-server.js";
import { createToolHandlers } from "../src/main/tools/index.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

type RunInput = {
  signal?: AbortSignal;
  onRound?: (round: number) => void;
};

type Harness = SparkBrowser & {
  chatLog: Array<{ role: string; text: string }>;
  settings: { locale: string; execMode: "step" | "auto" };
  activeTabId: string;
  pushSidebarState: () => void;
  beginCloudTaskIfNeeded: () => Promise<undefined>;
  getUrl: () => string;
  getTitle: () => string;
  freeSoul: { run: (input: RunInput) => Promise<{ ok: boolean; text: string; interrupted?: boolean }> };
};

function harness(run: Harness["freeSoul"]["run"]): Harness {
  const browser = Object.create(SparkBrowser.prototype) as Harness;
  browser.chatLog = [];
  browser.settings = { locale: "zh-CN", execMode: "step" };
  browser.activeTabId = "t";
  browser.pushSidebarState = () => undefined;
  browser.beginCloudTaskIfNeeded = async () => undefined;
  browser.getUrl = () => "https://weibo.com";
  browser.getTitle = () => "微博";
  browser.freeSoul = { run };
  browser.configDir = () => {
    const dir = mkdtempSync(join(tmpdir(), "sparo-task-"));
    dirs.push(dir);
    return dir;
  };
  return browser;
}

describe("MCP 异步任务", () => {
  it("submit 立即返回，跑完后 get_task 为 done 且 lastAssistant 含最终回复", async () => {
    const browser = harness(async (input) => {
      input.onRound?.(3);
      return { ok: true, text: "最终汇报：微博已发出" };
    });
    const started = Date.now();
    const submitted = browser.submitTask("发一条微博");
    expect(Date.now() - started).toBeLessThan(100);
    expect(submitted.status).toBe("running");
    await vi.waitFor(() => expect(browser.getTask(submitted.taskId).status).toBe("done"));
    const got = browser.getTask(submitted.taskId);
    expect(got.lastAssistant).toContain("最终汇报：微博已发出");
    expect(got.rounds).toBe(3);
    expect(got.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it("执行中再提交被拒绝，原来的那条继续跑", async () => {
    let runs = 0;
    let markReady: () => void = () => undefined;
    let releaseFirst: (value: { ok: boolean; text: string }) => void = () => undefined;
    const ready = new Promise<void>((resolve) => {
      markReady = resolve;
    });
    const browser = harness((input) => {
      runs += 1;
      if (runs === 1) {
        markReady();
        return new Promise((resolve) => {
          releaseFirst = resolve;
          input.onRound?.(1);
        });
      }
      return Promise.resolve({ ok: true, text: "不该跑第二条" });
    });
    const first = browser.submitTask("第一条");
    expect(first.status).toBe("running");
    await ready;
    const second = browser.submitTask("第二条");
    expect(second.status).toBe("failed");
    expect(second.error).toBe("tab_busy");
    expect(second.message).toContain("还有任务在进行");
    expect(runs).toBe(1);
    expect(browser.getTask(second.taskId).status).toBe("unknown");
    releaseFirst({ ok: true, text: "第一条做完了" });
    await vi.waitFor(() => expect(browser.getTask(first.taskId).status).toBe("done"));
    expect(browser.getTask(first.taskId).lastAssistant).toContain("第一条做完了");
  });

  it("不存在的 taskId 返回 unknown", () => {
    const browser = harness(async () => ({ ok: true, text: "不会跑到" }));
    expect(browser.getTask("missing").status).toBe("unknown");
  });

  it("任务表只留最近 10 条", async () => {
    const pending: Array<(value: { ok: boolean; text: string }) => void> = [];
    const browser = harness(
      () =>
        new Promise((resolve) => {
          pending.push(resolve);
        }),
    );
    const ids: string[] = [];
    for (let i = 0; i <= 11; i += 1) {
      const submitted = browser.submitTask(`t${i}`);
      ids.push(submitted.taskId);
      expect(submitted.status).toBe("running");
      await vi.waitUntil(() => pending.length === i + 1);
      pending[i]!({ ok: true, text: "好" });
      await vi.waitFor(() => expect(browser.getTask(submitted.taskId).status).toBe("done"));
    }
    expect(browser.getTask(ids[0]!).status).toBe("unknown");
    expect(browser.getTask(ids[1]!).status).toBe("unknown");
    expect(browser.getTask(ids[2]!).status).toBe("done");
    expect(browser.getTask(ids[11]!).status).toBe("done");
  });

  it("sidebar_chat 仍等待侧栏回执", async () => {
    const browser = {
      sidebarChatTool: async (text: string) => {
        await new Promise((resolve) => setTimeout(resolve, 40));
        return { ok: true, message: `sync:${text}` };
      },
      submitTask: (text: string) => ({ taskId: "fast", status: "running" as const, text }),
      getTask: () => ({ status: "unknown" as const, rounds: 0, lastAssistant: "", elapsedMs: 0 }),
    };
    const tools = createToolHandlers(browser as unknown as SparkBrowser);
    const started = Date.now();
    const result = await tools.sidebar_chat("你好");
    expect(Date.now() - started).toBeGreaterThanOrEqual(30);
    expect(result.message).toBe("sync:你好");
    expect(tools.submit_task("发一条")).toEqual({ taskId: "fast", status: "running", text: "发一条" });
  });
});

describe("MCP 工具描述", () => {
  it("sidebar_chat、submit_task、navigate、click、fill 带上一次交办的句子", () => {
    const src = readFileSync(new URL("../src/main/mcp-server.ts", import.meta.url), "utf8");
    expect(MCP_HANDOFF_HINT).toContain("多步任务");
    expect(MCP_HANDOFF_HINT).toContain("不要用 navigate/click/fill 逐步遥控");
    for (const name of ["sidebar_chat", "submit_task", "navigate", "click", "fill"]) {
      const at = src.indexOf(`\n    "${name}",`);
      expect(at).toBeGreaterThan(0);
      expect(src.slice(at, at + 900)).toContain("MCP_HANDOFF_HINT");
    }
  });
});
