import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createEnv } from "../src/main/envs/store.js";
import { loadStudioData, refreshStudioData, buildMetricsView, accountLinkOf } from "../src/main/studio-data.js";
import { collectAll, metricGetScript } from "../strategies/skills/social-media-publish/scripts/collector.mjs";
import { accountLink, buildViews, classifyLegacyMetrics, completenessText, linkedAccountId, listMetrics, upsertMetric, yuan } from "../strategies/skills/social-media-publish/scripts/metrics-db.mjs";
import { loadProfile } from "../strategies/skills/social-media-publish/scripts/profile.mjs";
import { mapSnapshot } from "../strategies/skills/social-media-publish/scripts/collector.mjs";
import {
  completenessLabel,
  displayCents,
  displayCount,
  displayFollows,
  exceptionCopy,
  mount,
  summarizeWindow,
  trendSegments,
} from "../src/renderer/studio/pages/metrics.js";
import type { MetricsPageModel } from "../src/renderer/studio/pages/metrics.js";
import type { PageActions as Actions } from "../src/renderer/studio/types.js";

describe("指标快照", () => {
  it("缺失不写成 0，unsupported 和 missing 文案不同", async () => {
    const dir = mkdtempSync(join(tmpdir(), "studio-metrics-"));
    const file = join(dir, "metrics.sqlite");
    try {
      await upsertMetric({
        platform: "sohu",
        accountId: linkedAccountId("env-metrics", "sohu-1"),
        date: "2026-11-11",
        articleId: "",
        completeness: "missing",
        reason: "数据接口未实测",
      }, file);
      await upsertMetric({
        platform: "dayu",
        accountId: linkedAccountId("env-metrics", "dayu-1"),
        date: "2026-11-11",
        articleId: "",
        completeness: "unsupported",
        revenue: null,
        reason: "平台没有收益字段",
      }, file);
      const rows = await listMetrics(file);
      const sohu = rows.find((row) => row.platform === "sohu");
      expect(sohu.reads).toBe(null);
      expect(sohu.revenue).toBe(null);
      const view = buildViews(rows);
      expect(completenessText("missing")).toBe("数据缺失");
      expect(completenessText("unsupported")).toBe("平台未提供");
      expect(view.revenueSplit.find((row) => row.platform === "sohu").text).toBe("数据缺失");
      expect(view.revenueSplit.find((row) => row.platform === "dayu").text).toBe("平台未提供");
      expect(view.overview.revenue).not.toContain("0.00");
      expect(view.hideDelta).toBe(true);
      expect(yuan(28640)).toBe("286.40");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("有符号净增，部分数据不给涨跌", () => {
    const view = buildViews([
      { platform: "toutiao", articleId: "", date: "2026-11-11", completeness: "full", reads: 10, follows: -5, revenue: 100 },
      { platform: "baijiahao", articleId: "", date: "2026-11-11", completeness: "partial", reads: 3, follows: 2, revenue: null },
    ]);
    expect(view.overview.follows).toBe("-5");
    expect(view.hideDelta).toBe(true);
    expect(view.overview.delta).toBe("");
  });

  it("按实测字段落数，元换成分，没有的指标保持空", () => {
    const clock = new Date("2026-11-12T08:00:00+08:00");
    const toutiao = mapSnapshot(loadProfile("toutiao"), {
      ready: { impression_latest_ready_date: "2026-11-11" },
      sources: [
        { status: 200, json: { author_stat: { consume_data: { impression_count: 5210, go_detail_count: 338 }, interaction_data: { digg_count: 6, comment_count: 2 } } } },
        { status: 200, json: { date: "2026-11-11", fans_stat: { change_count: 0 } } },
        { status: 200, json: { data: { detail: [{ day: "2026-11-11", total: "0.29" }] } } },
      ],
    }, clock);
    expect(toutiao.date).toBe("2026-11-11");
    expect(toutiao.impressions).toBe(5210);
    expect(toutiao.reads).toBe(338);
    expect(toutiao.follows).toBe(0);
    expect(toutiao.revenue).toBe(29);
    expect(toutiao.shares).toBe(null);
    expect(toutiao.completeness).toBe("partial");

    const baijia = mapSnapshot(loadProfile("baijiahao"), {
      ready: null,
      sources: [
        { status: 200, json: { data: { latest_event_day: 20261111, total_info: { view_count: "2284", likes_count: "19", comment_count: "9", share_count: "2", collect_count: "4", fans_increase: "0" } } } },
        { status: 200, json: { data: { yesterday_income: 3.4 } } },
      ],
    }, clock);
    expect(baijia.reads).toBe(2284);
    expect(baijia.revenue).toBe(340);
    expect(baijia.impressions).toBe(null);
    expect(baijia.completeness).toBe("partial");
  });
});

describe("指标环境", () => {
  it("无法关联 accountId 时不写入，旧数据只标记未关联", async () => {
    const dir = mkdtempSync(join(tmpdir(), "studio-link-"));
    const file = join(dir, "metrics.sqlite");
    try {
      const refused = await upsertMetric({
        platform: "toutiao",
        accountId: "",
        envId: "env-b",
        date: "2026-11-12",
        reads: 9,
        completeness: "full",
      }, file);
      expect(refused.ok).toBe(false);
      expect(refused.code).toBe("unlinked");
      expect(existsSync(file)).toBe(false);
      const mismatch = await upsertMetric({
        platform: "toutiao",
        accountId: linkedAccountId("env-a", "user-a"),
        envId: "env-b",
        date: "2026-11-12",
        reads: 9,
        completeness: "full",
      }, file);
      expect(mismatch.code).toBe("env_mismatch");
      expect(existsSync(file)).toBe(false);
      await upsertMetric({
        platform: "sohu",
        accountId: "",
        classify: "未关联",
        date: "2026-11-12",
        articleId: "UNLINKED_TITLE",
        reads: 5000,
        completeness: "full",
      }, file);
      const plan = await classifyLegacyMetrics(file);
      expect(plan[0]).toMatchObject({ action: "unlinked", label: "未关联", envId: "" });
      const stored = await listMetrics(file);
      expect(stored[0].accountId).toBe("");
      expect(stored[0].reason).toContain("未关联");
      expect(stored[0].reads).toBe(5000);
      expect(accountLinkOf(linkedAccountId("env-b", "user-b"))).toEqual(accountLink(linkedAccountId("env-b", "user-b")));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("非默认环境只看自己的快照，缺 envId 或环境不存在就停止", async () => {
    const dir = mkdtempSync(join(tmpdir(), "studio-env-data-"));
    const file = join(dir, "metrics.sqlite");
    const configDir = join(dir, "config");
    try {
      const first = createEnv(configDir, { account: { type: "other", name: "一号" } });
      const second = createEnv(configDir, { account: { type: "other", name: "二号" } });
      const now = new Date(2026, 10, 13, 10, 30);
      await upsertMetric({
        platform: "toutiao",
        accountId: linkedAccountId(second.id, "tt-2"),
        envId: second.id,
        date: "2026-11-12",
        reads: 32,
        follows: -5,
        revenue: 369,
        completeness: "full",
        capturedAt: "2026-11-13T10:30:00+08:00",
      }, file);
      await upsertMetric({
        platform: "baijiahao",
        accountId: linkedAccountId(first.id, "bj-1"),
        envId: first.id,
        date: "2026-11-12",
        reads: 9999,
        completeness: "full",
        capturedAt: "2026-11-13T10:30:00+08:00",
      }, file);
      await upsertMetric({
        platform: "sohu",
        accountId: "",
        classify: "未关联",
        date: "2026-11-12",
        articleId: "UNLINKED_TITLE",
        reads: 5000,
        completeness: "full",
      }, file);
      const loaded = await loadStudioData({ envId: second.id, configDir, file, now, tasks: [], comments: [] });
      expect(loaded.ok).toBe(true);
      if (!loaded.ok) return;
      expect(loaded.envId).toBe(second.id);
      expect(loaded.envId).not.toBe(first.id);
      expect(loaded.metrics.overview.reads?.value).toBe(32);
      expect(loaded.metrics.overview.follows?.text).toBe("-5");
      expect(loaded.home.envId).toBe(second.id);
      expect(loaded.home.reads?.value).toBe(32);
      expect(JSON.stringify(loaded.metrics)).not.toContain("UNLINKED_TITLE");
      expect(JSON.stringify(loaded.metrics)).not.toContain("9999");
      expect(loaded.unlinked).toBe(1);
      let collectCalls = 0;
      const missing = await refreshStudioData({
        envId: "",
        configDir,
        file,
        collect: async () => {
          collectCalls += 1;
          return { ok: true, code: "ok", message: "", envId: first.id };
        },
      });
      const unknown = await refreshStudioData({
        envId: "default",
        configDir,
        file,
        collect: async () => {
          collectCalls += 1;
          return { ok: true, code: "ok", message: "", envId: first.id };
        },
      });
      expect(missing).toMatchObject({ ok: false, code: "missing_env" });
      expect(missing.message).toContain("不会改用默认登录");
      expect(unknown).toMatchObject({ ok: false, code: "unknown_env", envId: "default" });
      expect(unknown.message).toContain("不会改用默认登录");
      expect(collectCalls).toBe(0);
      const db = { listMetrics: async () => { throw new Error("不应读取"); } };
      const skipped = await loadStudioData({ envId: "", configDir, file, db });
      expect(skipped.ok).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("采集串行且只打当前环境的标签，失败保留 0 和已有快照", async () => {
    const dir = mkdtempSync(join(tmpdir(), "studio-collect-"));
    const file = join(dir, "metrics.sqlite");
    const envId = "env-collect";
    try {
      const script = metricGetScript(["https://example.com/metrics"]);
      expect(script).toContain("x.open('GET'");
      expect(script).not.toContain("POST");
      let called = false;
      const missing = await collectAll({ file, readJsons: async () => { called = true; return []; } });
      expect(missing).toMatchObject({ ok: false, code: "missing_env", envId: "" });
      expect(missing.message).toContain("不会改用默认登录");
      expect(called).toBe(false);
      const unlinked = await collectAll({
        envId,
        file,
        accounts: {},
        platforms: ["toutiao"],
        tabs: [{ id: "tt", envId, url: "https://mp.toutiao.com/profile_v4/graphic/publish" }],
        readJsons: async () => { called = true; return []; },
      });
      expect(unlinked.code).toBe("unlinked");
      expect(called).toBe(false);
      expect(existsSync(file)).toBe(false);
      let active = 0;
      let max = 0;
      const seen: string[] = [];
      const tabs = [
        { id: "decoy", envId: "", url: "https://mp.toutiao.com/profile_v4/graphic/publish" },
        { id: "tt", envId, url: "https://mp.toutiao.com/profile_v4/graphic/publish" },
        { id: "bj-other", envId: "someone-else", url: "https://baijiahao.baidu.com/builder/rc/edit?type=news" },
        { id: "bj", envId, url: "https://baijiahao.baidu.com/builder/rc/edit?type=news" },
      ];
      const progress: string[] = [];
      await collectAll({
        envId,
        file,
        force: true,
        accounts: { toutiao: "tt-user", baijiahao: "bj-user" },
        platforms: ["toutiao", "baijiahao"],
        tabs,
        onProgress: (event) => { if (event.phase === "start") progress.push(event.platform); },
        readJsons: async (_sparo, tab) => {
          active += 1;
          max = Math.max(max, active);
          seen.push(String(tab.id));
          await new Promise((resolve) => setTimeout(resolve, 20));
          active -= 1;
          return [{ status: 401, json: null }];
        },
      });
      expect(max).toBe(1);
      expect(seen[0]).toBe("tt");
      expect(seen).toContain("bj");
      expect(seen).not.toContain("decoy");
      expect(seen).not.toContain("bj-other");
      expect(progress).toEqual(["toutiao", "baijiahao"]);
      expect(existsSync(file)).toBe(true);
      const blanks = await listMetrics(file);
      expect(blanks).toHaveLength(2);
      for (const row of blanks) {
        expect(row.reads ?? null).toBeNull();
        expect(row.follows ?? null).toBeNull();
        expect(row.revenue ?? null).toBeNull();
        expect(row.completeness).toBe("missing");
        expect(String(row.accountId)).toContain("env:" + envId + ":");
      }

      const accountId = linkedAccountId(envId, "tt-user");
      await upsertMetric({
        platform: "toutiao",
        accountId,
        envId,
        date: "2026-11-12",
        reads: 338,
        follows: 0,
        revenue: 29,
        completeness: "full",
        capturedAt: "2026-11-12T10:30:00+08:00",
      }, file);
      const failed = await collectAll({
        envId,
        file,
        force: true,
        accounts: { toutiao: "tt-user" },
        platforms: ["toutiao"],
        clock: new Date(2026, 10, 13, 9, 0),
        tabs: [{ id: "tt", envId, url: "https://mp.toutiao.com/profile_v4/graphic/publish" }],
        readJsons: async () => [{ status: 401, json: null }],
      });
      expect(failed.ok).toBe(false);
      expect(failed.message).toContain("未获取到新数据");
      const kept = (await listMetrics(file)).find((row) => row.platform === "toutiao" && row.date === "2026-11-12");
      expect(kept.reads).toBe(338);
      expect(kept.reason).toContain("登录");
      await upsertMetric({
        platform: "baijiahao",
        accountId: linkedAccountId(envId, "bj-user"),
        envId,
        date: "2026-11-12",
        reads: 0,
        follows: 0,
        completeness: "full",
        capturedAt: "2026-11-12T10:30:00+08:00",
      }, file);
      await collectAll({
        envId,
        file,
        force: true,
        accounts: { baijiahao: "bj-user" },
        platforms: ["baijiahao"],
        clock: new Date(2026, 10, 13, 9, 0),
        tabs: [{ id: "bj", envId, url: "https://baijiahao.baidu.com/builder/rc/edit?type=news" }],
        readJsons: async () => [{ status: 500, json: null }],
      });
      const zero = (await listMetrics(file)).find((row) => row.platform === "baijiahao");
      expect(zero.reads).toBe(0);
      expect(zero.reason).toContain("接口错误");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("刷新失败保留旧快照，部分数据不给百分比", async () => {
    const dir = mkdtempSync(join(tmpdir(), "studio-refresh-"));
    const file = join(dir, "metrics.sqlite");
    const configDir = join(dir, "config");
    try {
      const env = createEnv(configDir, { account: { type: "other", name: "二号" } });
      const now = new Date(2026, 10, 13, 10, 30);
      await upsertMetric({
        platform: "toutiao",
        accountId: linkedAccountId(env.id, "tt"),
        envId: env.id,
        date: "2026-11-12",
        reads: 338,
        follows: 4,
        revenue: 100,
        completeness: "full",
        capturedAt: "2026-11-13T10:30:00+08:00",
      }, file);
      const failed = await refreshStudioData({
        envId: env.id,
        configDir,
        file,
        now,
        collect: async () => { throw new Error("network down"); },
      });
      expect(failed.ok).toBe(false);
      expect(failed.kept).toBe(true);
      expect(failed.message).toContain("未获取到新数据");
      expect(failed.metrics?.overview.reads?.value).toBe(338);
      expect((await listMetrics(file))[0].reads).toBe(338);
      const full = buildMetricsView({
        envId: env.id,
        now,
        rows: [
          { platform: "toutiao", accountId: linkedAccountId(env.id, "tt"), date: "2026-11-11", reads: 10, follows: 1, revenue: 100, completeness: "full" },
          { platform: "toutiao", accountId: linkedAccountId(env.id, "tt"), date: "2026-11-12", reads: 20, follows: -5, revenue: 200, completeness: "full" },
        ],
      });
      expect(full.deltaText).toBe("+100%");
      expect(full.hideDelta).toBe(false);
      expect(full.overview.follows?.text).toBe("-4");
      const partial = buildMetricsView({
        envId: env.id,
        now,
        rows: [
          { platform: "toutiao", accountId: linkedAccountId(env.id, "tt"), date: "2026-11-11", reads: 10, completeness: "full" },
          { platform: "baijiahao", accountId: linkedAccountId(env.id, "bj"), date: "2026-11-12", reads: 3, completeness: "partial", reason: "有字段没对上" },
        ],
      });
      expect(partial.hideDelta).toBe(true);
      expect(partial.deltaText).toBe("");
      expect(partial.overview.reads?.value).toBe(13);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("full 与 missing/null 混合时按字段保留已知合计但不标完整", () => {
    const envId = "env-mixed";
    const view = buildMetricsView({
      envId,
      now: new Date(2026, 10, 13, 10, 30),
      rows: [
        { platform: "toutiao", accountId: linkedAccountId(envId, "tt"), date: "2026-11-11", reads: 10, follows: 1, revenue: 100, completeness: "full" },
        { platform: "baijiahao", accountId: linkedAccountId(envId, "bj"), date: "2026-11-11", reads: null, follows: null, revenue: null, completeness: "missing" },
        { platform: "toutiao", accountId: linkedAccountId(envId, "tt"), date: "2026-11-12", reads: 20, follows: 3, revenue: 200, completeness: "full" },
        { platform: "baijiahao", accountId: linkedAccountId(envId, "bj"), date: "2026-11-12", reads: null, follows: null, revenue: null, completeness: "full" },
      ],
    });
    expect(view.overview.reads).toMatchObject({ value: 30, completeness: "partial" });
    expect(view.overview.follows).toMatchObject({ value: 4, completeness: "partial" });
    expect(view.overview.revenue).toMatchObject({ value: 300, completeness: "partial" });
    expect(view.deltaText).toBe("");
  });
});

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
      id: "",
      children: [] as Array<ReturnType<typeof make>>,
      parentElement: null as ReturnType<typeof make> | null,
      attributes: {} as Record<string, string>,
      style: {} as Record<string, string>,
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
      dispatchEvent(event: { type: string }) {
        const typed = { ...event, target: el };
        for (const fn of [...(listeners[event.type] || [])]) fn(typed);
      },
    };
    Object.defineProperty(el, "textContent", {
      get() {
        return el.children.length ? el.children.map((child) => child.textContent).join("") : text;
      },
      set(value: string) {
        text = value == null ? "" : String(value);
        el.children = [];
      },
    });
    return el;
  }
  const document = {
    createElement: (tag: string) => make(tag),
    createElementNS: (_ns: string, tag: string) => make(tag),
    getElementById: () => null,
    head: make("head"),
    body: make("body"),
  };
  (globalThis as { document?: typeof document }).document = document;
  return document;
}

function actions(envId: string, over: Partial<Actions> = {}) {
  const calls: string[] = [];
  const unsupported = async () => ({ ok: false as const, code: "unsupported", message: "尚未接入", envId });
  const page: Actions = {
    navigate: (view, filter) => { calls.push("navigate:" + view + ":" + (filter || "")); },
    reload: async (id) => { calls.push("reload:" + id); },
    saveDraft: unsupported,
    precheck: unsupported,
    confirm: unsupported,
    pickImages: unsupported,
    checkAccounts: async (input) => { calls.push("check:" + input.envId + ":" + input.platforms.join(",")); return unsupported(); },
    openAccount: async (input) => { calls.push("login:" + input.envId + ":" + input.platform); return unsupported(); },
    refreshMetrics: async (id) => { calls.push("refresh:" + id); return { ok: false, code: "error", message: "网络失败", envId: id }; },
    openTask: unsupported,
    verifyTask: unsupported,
    resumeTask: unsupported,
    fillReply: unsupported,
    onTasksChanged: () => () => { calls.push("off"); },
    ...over,
  };
  return { page, calls };
}

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function point(date: string, platform: string, reads: number | null, extra: Record<string, unknown> = {}) {
  return {
    date,
    platform,
    reads,
    follows: extra.follows as number | null | undefined ?? null,
    revenue: extra.revenue as string | null | undefined ?? null,
    revenueCents: extra.revenueCents as number | null | undefined ?? null,
    likes: extra.likes as number | null | undefined ?? null,
    completeness: (extra.completeness as MetricsPageModel["trend"][number]["completeness"]) || "full",
    reason: String(extra.reason || ""),
    capturedAt: "2026-11-13T10:30:00+08:00",
    source: platform,
  };
}

function model(extra: Partial<MetricsPageModel> = {}): MetricsPageModel {
  return {
    envId: "env-b",
    capturedAt: "2026-11-13T10:30:00+08:00",
    today: "2026-11-13",
    month: "2026-11",
    metricsKnown: true,
    overview: { reads: null, follows: null, revenue: null },
    trend: [
      point("2026-11-11", "toutiao", 10, { follows: 0, revenue: "1.00", revenueCents: 100, likes: 2 }),
      point("2026-11-12", "toutiao", 20, { follows: -5, revenue: "2.00", revenueCents: 200, likes: 0 }),
      point("2026-11-12", "sohu", null, { completeness: "unsupported", reason: "平台没有收益字段" }),
    ],
    ranking: [
      { title: "标".repeat(40), platform: "toutiao", reads: 123456789012, completeness: "full", interaction: 0, publishedAt: "2026-11-12T09:00:00+08:00", date: "2026-11-12", reason: "", raw: { token: "SECRET_TOKEN_VALUE" } },
      { title: "缺互动", platform: "baijiahao", reads: null, completeness: "missing", interaction: null, publishedAt: "", date: "2026-11-12", reason: "没有读到这篇" },
    ],
    compare: [],
    revenueSplit: [
      { platform: "toutiao", text: "¥3.00", completeness: "full", cents: 300, ad: 100, activity: null, subsidy: 0, date: "2026-11-12" },
      { platform: "sohu", text: "平台未提供", completeness: "unsupported", cents: null, reason: "平台没有收益字段", date: "2026-11-12" },
    ],
    exceptions: [
      { platform: "toutiao", completeness: "full", state: "stale", reason: "超过一天没更新", date: "2026-11-12" },
      { platform: "baijiahao", completeness: "missing", state: "login_missing", reason: "登录态缺失", date: "2026-11-12" },
      { platform: "dayu", completeness: "missing", state: "error", reason: "接口错误", date: "2026-11-12" },
      { platform: "sohu", completeness: "unsupported", state: "unsupported", reason: "平台没有收益字段", date: "2026-11-12" },
      { platform: "toutiao", completeness: "missing", state: "unknown", reason: "还没核验", date: "2026-11-10" },
    ],
    ...extra,
  };
}

describe("数据页", () => {
  it("真实 0、缺失和四种完整度、四种展示状态都不一样", () => {
    expect(displayCount(0, "full")).toBe("0");
    expect(displayCount(null, "full")).toBe("—");
    expect(displayCount(0, "missing")).toBe("—");
    expect(displayCount(0, "unsupported")).toBe("—");
    expect(displayFollows(-5, "full")).toBe("-5");
    expect(displayFollows(32, "full")).toBe("+32");
    expect(displayFollows(0, "full")).toBe("0");
    expect(displayCents(0, "full")).toBe("¥0.00");
    expect(displayCents(369, "full")).toBe("¥3.69");
    expect(displayCents(null, "missing")).toBe("—");
    const labels = ["full", "partial", "missing", "unsupported"].map(completenessLabel);
    expect(new Set(labels).size).toBe(4);
    const states = ["stale", "login_missing", "error", "unknown"].map(exceptionCopy);
    expect(new Set(states.map((item) => item.title)).size).toBe(4);
    expect(new Set(states.map((item) => item.actionLabel)).size).toBe(4);
    expect(new Set(states.map((item) => item.hint)).size).toBe(4);
    const summary = summarizeWindow([
      point("2026-11-11", "toutiao", 10),
      point("2026-11-12", "toutiao", null, { completeness: "missing" }),
      point("2026-11-13", "toutiao", 30),
    ]);
    expect(summary.reads).toBe(40);
    expect(summary.deltaText).toBe("");
    const partial = summarizeWindow([
      point("2026-11-12", "toutiao", 10),
      point("2026-11-13", "baijiahao", 5, { completeness: "partial" }),
    ]);
    expect(partial.partial).toBe(true);
    expect(partial.deltaText).toBe("");
    expect(trendSegments([{ date: "2026-11-12", value: 8 }]).status).toBe("single");
    const broken = trendSegments([
      { date: "2026-11-10", value: 1 },
      { date: "2026-11-11", value: 2 },
      { date: "2026-11-12", value: null },
      { date: "2026-11-13", value: 4 },
      { date: "2026-11-14", value: 5 },
    ]);
    expect(broken.segments).toHaveLength(2);
    expect(broken.segments[0].map((item) => item.date)).toEqual(["2026-11-10", "2026-11-11"]);
    expect(broken.segments[1].map((item) => item.date)).toEqual(["2026-11-13", "2026-11-14"]);
    const hole = trendSegments([
      { date: "2026-11-10", value: 1 },
      { date: "2026-11-12", value: 4 },
    ]);
    expect(hole.segments).toHaveLength(2);
    expect(hole.segments[0]).toHaveLength(1);
    expect(hole.segments[1]).toHaveLength(1);
  });

  it("页面合计按 reads/follows/revenue 传播缺数且不给缺数区间涨跌", () => {
    const summary = summarizeWindow([
      point("2026-11-11", "toutiao", 10, { follows: 1, revenueCents: 100 }),
      point("2026-11-11", "baijiahao", null, { completeness: "missing" }),
      point("2026-11-12", "toutiao", 20, { follows: 3, revenueCents: 200 }),
      point("2026-11-12", "baijiahao", null),
    ]);
    expect(summary).toMatchObject({
      reads: 30,
      follows: 4,
      revenueCents: 300,
      readsCompleteness: "partial",
      followsCompleteness: "partial",
      revenueCompleteness: "partial",
      deltaText: "",
    });
    const unsupported = summarizeWindow([point("2026-11-12", "sohu", null, { completeness: "unsupported" })]);
    expect(unsupported).toMatchObject({ readsCompleteness: "unsupported", followsCompleteness: "unsupported", revenueCompleteness: "unsupported" });
    const missing = summarizeWindow([point("2026-11-12", "baijiahao", null, { completeness: "missing" })]);
    expect(missing).toMatchObject({ readsCompleteness: "missing", followsCompleteness: "missing", revenueCompleteness: "missing" });
  });

  it("平台对比混入缺数时保留已知合计但不标 full", () => {
    installDom();
    const harness = actions("env-b");
    const container = (globalThis as { document: { createElement: (tag: string) => HTMLElement } }).document.createElement("div");
    mount(container, model({
      trend: [
        point("2026-11-11", "toutiao", 10, { likes: 1 }),
        point("2026-11-12", "toutiao", 20, { likes: 2 }),
        point("2026-11-12", "toutiao", null, { completeness: "missing", reason: "有一个账号没读到" }),
        point("2026-11-12", "sohu", null, { completeness: "unsupported", reason: "平台未提供" }),
      ],
      ranking: [],
      revenueSplit: [],
      exceptions: [],
    }), harness.page);
    const rows = container.querySelectorAll(".compare-row");
    const toutiao = rows.find((row) => String(row.textContent).includes("头条号"));
    const sohu = rows.find((row) => String(row.textContent).includes("搜狐号"));
    expect(toutiao?.getAttribute("data-state")).toBe("partial");
    expect(toutiao?.textContent).toContain("30");
    expect(sohu?.getAttribute("data-state")).toBe("unsupported");
  });

  it("六块都有内容，筛选、页签、失败刷新和销毁按约定工作", async () => {
    installDom();
    const source = readFileSync(new URL("../src/renderer/studio/pages/metrics.ts", import.meta.url), "utf8");
    const css = readFileSync(new URL("../src/renderer/studio/pages/metrics.css", import.meta.url), "utf8");
    expect(source.includes("JSON.stringify")).toBe(false);
    expect(source.includes("innerHTML")).toBe(false);
    expect(css).toContain("tabular-nums");
    expect(css).toContain("overflow-wrap: anywhere");
    expect(css).toContain("min-width: 0");
    expect(css).toContain("text-align: right");
    const harness = actions("env-b");
    let release: (value: { ok: false; code: string; message: string; envId: string }) => void = () => {};
    harness.page.refreshMetrics = (id) => {
      harness.calls.push("refresh:" + id);
      return new Promise((resolve) => { release = resolve; });
    };
    const container = (globalThis as { document: { createElement: (tag: string) => HTMLElement } }).document.createElement("div");
    const page = model({ cooldownMs: 40 });
    const handle = mount(container, page, harness.page);
    for (const name of ["overview", "trend", "ranking", "compare", "revenue", "exceptions"]) {
      expect(container.querySelector(`[data-block="${name}"]`)).not.toBeNull();
    }
    expect(container.textContent).toContain("相加，非去重");
    expect(container.textContent).toContain("账面相加，非到账");
    expect(container.textContent).toContain("标".repeat(40));
    expect(container.textContent).toContain("123,456,789,012");
    expect(container.textContent).toContain("-5");
    expect(container.textContent).not.toContain("SECRET_TOKEN_VALUE");
    expect(container.textContent).toContain("平台没有收益字段");
    const unsupportedRevenue = container.querySelectorAll("[data-state=\"unsupported\"]").find((node) => String(node.textContent).includes("广告"));
    expect(unsupportedRevenue?.textContent || "").not.toContain("¥0.00");
    expect(unsupportedRevenue?.textContent || "").toContain("不支持");
    expect(container.querySelector("[data-state=\"missing\"]")).not.toBeNull();
    expect(container.querySelector("[data-state=\"unsupported\"]")).not.toBeNull();
    expect(container.querySelector("[data-state=\"stale\"]")?.textContent).toContain("未更新");
    expect(container.querySelector("[data-state=\"login_missing\"]")?.textContent).toContain("重新登录");
    expect(container.querySelector("[data-state=\"error\"]")?.textContent).toContain("保留并重试");
    expect(container.querySelector("[data-state=\"unknown\"]")?.textContent).toContain("去核验");
    expect(container.querySelectorAll("polyline").length).toBeGreaterThan(0);
    const single = model({
      trend: [point("2026-11-13", "toutiao", 8)],
      ranking: [],
      revenueSplit: [],
      exceptions: [],
    });
    const singleHost = (globalThis as { document: { createElement: (tag: string) => HTMLElement } }).document.createElement("div");
    const singlePage = mount(singleHost, single, harness.page);
    expect(singleHost.querySelector("[data-block=\"trend\"]")?.textContent).toContain("暂无趋势");
    expect(singleHost.querySelector("svg")).toBeNull();
    singlePage.destroy();
    const gapHost = (globalThis as { document: { createElement: (tag: string) => HTMLElement } }).document.createElement("div");
    mount(gapHost, model({
      trend: [
        point("2026-11-10", "toutiao", 1),
        point("2026-11-11", "toutiao", 2),
        point("2026-11-12", "toutiao", null, { completeness: "missing", reason: "这天没拿到" }),
        point("2026-11-13", "toutiao", 4),
        point("2026-11-14", "toutiao", 5, { follows: 1 }),
      ],
      today: "2026-11-14",
    }), harness.page);
    expect(gapHost.querySelector("[data-block=\"trend\"]")?.getAttribute("data-segments")).toBe("2");
    expect(gapHost.querySelectorAll("polyline")).toHaveLength(2);
    const partialHost = (globalThis as { document: { createElement: (tag: string) => HTMLElement } }).document.createElement("div");
    mount(partialHost, model({
      deltaText: "+99%",
      hideDelta: true,
      trend: [
        point("2026-11-12", "toutiao", 10, { follows: 1, revenueCents: 100, revenue: "1.00" }),
        point("2026-11-13", "baijiahao", 5, { completeness: "partial", reason: "有字段没对上", follows: 1, revenueCents: 50, revenue: "0.50" }),
      ],
    }), harness.page);
    expect(partialHost.querySelector("[data-block=\"overview\"]")?.textContent).not.toContain("%");
    expect(partialHost.querySelector("[data-block=\"overview\"]")?.textContent).not.toContain("较前一日");
    const platform = container.querySelector("[aria-label=\"平台\"]");
    platform.value = "sohu";
    platform.dispatchEvent({ type: "change" });
    expect(container.textContent).toContain("搜狐号");
    expect(container.textContent).not.toContain("123,456,789,012");
    platform.value = "all";
    platform.dispatchEvent({ type: "change" });
    container.querySelector("[data-action=\"tab-revenue\"]").click();
    expect(container.querySelector("[data-action=\"tab-revenue\"]").getAttribute("aria-selected")).toBe("true");
    expect(container.querySelector("[data-panel=\"revenue\"]").hidden).toBe(false);
    expect(container.querySelector("[data-panel=\"compare\"]").hidden).toBe(true);
    expect(container.textContent).toContain("广告");
    expect(container.textContent).toContain("补贴 ¥0.00");
    expect(container.textContent).not.toContain("只记录了账面合计");
    const refresh = container.querySelector("[aria-label=\"立即刷新\"]");
    refresh.click();
    expect(container.textContent).toContain("正在读取平台数据");
    expect(container.textContent).not.toContain("未获取到新数据");
    expect(container.textContent).toContain("123,456,789,012");
    release({ ok: false, code: "error", message: "网络失败", envId: "env-b" });
    await flush();
    expect(container.textContent).toContain("未获取到新数据");
    expect(container.textContent).toContain("11-13 10:30");
    expect(container.textContent).toContain("123,456,789,012");
    expect(harness.calls.filter((item) => item.startsWith("refresh:"))).toEqual(["refresh:env-b"]);
    refresh.click();
    expect(harness.calls.filter((item) => item.startsWith("refresh:")).length).toBe(1);
    const login = container.querySelector("[data-action=\"login\"]");
    login.click();
    expect(harness.calls).toContain("login:env-b:baijiahao");
    handle.destroy();
    login.click();
    refresh.click();
    expect(harness.calls.filter((item) => item.startsWith("login:")).length).toBe(1);
    expect(harness.calls.filter((item) => item.startsWith("refresh:")).length).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 60));
    refresh.click();
    expect(harness.calls.filter((item) => item.startsWith("refresh:")).length).toBe(1);
  });
});
