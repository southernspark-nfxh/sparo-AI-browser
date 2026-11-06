import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { vi } from "vitest";

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
import { TaskPool } from "../src/main/agent/task-pool.js";
import { agentInstructions, registerSparoPrompt, SPARO_AGENT_GUIDE } from "../src/main/agent/agent-guide.js";
import { saveShotBytes } from "../src/main/captures.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

type RunInput = {
  execMode?: string;
  signal?: AbortSignal;
  onRound?: (round: number) => void;
};

function harness(run: (input: RunInput) => Promise<{ ok: boolean; text: string; interrupted?: boolean; awaitingConfirm?: boolean }>) {
  const dir = mkdtempSync(join(tmpdir(), "sparo-agent-"));
  dirs.push(dir);
  const browser = Object.create(SparkBrowser.prototype) as SparkBrowser & {
    chatLog: Array<{ role: string; text: string }>;
    settings: { locale: string; execMode: "step" | "auto" };
    activeTabId: string;
    taskPool: TaskPool;
    pushSidebarState: () => void;
    beginCloudTaskIfNeeded: () => Promise<undefined>;
    getUrl: (tabId?: string) => string;
    getTitle: () => string;
    createAgentTab: () => string;
    listTabs: () => { tabs: Array<{ id: string }> };
    switchTab: (id: string) => void;
    configDir: () => string;
    freeSoul: { run: typeof run };
    abortAgentRuns: () => void;
  };
  browser.chatLog = [];
  browser.settings = { locale: "zh-CN", execMode: "step" };
  browser.activeTabId = "user-tab";
  browser.taskPool = new TaskPool();
  browser.pushSidebarState = () => undefined;
  browser.beginCloudTaskIfNeeded = async () => undefined;
  browser.getUrl = (tabId?: string) => (tabId && tabId !== "user-tab" ? "https://weibo.com/123" : "https://weibo.com");
  browser.getTitle = () => "微博";
  browser.listTabs = () => ({ tabs: [{ id: "user-tab" }] });
  browser.createAgentTab = () => "agent-tab";
  browser.switchTab = () => undefined;
  browser.configDir = () => dir;
  browser.freeSoul = { run };
  return { browser, dir };
}

describe("Agent 指南", () => {
  it("initialize 说明一屏内点明交任务、原语和确认门", () => {
    const text = agentInstructions("ab12cd");
    expect(text).toContain("clientId=ab12cd");
    expect(text).toContain("submit_task");
    expect(text).toContain("get_task");
    expect(text).toContain("navigate");
    expect(text).toContain("支付");
    expect(text).toContain("删除");
    expect(text).toContain("客服");
    expect(text).toContain("pool_full");
    expect(text.length).toBeLessThan(500);
    expect(text).not.toContain("3921");
    expect(text).not.toContain("价格");
  });

  it("sparo_agent_guide 用第二人称，不写端口和 Token", async () => {
    expect(SPARO_AGENT_GUIDE).toContain("你");
    expect(SPARO_AGENT_GUIDE).toContain("submit_task");
    expect(SPARO_AGENT_GUIDE).toContain("execMode");
    expect(SPARO_AGENT_GUIDE).toContain("auto");
    expect(SPARO_AGENT_GUIDE).toContain("running");
    expect(SPARO_AGENT_GUIDE).toContain("queued");
    expect(SPARO_AGENT_GUIDE).toContain("interrupted");
    expect(SPARO_AGENT_GUIDE).toContain("技能");
    expect(SPARO_AGENT_GUIDE).toContain("32");
    expect(SPARO_AGENT_GUIDE).toContain("100");
    expect(SPARO_AGENT_GUIDE).not.toContain("3921");
    expect(SPARO_AGENT_GUIDE).not.toContain("Bearer");
    expect(SPARO_AGENT_GUIDE).not.toContain("mcp-auth");
    expect(SPARO_AGENT_GUIDE).not.toContain("价格");
    expect(SPARO_AGENT_GUIDE).not.toContain("点数");
    expect(SPARO_AGENT_GUIDE).not.toContain("妙招");
    let name = "";
    let body = "";
    registerSparoPrompt({
      prompt: (promptName: string, _description: string, cb: () => Promise<{ messages: Array<{ content: { text: string } }> }>) => {
        name = promptName;
        return cb().then((result) => {
          body = result.messages[0].content.text;
        });
      },
    });
    await Promise.resolve();
    expect(name).toBe("sparo_agent_guide");
    expect(body).toBe(SPARO_AGENT_GUIDE);
  });
});

describe("submit_task 给 Agent", () => {
  it("缺省 execMode 是 auto，显式 step 才逐步确认", async () => {
    const seen: string[] = [];
    const { browser } = harness(async (input) => {
      seen.push(input.execMode || "");
      return { ok: true, text: "做完了" };
    });
    browser.submitTask("发一条微博");
    browser.submitTask("再发一条", { execMode: "step" });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(seen[0]).toBe("auto");
    expect(seen[1]).toBe("step");
  });

  it("done 带回 closeReason、最终页、素材和报告", async () => {
    const { browser, dir } = harness(async (input) => {
      input.onRound?.(2);
      writeFileSync(join(dir, "pixel.png"), "x");
      saveShotBytes({
        configDir: dir,
        label: "weibo",
        bytes: Buffer.from("x"),
        ext: "png",
        url: "https://weibo.com/123",
        title: "微博",
      });
      mkdirSync(join(dir, "reports"));
      writeFileSync(join(dir, "reports", "note.html"), "<p>报告</p>");
      return { ok: true, text: "微博已发出" };
    });
    const submitted = browser.submitTask("发一条带图微博", { clientId: "ab12cd" });
    expect(submitted.status).toBe("running");
    await new Promise((resolve) => setTimeout(resolve, 40));
    const got = browser.getTask(submitted.taskId);
    expect(got.status).toBe("done");
    expect(got.result?.closeReason).toBe("done");
    expect(got.result?.finalUrl).toBe("https://weibo.com/123");
    expect(got.result?.lastAssistant).toContain("微博已发出");
    expect(got.result?.captures.some((name) => name.includes("weibo"))).toBe(true);
    expect(got.result?.reportUrl).toContain("note.html");
    expect(browser.activeTabId).toBe("user-tab");
  });

  it("带 clientId 进后台池，满了排队，不挡无 clientId 的排队语义", async () => {
    let runs = 0;
    const { browser } = harness(() => {
      runs += 1;
      return new Promise(() => undefined);
    });
    const ids = ["a", "b", "c"].map((id) => browser.submitTask(`任务${id}`, { clientId: id }));
    expect(ids.map((item) => item.status)).toEqual(["running", "running", "running"]);
    const full = browser.submitTask("第四个", { clientId: "d" });
    expect(full.status).toBe("queued");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(runs).toBe(3);
    const local = browser.submitTask("本地脚本");
    expect(local.status).toBe("running");
    const queued = browser.submitTask("本地第二条");
    expect(queued.status).toBe("queued");
    expect(browser.getTask(ids[0].taskId).status).toBe("running");
  });

  it("确认门不代答，打断后是 interrupted", async () => {
    const { browser } = harness((input) => new Promise((resolve) => {
      const finish = () => resolve({
        ok: true,
        text: "（任务被用户打断，未完成的步骤不做宣称。已做的操作以工具记录为准。）",
        interrupted: true,
      });
      if (input.signal?.aborted) finish();
      else input.signal?.addEventListener("abort", finish, { once: true });
    }));
    const submitted = browser.submitTask("支付一笔", { clientId: "pay1" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    browser.abortAgentRuns();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const got = browser.getTask(submitted.taskId);
    expect(got.status).toBe("interrupted");
    expect(got.lastAssistant).toContain("未完成");
    expect(got.result).toBeUndefined();
  });
});
