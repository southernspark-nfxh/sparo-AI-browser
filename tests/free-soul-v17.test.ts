import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

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
  nativeImage: { createFromPath: () => ({}) },
}));

import { SparkBrowser } from "../src/main/browser.js";
import { FreeSoul } from "../src/main/agent/free-soul.js";
import { asRoute, cleanArgs, saveTaughtFromTrace, type SoulRunTrace } from "../src/main/agent/distill.js";
import { listSkills } from "../src/main/skills/store.js";
import { matchSkills, runSkill } from "../src/main/skills/runner.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "sparo-v17-"));
  dirs.push(dir);
  return dir;
}

type SentBody = {
  messages?: Array<{ role?: string; content?: string | null; tool_calls?: unknown[] }>;
  tools?: Array<{ function?: { name?: string } }>;
};

function config(fetchImpl: typeof fetch) {
  return { apiKey: "test", baseUrl: "https://example.test/v1", model: "test-model", fetchImpl };
}

function toolCall(id: string, name: string, args: Record<string, unknown> = {}) {
  return {
    content: null,
    tool_calls: [{ id, type: "function" as const, function: { name, arguments: JSON.stringify(args) } }],
  };
}

function scripted(
  replies: Array<{ content?: string | null; tool_calls?: unknown[] }>,
  sent: SentBody[],
): typeof fetch {
  let index = 0;
  return async (_url, init) => {
    sent.push(JSON.parse(String(init?.body || "{}")) as SentBody);
    const reply = replies[index++];
    if (!reply) throw new Error(`unexpected completion ${index}`);
    return new Response(JSON.stringify({ choices: [{ message: reply }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
}

const KEEP_LINE = "只有用户明确说「沉淀成技能 / 记成技能 / 生成技能」时才调 save_skill；任务成功后不要主动建议沉淀。";

describe("Free Soul 轨迹只在成功关单后留下", () => {
  it("成功关单留下脱敏轨迹，确认、失败和打断都不覆盖", async () => {
    let saved: SoulRunTrace | null = null;
    const keep = (trace: SoulRunTrace) => {
      saved = trace;
    };
    const done = await new FreeSoul(
      config(scripted([
        toolCall("n", "navigate", {
          url: "https://s.weibo.com/weibo?q=hot&token=secret",
          selector: "#go",
          x: 3,
          y: 4,
          ref: "e12",
          password: "hunter2",
          text: "热搜",
        }),
        toolCall("c", "click", { selector: "#go", ref: "e12" }),
        { content: "前 10 条如下。" },
      ], [])),
      async (name) => {
        if (name === "navigate") {
          return { ok: true, message: "opened", data: { url: "https://s.weibo.com/weibo?q=hot", title: "热搜" } };
        }
        return { ok: true, message: "clicked" };
      },
    ).run({
      input: "打开微博热搜页，把前 10 条整理成清单",
      url: "about:blank",
      title: "",
      locale: "zh",
      onTrace: keep,
    });

    expect(done).toEqual({ ok: true, text: "前 10 条如下。" });
    expect(saved?.input).toContain("热搜页");
    expect(saved?.trace.map((step) => step.tool)).toEqual(["navigate", "click"]);
    expect(saved?.trace[0]?.round).toBe(1);
    expect(String(saved?.trace[0]?.args.url)).toContain("s.weibo.com");
    expect(saved?.trace[0]?.args.text).toBe("热搜");
    const dumped = JSON.stringify(saved?.trace);
    expect(dumped).not.toContain("token");
    expect(dumped).not.toContain("secret");
    expect(dumped).not.toContain("hunter2");
    expect(dumped).not.toContain("selector");
    expect(dumped).not.toContain("e12");
    expect(saved?.trace[0]?.args).not.toHaveProperty("x");
    expect(saved?.trace[0]?.args).not.toHaveProperty("ref");

    const confirmed = await new FreeSoul(
      config(scripted([
        toolCall("ask", "request_confirm", { action: "发送", detail: "一条微博" }),
      ], [])),
      async () => ({ ok: true, message: "不该执行" }),
    ).run({
      input: "发一条微博",
      url: "https://weibo.com",
      title: "微博",
      locale: "zh",
      onTrace: keep,
    });
    expect(confirmed.awaitingConfirm).toBe(true);
    expect(saved?.input).toContain("热搜页");

    const failed = await new FreeSoul(
      config(scripted([{ content: "" }], [])),
      async () => ({ ok: true, message: "不会执行" }),
    ).run({ input: "空回复", url: "", title: "", locale: "zh", onTrace: keep });
    expect(failed.ok).toBe(false);
    expect(saved?.input).toContain("热搜页");

    const controller = new AbortController();
    const stopped = await new FreeSoul(
      config(scripted([toolCall("n2", "navigate", { url: "https://example.com" })], [])),
      async () => {
        controller.abort();
        return { ok: true, message: "opened", data: { url: "https://example.com", title: "例" } };
      },
    ).run({
      input: "中途打断",
      url: "",
      title: "",
      locale: "zh",
      signal: controller.signal,
      onTrace: keep,
    });
    expect(stopped.interrupted).toBe(true);
    expect(saved?.input).toContain("热搜页");
    expect(saved?.trace).toHaveLength(2);
  });

  it("超过 60 条时丢掉中段，开头的打开页和结尾还在", async () => {
    const steps = [
      toolCall("n0", "navigate", { url: "https://s.weibo.com/top/summary" }),
      toolCall("n1", "search_site", { site: "train", from: "临汾", to: "北京" }),
      toolCall("n2", "navigate", { url: "https://weibo.com/u/1" }),
      ...Array.from({ length: 62 }, (_, index) => toolCall(`s${index}`, "scroll", { direction: "down" })),
      { content: "整理完了。" },
    ];
    let saved: SoulRunTrace | null = null;
    const result = await new FreeSoul(
      config(scripted(steps, [])),
      async (name) => {
        if (name === "navigate" || name === "search_site") {
          return { ok: true, message: "opened", data: { url: "https://s.weibo.com/top/summary", title: "热搜" } };
        }
        return { ok: true, message: "已滚动" };
      },
    ).run({
      input: "把热搜整理成清单",
      url: "about:blank",
      title: "",
      locale: "zh",
      onTrace: (trace) => {
        saved = trace;
      },
    });
    expect(result.ok).toBe(true);
    expect(saved?.trace).toHaveLength(60);
    expect(saved?.trace.slice(0, 3).map((step) => step.tool)).toEqual(["navigate", "search_site", "navigate"]);
    expect(saved?.trace[0]?.args.url).toContain("s.weibo.com/top/summary");
    expect(saved?.trace[3]?.round).toBe(9);
    expect(saved?.trace.at(-1)?.round).toBe(65);
    expect(saved?.trace.some((step) => step.round === 4 || step.round === 8)).toBe(false);
  });

  it("系统提示只在用户点名时沉淀，自动模式也一样", async () => {
    const sent: SentBody[] = [];
    await new FreeSoul(
      config(scripted([{ content: "好。" }], sent)),
      async () => ({ ok: true, message: "不会执行" }),
    ).run({ input: "看一下", url: "https://example.com", title: "例", locale: "zh" });
    const stepPrompt = String(sent[0]?.messages?.[0]?.content || "");
    expect(stepPrompt).toContain(KEEP_LINE);
    expect(stepPrompt).not.toContain("可以主动建议沉淀");
    expect(stepPrompt).not.toContain("成功后建议用户沉淀");
    const names = (sent[0]?.tools || []).map((item) => item.function?.name);
    expect(names).toContain("save_skill");

    const autoSent: SentBody[] = [];
    await new FreeSoul(
      config(scripted([{ content: "好。" }], autoSent)),
      async () => ({ ok: true, message: "不会执行" }),
    ).run({ input: "看一下", url: "https://example.com", title: "例", locale: "zh", execMode: "auto" });
    expect(String(autoSent[0]?.messages?.[0]?.content || "")).toContain(KEEP_LINE);
  });

  it("save_skill 把结果交回模型，不中断本轮", async () => {
    const seen: string[] = [];
    const result = await new FreeSoul(
      config(scripted([
        toolCall("s", "save_skill", {}),
        { content: "已记成 微博热搜清单" },
      ], [])),
      async (name) => {
        seen.push(name);
        return { ok: true, message: "原话：热搜\n基于此轨迹输出 route JSON 后带参数再调 save_skill。" };
      },
    ).run({ input: "把刚才这趟沉淀成技能", url: "https://weibo.com", title: "微博", locale: "zh" });
    expect(seen).toEqual(["save_skill"]);
    expect(result).toEqual({ ok: true, text: "已记成 微博热搜清单" });
    expect(result.awaitingConfirm).toBeUndefined();
  });
});

describe("save_skill 两段式落盘", () => {
  const hot: SoulRunTrace = {
    input: "打开微博热搜页，把前 10 条整理成清单",
    trace: [
      { tool: "navigate", args: { url: "https://s.weibo.com/top/summary" }, ok: true, round: 1 },
      { tool: "page_text", args: { text: "热搜" }, ok: true, round: 2 },
    ],
  };

  it("没轨迹、走了既有技能、路线不合法、重名，都把原因交回去", () => {
    const dir = tempDir();
    expect(saveTaughtFromTrace(dir, null, {}).message).toContain("无可沉淀");
    expect(cleanArgs({ selector: "#a", url: "https://a.com/?token=z", x: 1 }).url).not.toContain("token");
    expect(cleanArgs({ selector: "#a", x: 1 })).not.toHaveProperty("selector");
    expect(asRoute([{ kind: "fixed", tool: "click", args: { selector: "#a" } }])).toEqual([]);

    const stage = saveTaughtFromTrace(dir, hot, {});
    expect(stage.ok).toBe(true);
    expect(stage.message).toContain("原话：打开微博热搜页");
    expect(stage.message).toContain("s.weibo.com/top/summary");
    expect(stage.message).toContain("再调 save_skill");

    const taught = saveTaughtFromTrace(dir, hot, {
      title: "微博热搜清单",
      intent: "要微博热搜前十时",
      route: [{ kind: "fixed", tool: "navigate", args: { url: "https://s.weibo.com/top/summary" } }],
    });
    expect(taught.id).toBeTruthy();

    const again = saveTaughtFromTrace(dir, hot, {
      title: "另一个名字",
      intent: "要微博热搜前十时",
      route: [{ kind: "fixed", tool: "navigate", args: { url: "https://s.weibo.com/top/summary" } }],
    });
    expect(again.ok).toBe(false);
    expect(again.message).toContain(taught.id);

    const reused = saveTaughtFromTrace(dir, {
      input: "再跑一遍热搜",
      trace: [{ tool: "run_skill", args: { id: taught.id || "" }, ok: true, round: 1 }],
    }, {});
    expect(reused.message).toContain("这趟走的是既有技能");
    expect(reused.message).toContain("微博热搜清单");

    const failedSkill = saveTaughtFromTrace(dir, {
      input: "技能没跑通",
      trace: [
        { tool: "run_skill", args: { id: taught.id || "" }, ok: false, round: 1 },
        { tool: "navigate", args: { url: "https://s.weibo.com/top/summary" }, ok: true, round: 2 },
      ],
    }, {});
    expect(failedSkill.ok).toBe(true);
    expect(failedSkill.message).toContain("原话：技能没跑通");

    const bad = saveTaughtFromTrace(dir, hot, {
      title: "坏路线",
      intent: "不该记下",
      route: [{ kind: "fixed", tool: "click", args: { selector: "#go" } }],
    });
    expect(bad.ok).toBe(false);
    expect(bad.message).toContain("重试一次");
    expect(listSkills(dir).some((skill) => skill.title === "坏路线")).toBe(false);
  });

  it("带 route 落成 taught 技能，文件里没有选择器和 token", async () => {
    const dir = tempDir();
    const saved = saveTaughtFromTrace(dir, hot, {
      title: "微博热搜清单",
      intent: "要微博热搜前十时",
      aliases: ["热搜前十"],
      route: [
        {
          kind: "fixed",
          tool: "navigate",
          args: { url: "https://s.weibo.com/top/summary?token=secret", selector: "#hot", x: 9 },
        },
        { kind: "fixed", tool: "click", args: { selector: "#go" } },
        { kind: "open", goal: "读前 10 条热搜", tools: ["page_text"] },
      ],
      contract: { deliverable: "report" },
    });
    expect(saved.ok).toBe(true);
    expect(saved.message).toContain("已记成");
    expect(saved.message).toContain("微博热搜清单");
    const skills = listSkills(dir);
    expect(skills).toHaveLength(1);
    expect(skills[0]?.source).toBe("taught");
    expect(skills[0]?.distilled).toBe(true);
    const raw = readFileSync(join(dir, "skills", `${skills[0]?.id}.json`), "utf8");
    expect(raw).not.toContain("selector");
    expect(raw).not.toContain("token");
    expect(raw).not.toContain("#hot");
    expect(raw).toContain("s.weibo.com/top/summary");
    expect(matchSkills(dir, "热搜前十").some((item) => item.id === skills[0]?.id)).toBe(true);
    const ran = await runSkill({} as never, dir, { id: skills[0]?.id });
    expect(ran.ok).toBe(true);
    expect(ran.message).toContain("脚手架");
    expect(ran.message).toContain("s.weibo.com");
    expect(ran.message).not.toContain("token");
  });
});

type Exposed = SparkBrowser & {
  lastRunTrace: SoulRunTrace | null;
  chatLog: Array<{ role: string; text: string }>;
  freeSoul: FreeSoul | null;
  settings: { locale: string };
  tabs: Map<string, unknown>;
  activeTabId: string;
  pushSidebarState: () => void;
  configDir: () => string;
  skillsCache: Array<{ id: string; title: string }>;
};

function harness(dir: string): Exposed {
  const browser = Object.create(SparkBrowser.prototype) as Exposed;
  const page = {
    isDestroyed: () => false,
    getURL: () => "https://weibo.com",
    getTitle: () => "微博",
  };
  browser.tabs = new Map([
    ["t", { id: "t", url: page.getURL(), title: page.getTitle(), view: { webContents: page } }],
  ]);
  browser.activeTabId = "t";
  browser.settings = { locale: "zh-CN" };
  browser.pushSidebarState = () => undefined;
  browser.configDir = () => dir;
  browser.chatLog = [];
  browser.lastRunTrace = null;
  browser.skillsCache = [];
  return browser;
}

describe("侧栏只在用户点名时沉淀", () => {
  it("任务成功后不落盘、不提沉淀；下一句才记成技能，失败不覆盖轨迹", async () => {
    const dir = tempDir();
    const browser = harness(dir);
    const calls: string[] = [];
    browser.freeSoul = new FreeSoul(
      config(scripted([
        toolCall("n", "navigate", { url: "https://s.weibo.com/top/summary", selector: "#x" }),
        { content: "前 10 条热搜如下：一、二、三。" },
      ], [])),
      async (name) => {
        calls.push(name);
        return { ok: true, message: "opened", data: { url: "https://s.weibo.com/top/summary", title: "热搜" } };
      },
    );
    const first = await browser.handleChat("打开微博热搜页，把前 10 条整理成清单");
    expect(first.ok).toBe(true);
    expect(calls).toEqual(["navigate"]);
    expect(listSkills(dir)).toEqual([]);
    expect(browser.chatLog.map((turn) => turn.text).join("\n")).not.toContain("沉淀");
    expect(browser.lastRunTrace?.trace[0]?.tool).toBe("navigate");
    expect(JSON.stringify(browser.lastRunTrace)).not.toContain("selector");
    const kept = browser.lastRunTrace;

    browser.freeSoul = new FreeSoul(
      config(async () => {
        throw new Error("down");
      }),
      async () => ({ ok: true, message: "不会执行" }),
    );
    const failed = await browser.handleChat("再试一次");
    expect(failed.ok).toBe(false);
    expect(browser.lastRunTrace).toEqual(kept);

    browser.freeSoul = new FreeSoul(
      config(scripted([
        toolCall("s1", "save_skill", {}),
        toolCall("s2", "save_skill", {
          title: "微博热搜清单",
          intent: "要微博热搜前十时",
          aliases: ["热搜前十"],
          route: [
            { kind: "fixed", tool: "navigate", args: { url: "https://s.weibo.com/top/summary" } },
            { kind: "open", goal: "读前 10 条热搜", tools: ["page_text"] },
          ],
        }),
        { content: "已记成 微博热搜清单" },
      ], [])),
      (name, args) => browser.runCoreTool(name, args),
    );
    const saved = await browser.handleChat("把刚才这趟沉淀成技能");
    expect(saved.ok).toBe(true);
    expect(saved.message).toContain("已记成");
    const skills = listSkills(dir);
    expect(skills).toHaveLength(1);
    expect(skills[0]?.source).toBe("taught");
    expect(skills[0]?.distilled).toBe(true);
    expect(browser.skillsCache.some((skill) => skill.id === skills[0]?.id)).toBe(true);
    const raw = readFileSync(join(dir, "skills", `${skills[0]?.id}.json`), "utf8");
    expect(raw).not.toContain("selector");
    expect(raw).not.toContain("token");
  });
});
