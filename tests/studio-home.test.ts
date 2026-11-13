import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createEnv } from "../src/main/envs/store.js";
import { buildHomeView } from "../src/main/studio-data.js";
import { linkedAccountId } from "../strategies/skills/social-media-publish/scripts/metrics-db.mjs";
import { mount } from "../src/renderer/studio/pages/home.js";
import type { HomePageModel } from "../src/renderer/studio/pages/home.js";
import type { PageActions } from "../src/renderer/studio/types.js";

function matches(node, sel: string): boolean {
  if (!node) return false;
  if (sel.startsWith(".")) return String(node.className || "").split(/\s+/).includes(sel.slice(1));
  if (sel.startsWith("[")) {
    const body = sel.slice(1, -1);
    const eq = body.indexOf("=");
    if (eq < 0) return Object.prototype.hasOwnProperty.call(node.attributes || {}, body);
    const key = body.slice(0, eq);
    const expected = body.slice(eq + 1).trim().replace(/^['"]|['"]$/g, "");
    return node.attributes?.[key] === expected;
  }
  return String(node.tagName || "").toLowerCase() === sel.toLowerCase();
}

function queryAll(root, sel: string) {
  const found = [];
  const walk = (node) => {
    for (const child of node.children || []) {
      if (matches(child, sel)) found.push(child);
      walk(child);
    }
  };
  walk(root);
  return found;
}

function installDom() {
  function make(tag: string) {
    const listeners: Record<string, Array<(event: { type: string; target: ReturnType<typeof make> }) => void>> = {};
    let text = "";
    const el = {
      tagName: String(tag || "div").toUpperCase(),
      className: "",
      children: [] as Array<ReturnType<typeof make>>,
      parentElement: null as ReturnType<typeof make> | null,
      attributes: {} as Record<string, string>,
      hidden: false,
      disabled: false,
      value: "",
      title: "",
      type: "",
      listeners,
      append(...nodes: Array<ReturnType<typeof make>>) {
        for (const node of nodes) {
          node.parentElement = el;
          el.children.push(node);
        }
      },
      replaceChildren(...nodes: Array<ReturnType<typeof make>>) {
        for (const child of el.children) child.parentElement = null;
        el.children = [];
        text = "";
        if (nodes.length) el.append(...nodes);
      },
      addEventListener(type: string, fn: (event: { type: string; target: ReturnType<typeof make> }) => void) {
        (listeners[type] ||= []).push(fn);
      },
      removeEventListener(type: string, fn: (event: { type: string; target: ReturnType<typeof make> }) => void) {
        listeners[type] = (listeners[type] || []).filter((item) => item !== fn);
      },
      setAttribute(name: string, value: string) { el.attributes[name] = String(value); },
      getAttribute(name: string) { return Object.prototype.hasOwnProperty.call(el.attributes, name) ? el.attributes[name] : null; },
      removeAttribute(name: string) { delete el.attributes[name]; },
      querySelector(sel: string) { return queryAll(el, sel)[0] || null; },
      querySelectorAll(sel: string) { return queryAll(el, sel); },
      closest(sel: string) {
        let cur: ReturnType<typeof make> | null = el;
        while (cur) {
          if (matches(cur, sel)) return cur;
          cur = cur.parentElement;
        }
        return null;
      },
      click() {
        const event = { type: "click", target: el, preventDefault() {} };
        let cur: ReturnType<typeof make> | null = el;
        while (cur) {
          for (const fn of [...(cur.listeners.click || [])]) fn(event);
          cur = cur.parentElement;
        }
      },
    };
    Object.defineProperty(el, "textContent", {
      get() { return el.children.length ? el.children.map((child) => child.textContent).join("") : text; },
      set(value: string) { text = value == null ? "" : String(value); el.children = []; },
    });
    return el;
  }
  (globalThis as { document?: unknown }).document = {
    createElement: (tag: string) => make(tag),
    createElementNS: (_ns: string, tag: string) => make(tag),
  };
}

function actions() {
  const calls: string[] = [];
  const unsupported = async () => ({ ok: false as const, code: "unsupported", message: "尚未接入", envId: "env-b" });
  const page: PageActions = {
    navigate: (view, filter) => { calls.push("navigate:" + view + ":" + (filter || "")); },
    reload: async (id) => { calls.push("reload:" + id); },
    saveDraft: unsupported,
    precheck: unsupported,
    confirm: unsupported,
    pickImages: unsupported,
    checkAccounts: unsupported,
    openAccount: async (input) => { calls.push("login:" + input.envId + ":" + input.platform); return unsupported(); },
    refreshMetrics: unsupported,
    openTask: unsupported,
    verifyTask: unsupported,
    resumeTask: unsupported,
    fillReply: unsupported,
    onTasksChanged: () => () => { calls.push("off"); },
  };
  return { page, calls };
}

function homeModel(extra: Partial<HomePageModel> = {}): HomePageModel {
  const title = "标".repeat(50);
  return {
    envId: "env-b",
    capturedAt: "2026-11-13T10:30:00+08:00",
    attention: [
      { id: "login", title: "百家号登录失效", detail: "需要在这个环境里重新登录。不会改用别的环境。", state: "login_missing", platform: "baijiahao", action: "login" },
      { id: "fail", title: "头条号《标题 A》发布失败", detail: "发布失败，需要处理这一平台。", state: "error", platform: "toutiao", jobId: "job-1", action: "task" },
      { id: "verify", title: "搜狐号《标题 B》结果待核验", detail: "提交后的结果还不能确认。", state: "unknown", platform: "sohu", jobId: "job-2", action: "verify" },
    ],
    pendingCount: 2,
    failedCount: 1,
    reads: { value: 2622, text: "2,622", unit: "次", completeness: "full", source: "头条号、百家号", capturedAt: "2026-11-13T10:30:00+08:00" },
    revenue: { value: 369, text: "¥3.69", unit: "元", completeness: "full", source: "头条号", capturedAt: "2026-11-13T10:30:00+08:00" },
    recentTasks: [{ title, platform: "toutiao", stage: "已发布", updatedAt: "2026-11-13T10:28:00+08:00" }],
    recentComments: [{ platform: "baijiahao", author: "张三", summary: "这篇写得真好", createdAt: "2026-11-13T09:00:00+08:00" }],
    tasksKnown: true,
    commentsKnown: true,
    metricsKnown: true,
    ...extra,
  };
}

describe("工作台首页", () => {
  it("先放需要处理的事，摘要能进筛选，不编百分比", () => {
    installDom();
    const source = readFileSync(new URL("../src/renderer/studio/pages/home.ts", import.meta.url), "utf8");
    const css = readFileSync(new URL("../src/renderer/studio/pages/home.css", import.meta.url), "utf8");
    expect(source.includes("innerHTML")).toBe(false);
    expect(source.includes("JSON.stringify")).toBe(false);
    expect(source.includes("sparkStudio")).toBe(false);
    expect(css).toContain("overflow-wrap: anywhere");
    expect(css).toContain("tabular-nums");
    expect(css).toContain("min-width: 0");
    const harness = actions();
    const container = (globalThis as { document: { createElement: (tag: string) => HTMLElement } }).document.createElement("div");
    const handle = mount(container, homeModel(), harness.page);
    expect(container.textContent).toContain("需要处理");
    expect(container.textContent).toContain("百家号登录失效");
    expect(container.textContent).toContain("2,622");
    expect(container.textContent).toContain("相加，非去重");
    expect(container.textContent).toContain("¥3.69");
    expect(container.textContent).toContain("账面相加，非到账");
    expect(container.textContent).toContain("标".repeat(50));
    expect(container.textContent).toContain("张三");
    expect(container.querySelector(".clip")).not.toBeNull();
    expect(container.querySelector(".kpi")).not.toBeNull();
    container.querySelector("[data-card=\"pending\"]").click();
    container.querySelector("[data-card=\"failed\"]").click();
    container.querySelector("[data-card=\"reads\"]").click();
    container.querySelector("[data-action=\"login\"]").click();
    container.querySelector("[data-action=\"verify\"]").click();
    expect(harness.calls).toContain("navigate:tasks:pending");
    expect(harness.calls).toContain("navigate:tasks:failed");
    expect(harness.calls).toContain("navigate:metrics:reads");
    expect(harness.calls).toContain("login:env-b:baijiahao");
    expect(harness.calls).toContain("navigate:tasks:verify:job-2");
    const partialHost = (globalThis as { document: { createElement: (tag: string) => HTMLElement } }).document.createElement("div");
    mount(partialHost, homeModel({
      hideDelta: true,
      deltaText: "+99%",
      reads: { value: 10, text: "10", unit: "次", completeness: "partial", source: "头条号", capturedAt: "2026-11-13T10:30:00+08:00" },
    }), harness.page);
    expect(partialHost.querySelector("[data-card=\"reads\"]")?.textContent).not.toContain("%");
    expect(partialHost.querySelector("[data-card=\"reads\"]")?.textContent).not.toContain("较前一日");
    expect(partialHost.textContent).toContain("10");
    const emptyHost = (globalThis as { document: { createElement: (tag: string) => HTMLElement } }).document.createElement("div");
    mount(emptyHost, {
      status: "empty",
      reason: "还没有这个环境的快照，不会编造趋势和数字。",
    }, harness.page);
    expect(emptyHost.textContent).toContain("还没有这个环境的快照");
    expect(emptyHost.textContent).not.toContain("2,622");
    expect(emptyHost.querySelector("[data-card=\"reads\"]")?.textContent).toContain("—");
    expect(emptyHost.querySelector("[data-card=\"reads\"]")?.textContent).not.toContain("0");
    const big = homeModel({
      reads: { value: 123456789012, text: "123,456,789,012", unit: "次", completeness: "full", source: "头条号", capturedAt: "2026-11-13T10:30:00+08:00" },
    });
    const bigHost = (globalThis as { document: { createElement: (tag: string) => HTMLElement } }).document.createElement("div");
    mount(bigHost, big, harness.page);
    const number = bigHost.querySelector("[data-card=\"reads\"]").querySelector(".kpi");
    expect(number?.textContent).toBe("123,456,789,012");
    expect(String(number?.className)).toContain("kpi");
    const pending = container.querySelector("[data-card=\"pending\"]");
    handle.destroy();
    pending.click();
    expect(harness.calls.filter((item) => item === "navigate:tasks:pending").length).toBe(1);
  });

  it("首页服务只汇总当前环境的昨日阅读和本月收益", () => {
    const dir = mkdtempSync(join(tmpdir(), "studio-home-data-"));
    try {
      const configDir = join(dir, "config");
      const other = createEnv(configDir, { account: { type: "other", name: "一号" } });
      const current = createEnv(configDir, { account: { type: "other", name: "二号" } });
      const now = new Date(2026, 10, 13, 10, 30);
      const home = buildHomeView({
        envId: current.id,
        now,
        rows: [
          { platform: "toutiao", accountId: linkedAccountId(current.id, "tt"), date: "2026-11-12", reads: 20, revenue: 369, completeness: "full", capturedAt: "2026-11-13T10:30:00+08:00" },
          { platform: "toutiao", accountId: linkedAccountId(current.id, "tt"), date: "2026-10-31", reads: 4242, revenue: 4242, completeness: "full" },
          { platform: "baijiahao", accountId: linkedAccountId(other.id, "bj"), date: "2026-11-12", reads: 9999, revenue: 9999, completeness: "full" },
          { platform: "sohu", accountId: "", date: "2026-11-12", reads: 5000, completeness: "full", articleId: "UNLINKED_TITLE" },
        ],
        tasks: [
          { title: "标题 A", platform: "toutiao", stage: "发布失败", updatedAt: "2026-11-13T10:00:00+08:00", jobId: "job-1" },
          { title: "标题 B", platform: "sohu", stage: "结果待核验", updatedAt: "2026-11-13T09:00:00+08:00", jobId: "job-2" },
          { title: "标题 C", platform: "dayu", stage: "已发布", updatedAt: "2026-11-13T08:00:00+08:00", jobId: "job-3" },
          { title: "标题 D", platform: "baijiahao", stage: "排队中", updatedAt: "2026-11-13T07:00:00+08:00", jobId: "job-4" },
        ],
        comments: [{ platform: "baijiahao", author: "张三", summary: "这篇写得真好", createdAt: "2026-11-13T09:00:00+08:00" }],
        accounts: [{ platform: "baijiahao", state: "login_missing" }],
      });
      expect(home.envId).toBe(current.id);
      expect(home.envId).not.toBe(other.id);
      expect(home.reads?.value).toBe(20);
      expect(home.revenue?.value).toBe(369);
      expect(home.failedCount).toBe(1);
      expect(home.pendingCount).toBe(1);
      expect(home.attention.map((item) => item.action)).toEqual(["login", "task", "verify"]);
      expect(home.recentTasks).toHaveLength(4);
      expect(JSON.stringify(home)).not.toContain("UNLINKED_TITLE");
      expect(JSON.stringify(home)).not.toContain("9999");
      expect(JSON.stringify(home)).not.toContain("4242");
      const partial = buildHomeView({
        envId: current.id,
        now,
        rows: [
          { platform: "toutiao", accountId: linkedAccountId(current.id, "tt"), date: "2026-11-12", reads: 10, completeness: "full" },
          { platform: "baijiahao", accountId: linkedAccountId(current.id, "bj"), date: "2026-11-12", reads: 3, completeness: "partial" },
        ],
      });
      expect(partial.hideDelta).toBe(true);
      expect(partial.deltaText).toBe("");
      expect(partial.reads?.completeness).toBe("partial");
      expect(partial.reads?.value).toBe(13);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
