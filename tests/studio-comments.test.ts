import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEnv } from "../src/main/envs/store.js";
import {
  buildCommentsViewModel,
  fillCommentReply,
  ingestCommentGet,
  loadCommentInbox,
  type CommentRecord,
  type CommentsPort,
} from "../src/main/studio-comments.js";
import {
  allowReply,
  buildReplyFillScript,
  canReply,
  COMMENT_PLATFORMS,
  fillOpenReply,
  HOUR_CAP,
  listCachedComments,
  listCommentStatus,
  listCommentsForEnv,
  loadCommentStore,
  mapCommentList,
  MIN_GAP_MS,
  migrateCommentCache,
  readCommentStore,
  replyLabel,
  resetCommentLock,
  resolveReplyTab,
  writeCommentStore,
} from "../strategies/skills/social-media-publish/scripts/comments.mjs";
import { loadProfile } from "../strategies/skills/social-media-publish/scripts/profile.mjs";

const fakeDom = vi.hoisted(() => {
  type Listener = (event: { type: string; target: FakeNode }) => void;
  class FakeNode {
    tag: string;
    className = "";
    children: FakeNode[] = [];
    parentElement: FakeNode | null = null;
    attrs = new Map<string, string>();
    listeners = new Map<string, Set<Listener>>();
    hidden = false;
    disabled = false;
    value = "";
    placeholder = "";
    type = "";
    title = "";
    id = "";
    clientWidth = 0;
    private text = "";

    constructor(tag: string) {
      this.tag = tag;
    }

    get textContent(): string {
      if (this.children.length) return this.children.map((child) => child.textContent).join("");
      return this.text;
    }

    set textContent(value: string) {
      this.text = value == null ? "" : String(value);
      for (const child of this.children) child.parentElement = null;
      this.children = [];
    }

    setAttribute(name: string, value: string): void {
      this.attrs.set(name, value);
    }

    getAttribute(name: string): string | null {
      return this.attrs.has(name) ? this.attrs.get(name) || "" : null;
    }

    removeAttribute(name: string): void {
      this.attrs.delete(name);
    }

    append(...nodes: FakeNode[]): void {
      for (const node of nodes) {
        node.parentElement = this;
        this.children.push(node);
      }
    }

    replaceChildren(...nodes: FakeNode[]): void {
      for (const child of this.children) child.parentElement = null;
      this.children = [];
      this.append(...nodes);
    }

    addEventListener(type: string, fn: Listener): void {
      const set = this.listeners.get(type) || new Set<Listener>();
      set.add(fn);
      this.listeners.set(type, set);
    }

    removeEventListener(type: string, fn: Listener): void {
      this.listeners.get(type)?.delete(fn);
    }

    listenerCount(type: string): number {
      return this.listeners.get(type)?.size || 0;
    }

    matches(selector: string): boolean {
      const sel = selector.trim();
      if (sel.startsWith(".")) return this.className.split(/\s+/).includes(sel.slice(1));
      if (sel.startsWith("[") && sel.endsWith("]")) {
        const body = sel.slice(1, -1);
        const eq = body.indexOf("=");
        if (eq < 0) return this.attrs.has(body);
        const name = body.slice(0, eq);
        const expected = body.slice(eq + 1).replace(/^["']|["']$/g, "");
        return this.getAttribute(name) === expected;
      }
      return this.tag === sel;
    }

    querySelectorAll(selector: string): FakeNode[] {
      const found: FakeNode[] = [];
      const walk = (node: FakeNode) => {
        for (const child of node.children) {
          if (child.matches(selector)) found.push(child);
          walk(child);
        }
      };
      walk(this);
      return found;
    }

    querySelector(selector: string): FakeNode | null {
      return this.querySelectorAll(selector)[0] || null;
    }

    emit(type: string): void {
      const event = { type, target: this };
      const seen = new Set<FakeNode>();
      let node: FakeNode | null = this;
      while (node && !seen.has(node)) {
        seen.add(node);
        const set = node.listeners.get(type);
        if (set) for (const fn of [...set]) fn(event);
        node = node.parentElement;
      }
    }

    click(): void {
      this.emit("click");
    }

    dispatchEvent(event: { type: string }): void {
      this.emit(event.type);
    }
  }

  function fakeEl(tag: string, className?: string, text?: string): FakeNode {
    const node = new FakeNode(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  return { FakeNode, fakeEl };
});

vi.mock("../src/renderer/studio/dom.ts", async () => {
  const actual = await vi.importActual<typeof import("../src/renderer/studio/dom.ts")>("../src/renderer/studio/dom.ts");
  return { ...actual, el: fakeDom.fakeEl };
});

const { mount, accountDataStatus, commentLayout, filterCommentRows, unrepliedCount } = await import("../src/renderer/studio/pages/comments.ts");

const port = {
  canReply,
  listCommentStatus,
  loadCommentStore,
  listCachedComments,
  saveReplyDraft: (await import("../strategies/skills/social-media-publish/scripts/comments.mjs")).saveReplyDraft,
  fillOpenReply,
  reconcileWithGet: (await import("../strategies/skills/social-media-publish/scripts/comments.mjs")).reconcileWithGet,
} as CommentsPort;

afterEach(() => {
  resetCommentLock();
});

function linked(envId: string, platform: string, commentId: string, extra: Partial<CommentRecord> = {}): CommentRecord {
  return {
    envId,
    platform,
    commentId,
    author: extra.author || "甲",
    content: extra.content || "写得好",
    title: extra.title || "一篇",
    articleId: extra.articleId || "9",
    createdAt: extra.createdAt || "2026-11-12 10:00",
    draftText: extra.draftText || "",
    pendingReply: extra.pendingReply || "",
    replied: extra.replied === true,
    association: "linked",
    linkLabel: "",
  };
}

function seed(dir: string, records: CommentRecord[], drafts: Array<{ envId: string; platform: string; commentId: string; text: string; stamps: number[] }> = []) {
  writeCommentStore(dir, {
    version: 2,
    legacyMerged: true,
    records,
    drafts: drafts.map((item) => ({ ...item, association: "linked", linkLabel: "", updatedAt: "2026-11-12T00:00:00.000Z" })),
    notes: [],
  });
}

describe("评论回复边界", () => {
  it("只有头条和百家能回复", () => {
    expect(COMMENT_PLATFORMS).toEqual(["toutiao", "baijiahao", "dayu", "sohu"]);
    expect(canReply("toutiao")).toBe(true);
    expect(canReply("baijiahao")).toBe(true);
    expect(replyLabel("dayu")).toBe("只读，回复未开");
    expect(replyLabel("sohu")).toBe("只读，回复未开");
    expect(canReply("weibo")).toBe(false);
  });

  it("间隔 20 秒，每小时不超过 30 条", () => {
    const now = 1_000_000;
    const soon = allowReply([now - MIN_GAP_MS + 1000], now);
    expect(soon.ok).toBe(false);
    expect(soon.reason).toContain("20");
    expect(soon.reason).toContain("后再试");
    expect(soon.retryAt).toBe(now - MIN_GAP_MS + 1000 + MIN_GAP_MS);
    expect(allowReply([now - MIN_GAP_MS], now).ok).toBe(true);
    const burst = Array.from({ length: HOUR_CAP }, (_, index) => now - 60_000 - index * 1000);
    const capped = allowReply(burst, now);
    expect(capped.reason).toContain("30");
    expect(capped.reason).toMatch(/\d{2}:\d{2}:\d{2}/);
  });

  it("按实测字段映射评论，不补空行", () => {
    const toutiao = mapCommentList(loadProfile("toutiao"), {
      data: [{ id_str: "1", text: "写得好", create_time: 1762828800, user: { name: "甲" }, article_info: { group_id_str: "9", title: "一篇" } }],
    });
    expect(toutiao).toEqual([expect.objectContaining({ commentId: "1", author: "甲", content: "写得好", title: "一篇", articleId: "9" })]);
    const baijia = mapCommentList(loadProfile("baijiahao"), {
      data: { reply_list: [{ reply_id: "2", content: "收到", uname: "乙", article_id: "8", title: "另一篇", create_time: "2026-11-11 09:00" }] },
    });
    expect(baijia[0]).toMatchObject({ commentId: "2", author: "乙", content: "收到", createdAt: "2026-11-11 09:00" });
    expect(mapCommentList(loadProfile("baijiahao"), {
      data: { reply_list: [{ reply_id: "3", content: "时间", uname: "丙", article_id: "1", title: "题", create_time: "1794387488" }] },
    })[0].createdAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    expect(mapCommentList(loadProfile("toutiao"), { data: {} })).toEqual([]);
  });

  it("没到间隔时填写动作直接停，不去碰页面", async () => {
    const dir = mkdtempSync(join(tmpdir(), "studio-reply-"));
    const prev = process.env.APPDATA;
    process.env.APPDATA = dir;
    mkdirSync(join(dir, "sparo-store"), { recursive: true });
    writeFileSync(join(dir, "sparo-store", "comment-drafts.json"), JSON.stringify({
      toutiao: { text: "", stamps: [Date.now()] },
    }));
    try {
      const result = await fillOpenReply("toutiao", "已看到", { commentId: "1", content: "写得好" });
      expect(result.filled).toBeUndefined();
      expect(result.message).toContain("20");
    } finally {
      process.env.APPDATA = prev;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("评论服务", () => {
  it("探针未通不伪造空列表，大鱼和搜狐不能回复", () => {
    const status = listCommentStatus();
    expect(status.map((item: { platform: string }) => item.platform)).toEqual(["toutiao", "baijiahao", "dayu", "sohu"]);
    const model = buildCommentsViewModel({
      envId: "env-a",
      envName: "第二环境",
      boards: status,
      records: [
        linked("env-a", "toutiao", "1", { author: "甲" }),
        linked("env-a", "dayu", "9", { author: "不该出现" }),
        linked("env-b", "toutiao", "2", { author: "乙" }),
        { ...linked("", "toutiao", "3", { author: "旧" }), association: "unlinked", linkLabel: "未关联", envId: "" },
      ],
    });
    const toutiao = model.boards.find((item) => item.platform === "toutiao");
    const dayu = model.boards.find((item) => item.platform === "dayu");
    const sohu = model.boards.find((item) => item.platform === "sohu");
    expect(toutiao?.comments.map((item) => item.author)).toEqual(["甲"]);
    expect(toutiao?.canReply).toBe(true);
    expect(dayu?.comments).toEqual([]);
    expect(dayu?.reason).toContain("未实测");
    expect(dayu?.canReply).toBe(false);
    expect(dayu?.unrepliedCount).toBeNull();
    expect(sohu?.canReply).toBe(false);
    expect(sohu?.reason).toContain("未实测");
    expect(JSON.stringify(model)).not.toContain("不该出现");
    expect(JSON.stringify(model)).not.toContain("乙");
  });

  it("非默认环境的列表只含该环境，缺环境和未知环境都停止", () => {
    const configDir = mkdtempSync(join(tmpdir(), "studio-comment-env-"));
    const storeDir = mkdtempSync(join(tmpdir(), "studio-comment-store-"));
    try {
      const created = createEnv(configDir, { account: { type: "other", name: "第二环境" } });
      const other = createEnv(configDir, { account: { type: "other", name: "另一个" } });
      seed(storeDir, [
        linked(created.id, "toutiao", "1", { author: "当前号" }),
        linked(other.id, "toutiao", "2", { author: "另一个号" }),
      ]);
      const inbox = loadCommentInbox(configDir, storeDir, created.id, port);
      expect(inbox).toMatchObject({ envId: created.id, envName: "第二环境" });
      if (!("boards" in inbox)) throw new Error("应该返回收件箱");
      expect(inbox.boards.find((item) => item.platform === "toutiao")?.comments.map((item) => item.author)).toEqual(["当前号"]);
      const missing = loadCommentInbox(configDir, storeDir, "", port);
      const unknown = loadCommentInbox(configDir, storeDir, "default", port);
      expect(missing).toMatchObject({ ok: false, code: "missing_env", envId: "" });
      expect(missing).toMatchObject({ message: expect.stringContaining("不会改用默认登录") });
      expect(unknown).toMatchObject({ ok: false, code: "unknown_env", envId: "default" });
      expect(JSON.stringify(missing)).not.toContain("当前号");
      expect(JSON.stringify(unknown)).not.toContain(created.id);
    } finally {
      rmSync(configDir, { recursive: true, force: true });
      rmSync(storeDir, { recursive: true, force: true });
    }
  });

  it("无法归属的旧缓存标为未关联，不进入当前环境", () => {
    const dir = mkdtempSync(join(tmpdir(), "studio-comment-legacy-"));
    try {
      writeFileSync(join(dir, "comment-drafts.json"), JSON.stringify({
        toutiao: { text: "旧草稿", stamps: [1] },
      }));
      writeFileSync(join(dir, "comment-cache.json"), JSON.stringify({
        comments: [{ platform: "toutiao", commentId: "old", author: "旧", content: "旧评论" }],
      }));
      const store = loadCommentStore(dir);
      expect(store.records.map((item: CommentRecord) => item.linkLabel)).toEqual(["未关联"]);
      expect(store.records[0].association).toBe("unlinked");
      expect(store.records[0].replied).toBe(false);
      expect(store.drafts[0]).toMatchObject({ association: "unlinked", linkLabel: "未关联", envId: "" });
      expect(listCachedComments(dir, "env-a")).toEqual([]);
      const owned = migrateCommentCache(null, { toutiao: { text: "明确", stamps: [], envId: "env-a" } });
      expect(owned.drafts[0]).toMatchObject({ association: "linked", envId: "env-a", linkLabel: "" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("回复框未打开、不唯一、验证码和填写失败都会停，并留下草稿", async () => {
    const configDir = mkdtempSync(join(tmpdir(), "studio-comment-fill-"));
    const storeDir = mkdtempSync(join(tmpdir(), "studio-comment-fill-store-"));
    try {
      const created = createEnv(configDir, { account: { type: "other", name: "第二环境" } });
      seed(storeDir, [linked(created.id, "toutiao", "1", { content: "写得好" })]);
      const closed = await fillCommentReply(configDir, storeDir, {
        envId: created.id, platform: "toutiao", commentId: "1", text: "草稿甲", content: "写得好",
      }, port);
      expect(closed.code).toBe("reply_box_closed");
      expect(closed.message).toContain("回复框未打开");
      expect(readCommentStore(storeDir).records[0].draftText).toBe("草稿甲");
      expect(readCommentStore(storeDir).records[0].replied).toBe(false);

      let ran = false;
      const ambiguous = await fillCommentReply(configDir, storeDir, {
        envId: created.id, platform: "toutiao", commentId: "1", text: "草稿甲",
      }, port, { probe: () => { ran = true; return { ok: false, reason: "定位不唯一", n: 2 }; } });
      expect(ran).toBe(true);
      expect(ambiguous.code).toBe("reply_target_ambiguous");
      expect(ambiguous.message).toContain("不唯一");

      const captcha = await fillCommentReply(configDir, storeDir, {
        envId: created.id, platform: "toutiao", commentId: "1", text: "草稿甲",
      }, port, { probe: () => ({ captcha: true }) });
      expect(captcha.code).toBe("captcha");
      expect(captcha.message).toContain("验证码");
      expect(readCommentStore(storeDir).records[0].draftText).toBe("草稿甲");
      expect(readCommentStore(storeDir).records[0].replied).toBe(false);

      const failed = await fillCommentReply(configDir, storeDir, {
        envId: created.id, platform: "toutiao", commentId: "1", text: "草稿甲",
      }, port, { probe: () => ({ ok: true, value: "别的内容", n: 1 }) });
      expect(failed.code).toBe("fill_failed");
      expect(failed.message).toContain("草稿还留着");
      expect(readCommentStore(storeDir).records[0].draftText).toBe("草稿甲");
      expect(readCommentStore(storeDir).records[0].pendingReply).toBe("");
    } finally {
      rmSync(configDir, { recursive: true, force: true });
      rmSync(storeDir, { recursive: true, force: true });
    }
  });

  it("填框读回和下一次 GET 看不到回复时，都不标已回复", async () => {
    const configDir = mkdtempSync(join(tmpdir(), "studio-comment-get-"));
    const storeDir = mkdtempSync(join(tmpdir(), "studio-comment-get-store-"));
    try {
      const created = createEnv(configDir, { account: { type: "other", name: "第二环境" } });
      const other = createEnv(configDir, { account: { type: "other", name: "另一个" } });
      seed(storeDir, [
        linked(created.id, "toutiao", "1", { content: "写得好" }),
        linked(other.id, "toutiao", "1", { content: "写得好", pendingReply: "别环境的回复" }),
      ]);
      const filled = await fillCommentReply(configDir, storeDir, {
        envId: created.id, platform: "toutiao", commentId: "1", text: "已看到", content: "写得好",
      }, port, { probe: () => ({ ok: true, value: "已看到", readback: "已看到", n: 1 }) });
      expect(filled.code).toBe("filled_pending_get");
      expect(filled.replied).toBe(false);
      expect(filled.focusPlatform).toBe("toutiao");
      expect(filled.ok).toBe(false);
      const afterFill = readCommentStore(storeDir).records.find((item: CommentRecord) => item.envId === created.id);
      expect(afterFill.replied).toBe(false);
      expect(afterFill.pendingReply).toBe("已看到");

      ingestCommentGet(configDir, storeDir, created.id, "toutiao", [{
        commentId: "1", author: "甲", content: "已看到", title: "一篇", replies: [],
      }], port);
      expect(readCommentStore(storeDir).records.find((item: CommentRecord) => item.envId === created.id).replied).toBe(false);

      ingestCommentGet(configDir, storeDir, created.id, "toutiao", [{
        commentId: "1", author: "甲", content: "写得好", title: "一篇", replies: ["已看到"],
      }], port);
      const seen = readCommentStore(storeDir).records.find((item: CommentRecord) => item.envId === created.id);
      const untouched = readCommentStore(storeDir).records.find((item: CommentRecord) => item.envId === other.id);
      expect(seen.replied).toBe(true);
      expect(untouched.replied).toBe(false);
      expect(untouched.pendingReply).toBe("别环境的回复");
    } finally {
      rmSync(configDir, { recursive: true, force: true });
      rmSync(storeDir, { recursive: true, force: true });
    }
  });

  it("20 秒和每小时 30 条由执行层拦住，按钮层绕不过去", async () => {
    const configDir = mkdtempSync(join(tmpdir(), "studio-comment-rate-"));
    const storeDir = mkdtempSync(join(tmpdir(), "studio-comment-rate-store-"));
    try {
      const created = createEnv(configDir, { account: { type: "other", name: "第二环境" } });
      const now = 1_700_000_000_000;
      seed(storeDir, [linked(created.id, "toutiao", "1")], [{
        envId: created.id, platform: "toutiao", commentId: "1", text: "", stamps: [now - 1000],
      }]);
      let probed = 0;
      const gap = await fillCommentReply(configDir, storeDir, {
        envId: created.id, platform: "toutiao", commentId: "1", text: "再回一条",
      }, port, { now, probe: () => { probed += 1; return { ok: false, n: 0 }; } });
      expect(gap.code).toBe("rate_limit");
      expect(gap.message).toContain("20");
      expect(gap.message).toContain("后再试");
      expect(probed).toBe(0);

      seed(storeDir, [linked(created.id, "baijiahao", "2")], [{
        envId: created.id,
        platform: "baijiahao",
        commentId: "2",
        text: "",
        stamps: Array.from({ length: HOUR_CAP }, (_, index) => now - 60_000 - index * 1000),
      }]);
      const capped = await fillCommentReply(configDir, storeDir, {
        envId: created.id, platform: "baijiahao", commentId: "2", text: "太多了",
      }, port, { now, probe: () => { probed += 1; return { ok: false, n: 0 }; } });
      expect(capped.code).toBe("rate_limit");
      expect(capped.message).toContain("30");
      expect(capped.message).toMatch(/\d{2}:\d{2}:\d{2}/);
      expect(probed).toBe(0);
    } finally {
      rmSync(configDir, { recursive: true, force: true });
      rmSync(storeDir, { recursive: true, force: true });
    }
  });

  it("同一时间只能操作一个平台，缺环境不会改去默认登录", async () => {
    const configDir = mkdtempSync(join(tmpdir(), "studio-comment-lock-"));
    const storeDir = mkdtempSync(join(tmpdir(), "studio-comment-lock-store-"));
    try {
      const created = createEnv(configDir, { account: { type: "other", name: "第二环境" } });
      seed(storeDir, [
        linked(created.id, "toutiao", "1"),
        linked(created.id, "baijiahao", "2"),
      ]);
      let release: (value: unknown) => void = () => {};
      let secondProbe = 0;
      const first = fillCommentReply(configDir, storeDir, {
        envId: created.id, platform: "toutiao", commentId: "1", text: "先处理头条",
      }, port, { probe: () => new Promise((resolve) => { release = resolve; }) });
      const second = await fillCommentReply(configDir, storeDir, {
        envId: created.id, platform: "baijiahao", commentId: "2", text: "不要并行",
      }, port, { probe: () => { secondProbe += 1; return { ok: false, reason: "回复框未打开", n: 0 }; } });
      expect(second.code).toBe("busy_platform");
      expect(second.message).toContain("不能同时");
      expect(secondProbe).toBe(0);
      release({ ok: false, reason: "回复框未打开", n: 0 });
      await first;
      const third = await fillCommentReply(configDir, storeDir, {
        envId: created.id, platform: "baijiahao", commentId: "2", text: "现在可以",
      }, port, { probe: () => { secondProbe += 1; return { ok: false, reason: "回复框未打开", n: 0 }; } });
      expect(third.code).toBe("reply_box_closed");
      expect(secondProbe).toBe(1);

      let fallback = 0;
      const missing = await fillCommentReply(configDir, storeDir, {
        envId: "", platform: "toutiao", commentId: "1", text: "不该填",
      }, port, { probe: () => { fallback += 1; return { ok: true, value: "不该填", n: 1 }; } });
      const unknown = await fillCommentReply(configDir, storeDir, {
        envId: "default", platform: "toutiao", commentId: "1", text: "不该填",
      }, port, { probe: () => { fallback += 1; return { ok: true, value: "不该填", n: 1 }; } });
      expect(missing).toMatchObject({ ok: false, code: "missing_env" });
      expect(missing.message).toContain("不会改用默认登录");
      expect(unknown.code).toBe("unknown_env");
      expect(unknown.envId).toBe("default");
      expect(fallback).toBe(0);

      const foreign = await fillCommentReply(configDir, storeDir, {
        envId: created.id, platform: "toutiao", commentId: "缺的", text: "不该填",
      }, port, { probe: () => { fallback += 1; return { ok: true, value: "不该填", n: 1 }; } });
      expect(foreign.code).toBe("unlinked_or_missing");
      expect(fallback).toBe(0);
      const readonly = await fillOpenReply("dayu", "不要写", { envId: created.id, storeDir, commentId: "1", probe: () => { fallback += 1; return { ok: true, value: "不要写", n: 1 }; } });
      expect(readonly.code).toBe("readonly");
      expect(readonly.message).toContain("只读，回复未开");
      expect(fallback).toBe(0);
    } finally {
      rmSync(configDir, { recursive: true, force: true });
      rmSync(storeDir, { recursive: true, force: true });
    }
  });

  it("回复目标按环境和页面定位，填框脚本不点击发送", async () => {
    const envId = "env-a";
    const url = "https://mp.toutiao.com/profile_v4/manage/comment";
    expect(resolveReplyTab([], "toutiao", envId).code).toBe("reply_box_closed");
    expect(resolveReplyTab([{ id: "1", url, envId: "other" }], "toutiao", envId).code).toBe("env_mismatch");
    expect(resolveReplyTab([{ id: "1", url, envId }, { id: "2", url, envId }], "toutiao", envId).code).toBe("reply_target_ambiguous");
    expect(resolveReplyTab([{ id: "1", url, envId }, { id: "2", url, envId: "other" }], "toutiao", envId).ok).toBe(true);
    expect(resolveReplyTab([{ id: "1", url }], "toutiao", "").code).toBe("missing_env");
    const script = buildReplyFillScript("/manage/comment", "textarea", "你好", "写得好", "1");
    expect(script).toContain("验证码");
    expect(script).toContain("querySelectorAll");
    expect(script).not.toContain(".click(");
    expect(script).not.toContain("requestSubmit");
    const dir = mkdtempSync(join(tmpdir(), "studio-comment-tab-"));
    try {
      let executed = 0;
      const closed = await fillOpenReply("toutiao", "你好", {
        envId,
        storeDir: dir,
        commentId: "1",
        listTabs: async () => [],
        exec: () => { executed += 1; return null; },
      });
      expect(closed.code).toBe("reply_box_closed");
      expect(executed).toBe(0);
      const missing = await listCommentsForEnv("", { storeDir: dir, boards: [] });
      expect(missing.code).toBe("missing_env");
      expect(existsSync(join(dir, "comment-cache.json"))).toBe(false);
      const batch = await fillOpenReply("toutiao", "你好", { envId, storeDir: dir, batch: true, commentId: "1" });
      expect(batch.code).toBe("batch_rejected");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("评论页", () => {
  function comment(partial: Partial<CommentRecord> & { commentId: string; platform: string }): CommentRecord {
    return linked(partial.envId || "env-b", partial.platform, partial.commentId, partial);
  }

  function model() {
    return {
      envId: "env-b",
      envName: "第二环境",
      boards: [
        {
          platform: "toutiao",
          name: "头条",
          canReply: true,
          reason: "",
          comments: [
            comment({ platform: "toutiao", commentId: "open-1", author: "未回的人", content: "这篇写得真好", title: "标题甲", replied: false }),
            comment({ platform: "toutiao", commentId: "done-1", author: "已回的人", content: "早就回过", title: "标题乙", replied: true, createdAt: "2020-01-01 00:00" }),
          ],
        },
        {
          platform: "baijiahao",
          name: "百家",
          canReply: true,
          reason: "",
          comments: [comment({ platform: "baijiahao", commentId: "bj-1", author: "百家读者", content: "百家评论", title: "百家文" })],
        },
        {
          platform: "dayu",
          name: "大鱼",
          canReply: true,
          reason: "评论接口未实测",
          comments: [],
        },
        {
          platform: "sohu",
          name: "搜狐",
          canReply: true,
          reason: "",
          comments: [comment({ platform: "sohu", commentId: "sohu-1", author: "搜狐读者", content: "搜狐评论", title: "搜狐文" })],
        },
      ],
    };
  }

  it("三栏和小窗逐级详情", () => {
    expect(commentLayout(1200)).toBe("columns");
    expect(commentLayout(899)).toBe("drill");
    const css = readFileSync(join(process.cwd(), "src/renderer/studio/pages/comments.css"), "utf8");
    expect(css).toContain("minmax(0, 3fr) minmax(0, 5fr) minmax(0, 4fr)");
    expect(css).toContain("max-width: 900px");
    expect(css).toContain("overflow-x: clip");
    expect(css).toContain("overflow-wrap: anywhere");
    const wide = fakeDom.fakeEl("div");
    wide.setAttribute("data-viewport", "1200");
    const widePage = mount(wide as unknown as HTMLElement, model(), { fillReply: vi.fn() } as never);
    expect(wide.querySelector(".comments-page")?.getAttribute("data-columns")).toBe("3-5-4");
    expect(wide.querySelector(".comments-page")?.getAttribute("data-layout")).toBe("columns");
    expect(wide.querySelector(".comments-accounts")?.hidden).toBe(false);
    expect(wide.querySelector(".comments-list")?.hidden).toBe(false);
    expect(wide.querySelector(".comments-detail")?.hidden).toBe(false);
    widePage.destroy();

    const narrow = fakeDom.fakeEl("div");
    narrow.setAttribute("data-viewport", "800");
    const narrowPage = mount(narrow as unknown as HTMLElement, model(), { fillReply: vi.fn() } as never);
    expect(narrow.querySelector(".comments-page")?.getAttribute("data-layout")).toBe("drill");
    expect(narrow.querySelector(".comments-detail")?.hidden).toBe(true);
    expect(narrow.querySelector(".comments-list")?.hidden).toBe(false);
    narrow.querySelector("[data-comment-id=open-1]")?.click();
    expect(narrow.querySelector(".comments-detail")?.hidden).toBe(false);
    expect(narrow.querySelector(".comments-list")?.hidden).toBe(true);
    expect(narrow.querySelector(".comments-accounts")?.hidden).toBe(true);
    narrow.querySelector("[data-role=back-list]")?.click();
    expect(narrow.querySelector(".comments-detail")?.hidden).toBe(true);
    expect(narrow.querySelector(".comments-list")?.hidden).toBe(false);
    narrowPage.destroy();
  });

  it("默认只看未回复，探针未通的平台不显示成空列表", () => {
    const host = fakeDom.fakeEl("div");
    host.setAttribute("data-viewport", "1200");
    const page = mount(host as unknown as HTMLElement, model(), { fillReply: vi.fn() } as never);
    const list = host.querySelector("[data-role=list-body]");
    expect(list?.textContent).toContain("未回的人");
    expect(list?.textContent).toContain("百家读者");
    expect(list?.textContent).not.toContain("已回的人");
    expect(host.textContent).toContain("当前环境 第二环境");
    host.querySelector("[data-role=filter-scope]") && (host.querySelector("[data-role=filter-scope]")!.value = "all");
    host.querySelector("[data-role=filter-scope]")?.dispatchEvent({ type: "change" });
    expect(host.querySelector("[data-role=list-body]")?.textContent).toContain("已回的人");
    host.querySelector("[data-platform=dayu]")?.click();
    const blocked = host.querySelector("[data-role=list-body]");
    expect(blocked?.getAttribute("data-state")).toBe("unsupported");
    expect(blocked?.textContent).toContain("评论接口未实测");
    expect(blocked?.textContent).not.toContain("还没有评论");
    expect(host.querySelector("[data-platform=dayu]")?.textContent).toContain("—");
    page.destroy();
    expect(filterCommentRows([
      { platform: "toutiao", commentId: "1", author: "甲", content: "现在", title: "题", articleId: "1", createdAt: "2026-11-12 10:00", replied: false },
      { platform: "toutiao", commentId: "2", author: "乙", content: "早", title: "题", articleId: "1", createdAt: "2026-01-01 00:00", replied: false },
    ], { scope: "open", platform: "toutiao", content: "现在", time: "24h" }, Date.parse("2026-11-12T12:00:00"))).toEqual([
      expect.objectContaining({ commentId: "1" }),
    ]);
    expect(unrepliedCount({ reason: "评论接口未实测", comments: [] })).toBeNull();
    expect(accountDataStatus({ reason: "登录态缺失", comments: [] })).toBe("login_missing");
    expect(accountDataStatus({ reason: "列表为空", comments: [] })).toBe("empty");
  });

  it("头条百家可以填框，大鱼搜狐只读，没有发送按钮", async () => {
    const host = fakeDom.fakeEl("div");
    host.setAttribute("data-viewport", "1200");
    let seen: { envId?: string; platform?: string; commentId?: string; text?: string } = {};
    const page = mount(host as unknown as HTMLElement, model(), {
      fillReply: vi.fn(async (input: { envId: string; platform: string; commentId: string; text: string }) => {
        seen = input;
        return { ok: true, code: "filled_pending_get", message: "已经填进回复框，不会标成已回复。", envId: input.envId, filled: true };
      }),
    } as never);
    host.querySelector("[data-comment-id=open-1]")?.click();
    const box = host.querySelector("[data-role=reply-draft]");
    if (box) box.value = "草稿甲";
    host.querySelector("[data-role=fill-reply]")?.click();
    await vi.waitFor(() => expect(seen.envId).toBe("env-b"));
    expect(seen).toMatchObject({ platform: "toutiao", commentId: "open-1", text: "草稿甲" });
    expect(host.querySelector("[data-comment-id=open-1]")?.getAttribute("data-replied")).toBe("false");
    expect(box?.value).toBe("草稿甲");
    const labels = host.querySelectorAll("button").map((node) => node.textContent);
    expect(labels).toContain("填入平台回复框");
    expect(labels).not.toContain("发送");
    expect(labels).not.toContain("我已发送");
    host.querySelector("[data-comment-id=sohu-1]")?.click();
    expect(host.querySelector("[data-role=detail-body]")?.textContent).toContain("只读，回复未开");
    expect(host.querySelector("[data-role=fill-reply]")).toBeNull();
    host.querySelector("[data-comment-id=bj-1]")?.click();
    expect(host.querySelector("[data-role=fill-reply]")?.textContent).toBe("填入平台回复框");
    page.destroy();
  });

  it("填写失败保留草稿，卸载后不再接收异步结果", async () => {
    const host = fakeDom.fakeEl("div");
    host.setAttribute("data-viewport", "1200");
    let release: (value: { ok: boolean; code: string; message: string; envId: string }) => void = () => {};
    let calls = 0;
    const page = mount(host as unknown as HTMLElement, model(), {
      fillReply: () => {
        calls += 1;
        return new Promise((resolve) => { release = resolve; });
      },
    } as never);
    host.querySelector("[data-comment-id=open-1]")?.click();
    const box = host.querySelector("[data-role=reply-draft]");
    const note = host.querySelector("[data-role=reply-status]");
    if (box) box.value = "草稿甲";
    host.querySelector("[data-role=fill-reply]")?.click();
    release({ ok: false, code: "fill_failed", message: "没有写进回复框，草稿还留着。", envId: "env-b" });
    await vi.waitFor(() => expect(note?.textContent).toContain("草稿还留着"));
    expect(box?.value).toBe("草稿甲");
    expect(host.querySelector(".comments-full")?.className).toContain("comments-full");
    const root = host.querySelector(".comments-page");
    expect(root?.listenerCount("click")).toBe(1);
    host.querySelector("[data-role=fill-reply]")?.click();
    expect(calls).toBe(2);
    page.destroy();
    expect(root?.listenerCount("click")).toBe(0);
    expect(root?.listenerCount("input")).toBe(0);
    expect(root?.listenerCount("change")).toBe(0);
    release({ ok: true, code: "filled_pending_get", message: "晚到的结果", envId: "env-b" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(note?.textContent).not.toContain("晚到");
    expect(note?.textContent).toContain("草稿还留着");
    expect(box?.value).toBe("草稿甲");
  });

  it("加载、空、错误、登录失效和未支持各有各的样子", () => {
    const states = [
      { model: { status: "loading" as const }, text: "正在读取评论" },
      { model: { status: "empty" as const, reason: "这个环境还没有评论" }, text: "这个环境还没有评论" },
      { model: { status: "error" as const, message: "评论回包不是 JSON" }, text: "评论回包不是 JSON" },
      { model: { status: "login_missing" as const, message: "登录态缺失" }, text: "登录态缺失" },
      { model: { status: "unsupported" as const, message: "评论接口未实测" }, text: "评论接口未实测" },
    ];
    const seen = new Set<string>();
    for (const item of states) {
      const host = fakeDom.fakeEl("div");
      const page = mount(host as unknown as HTMLElement, item.model, { fillReply: vi.fn() } as never);
      const screen = host.querySelector("[data-screen]");
      expect(screen?.getAttribute("data-state")).toBe(item.model.status);
      expect(screen?.textContent).toContain(item.text);
      seen.add(item.model.status + ":" + item.text);
      page.destroy();
    }
    expect(seen.size).toBe(5);
    const blank = fakeDom.fakeEl("div");
    const blocked = mount(blank as unknown as HTMLElement, {
      envId: "",
      boards: [{ platform: "toutiao", name: "头条", canReply: true, reason: "", comments: [comment({ platform: "toutiao", commentId: "1", author: "不该出现" })] }],
    }, { fillReply: vi.fn() } as never);
    expect(blank.textContent).toContain("不会改用默认登录");
    expect(blank.textContent).not.toContain("不该出现");
    blocked.destroy();
    const source = readFileSync(join(process.cwd(), "src/renderer/studio/pages/comments.ts"), "utf8");
    expect(source).not.toContain("electron");
    expect(source).not.toContain("我已发送");
    expect(source).not.toContain("WebSocket");
  });
});
