import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
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
import { TaskPool } from "../src/main/agent/task-pool.js";
import { bindClientTab, registerClientName, resetMcpSessions, seatForClient } from "../src/main/agent/mcp-sessions.js";

afterEach(() => resetMcpSessions());

function loadFn(name: string) {
  const html = readFileSync(join(process.cwd(), "src/renderer/shell.html"), "utf8");
  const start = html.indexOf(`function ${name}`);
  if (start < 0) throw new Error(`missing ${name}`);
  let depth = 0;
  for (let i = html.indexOf("{", start); i < html.length; i += 1) {
    if (html[i] === "{") depth += 1;
    else if (html[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        const src = html.slice(start, i + 1);
        return new Function(`${src}; return ${name};`)() as (...args: unknown[]) => unknown;
      }
    }
  }
  throw new Error(`unclosed ${name}`);
}

describe("T66 工位横幅", () => {
  it("五种状态的文案都带工位号和名字，勿扰只在办公时出现", () => {
    const agentBannerText = loadFn("agentBannerText") as (tab: Record<string, unknown>) => string;
    const showsQuiet = loadFn("agentBannerShowsQuiet") as (tab: Record<string, unknown>) => boolean;
    const base = { agentName: "视觉验收员", agentSeat: 2 };
    expect(agentBannerText({ ...base, agentState: "running", agentRound: 4 })).toBe(
      "2号工位正在办公 · 视觉验收员 · 第 4 轮 · 正在读页",
    );
    expect(agentBannerText({ ...base, agentState: "running", agentRound: 4, lastLine: "正在填表" })).toBe(
      "2号工位正在办公 · 视觉验收员 · 第 4 轮 · 正在填表",
    );
    expect(agentBannerText({ ...base, agentState: "waiting_human", lastLine: "要不要发出去" })).toBe(
      "2号工位等你拍板 · 视觉验收员 · 要不要发出去",
    );
    expect(agentBannerText({ ...base, agentState: "queued" })).toBe("2号工位排队候场 · 视觉验收员");
    expect(agentBannerText({ ...base, agentState: "done" })).toBe(
      "2号工位已下班 · 视觉验收员 · 页面已休眠",
    );
    expect(agentBannerText({ ...base, agentState: "idle" })).toBe("2号工位 · 视觉验收员");
    expect(showsQuiet({ agentState: "running" })).toBe(true);
    expect(showsQuiet({ agentState: "waiting_human" })).toBe(false);
    expect(showsQuiet({ agentState: "queued" })).toBe(false);
    expect(showsQuiet({ agentState: "done" })).toBe(false);
    expect(showsQuiet({ agentState: "idle" })).toBe(false);

    const html = readFileSync(join(process.cwd(), "src/renderer/shell.html"), "utf8");
    expect(html).toContain('class="agent-quiet" hidden>勿扰</span>');
    expect(html).toContain("font-size: 11px");
    expect(html).toContain("color-mix(in srgb, var(--agent-color) 15%, transparent)");
    expect(html).toContain('fill="var(--agent-color)"');
    expect(html).toContain('class="agent-bot"');
    expect(html).toContain("tab-agent-dot");
    expect(html).not.toContain('class="agent-dot"');
    const roster = html.slice(html.indexOf("function renderAgentRoster"), html.indexOf("function renderTaskStrip"));
    expect(roster).toContain("agentBotMarkup()");
    expect(roster.indexOf("使用中 ")).toBeLessThan(roster.indexOf("agentBotMarkup()"));
  });

  it("agent 标签带工位号，用户标签没有", () => {
    const browser = Object.create(SparkBrowser.prototype) as SparkBrowser & {
      tabs: Map<string, { id: string; title: string; url: string; view: null; lastActiveAt: number }>;
      activeTabId: string;
      taskPool: TaskPool;
      sessionViews: () => Array<{ key: string; seat?: number }>;
    };
    browser.tabs = new Map([
      ["user", { id: "user", title: "用户", url: "https://user.example", view: null, lastActiveAt: 1 }],
      ["agent-1", { id: "agent-1", title: "代理页", url: "https://agent.example", view: null, lastActiveAt: 1 }],
    ]);
    browser.activeTabId = "user";
    browser.taskPool = new TaskPool();
    registerClientName("jia", "视觉验收员");
    bindClientTab({
      clientId: "jia",
      tabId: "agent-1",
      knownTabIds: ["user", "agent-1"],
      createAgentTab: () => "unused",
    });
    const tabs = browser.listTabs().tabs;
    const user = tabs.find((tab) => tab.id === "user");
    const agent = tabs.find((tab) => tab.id === "agent-1");
    expect(user?.agentSeat).toBeUndefined();
    expect(agent?.agentSeat).toBe(1);
    expect(agent?.agentName).toBe("视觉验收员");
    const views = browser.sessionViews();
    expect(views.find((item) => item.key === "user")?.seat).toBeUndefined();
    expect(views.find((item) => item.key === "agent:jia")?.seat).toBe(1);
  });

  it("同一 client 的工位号不变，后接入的递增", () => {
    expect(seatForClient("jia")).toBeUndefined();
    registerClientName("jia", "甲");
    expect(seatForClient("jia")).toBe(1);
    registerClientName("jia", "甲改名");
    expect(seatForClient("jia")).toBe(1);
    registerClientName("yi", "乙");
    expect(seatForClient("yi")).toBe(2);
    expect(seatForClient("jia")).toBe(1);
  });
});
