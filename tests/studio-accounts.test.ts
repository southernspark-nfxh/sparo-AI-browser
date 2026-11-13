import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  accountStatusLabel,
  applyAccountObservation,
  blankAccounts,
  normalizeAccountState,
  openBackstage,
  readAccountBook,
  shownAccountState,
  writeAccountBook,
} from "../src/main/studio-accounts.js";
import { api } from "../src/renderer/studio/api.js";
import { mount, type AccountsViewModel } from "../src/renderer/studio/pages/accounts.js";
import type { PageActions, StudioError } from "../src/renderer/studio/types.js";

const SHOP_B = "shop-b";

describe("账号状态", () => {
  it("unknown 不会变成正常，一个平台失效不影响另一个", () => {
    expect(normalizeAccountState("unknown")).toBe("unknown");
    expect(normalizeAccountState("normal")).toBe("unknown");
    expect(normalizeAccountState("ok")).toBe("ok");
    expect(shownAccountState("ok", "")).toBe("unknown");
    expect(accountStatusLabel("unknown")).toBe("未核验");
    expect(accountStatusLabel("ok")).toBe("正常");
    const rows = blankAccounts(SHOP_B);
    const toutiao = applyAccountObservation(rows, SHOP_B, {
      platform: "toutiao",
      state: "login_missing",
      displayName: "账号乙",
      checkedAt: "2026-11-13T02:00:00.000Z",
      cookie: "session=secret",
      token: "secret-token",
    });
    expect(toutiao.ok).toBe(true);
    if (!toutiao.ok) return;
    const baijia = toutiao.rows.find((row) => row.platform === "baijiahao");
    const headline = toutiao.rows.find((row) => row.platform === "toutiao");
    expect(baijia?.state).toBe("unknown");
    expect(accountStatusLabel(baijia?.state || "unknown")).not.toBe("正常");
    expect(headline?.state).toBe("login_missing");
    expect(headline?.displayName).toBe("账号乙");
    const forged = applyAccountObservation(toutiao.rows, SHOP_B, {
      platform: "sohu",
      state: "ok",
      displayName: "token=secret-token",
      checkedAt: "",
    });
    expect(forged.ok).toBe(true);
    if (!forged.ok) return;
    expect(forged.rows.find((row) => row.platform === "sohu")).toMatchObject({ state: "unknown", displayName: "未识别" });
    expect(forged.rows.find((row) => row.platform === "baijiahao")?.state).toBe("unknown");
  });

  it("非默认环境的账号簿不串号，文件里没有 token", () => {
    const dir = mkdtempSync(join(tmpdir(), "studio-accounts-"));
    const file = join(dir, "accounts.json");
    const observed = applyAccountObservation(blankAccounts(SHOP_B), SHOP_B, {
      platform: "baijiahao",
      state: "ok",
      displayName: "账号乙",
      checkedAt: "2026-11-13T02:20:00.000Z",
      token: "secret-token",
      cookie: "session=secret",
    });
    expect(observed.ok).toBe(true);
    if (!observed.ok) return;
    expect(writeAccountBook(file, SHOP_B, observed.rows)).toMatchObject({ ok: true, envId: SHOP_B });
    const text = readFileSync(file, "utf8");
    expect(text).not.toContain("secret-token");
    expect(text).not.toContain("session=secret");
    expect(readAccountBook(file, "shop-a")).toMatchObject({ ok: false, code: "env_mismatch", envId: "shop-a" });
    const loaded = readAccountBook(file, SHOP_B);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.rows.find((row) => row.platform === "baijiahao")?.state).toBe("ok");
    expect(loaded.rows.find((row) => row.platform === "toutiao")?.state).toBe("unknown");
    const missing = readAccountBook(file, " ");
    expect(missing).toMatchObject({ ok: false, code: "missing_env", envId: "" });
    expect(missing.ok ? "" : missing.message).toContain("不会改用默认登录");
  });

  it("打开后台使用当前环境的分区，不复用同一标签", () => {
    const opened = openBackstage(SHOP_B, "baijiahao");
    expect(opened).toMatchObject({
      ok: true,
      envId: SHOP_B,
      platform: "baijiahao",
      partition: "persist:env_shop-b",
      reuseTab: false,
    });
    if (!opened.ok) return;
    expect(opened.url).toContain("baijiahao.baidu.com");
    expect(opened.partition).not.toBe(openBackstage("shop-a", "baijiahao").ok ? "persist:env_shop-a" : "");
    const other = openBackstage("shop-a", "toutiao");
    expect(other.ok && other.partition).toBe("persist:env_shop-a");
    const missing = openBackstage("", "toutiao");
    expect(missing).toMatchObject({ ok: false, code: "missing_env", envId: "" });
    expect(JSON.stringify(missing)).not.toContain("mp.toutiao.com");
  });
});

describe("账号页", () => {
  it("专用 API 只调用打开账号设置桥，不传面板或脚本", async () => {
    const host = globalThis as { sparkStudio?: { openAccountSettings?: (...args: unknown[]) => Promise<unknown> } };
    const previous = host.sparkStudio;
    const calls: unknown[][] = [];
    host.sparkStudio = {
      openAccountSettings: async (...args: unknown[]) => {
        calls.push(args);
        return { ok: true, code: "ok", message: "" };
      },
    };
    try {
      expect(typeof api.openAccountSettings).toBe("function");
      const result = await api.openAccountSettings();
      expect(result).toMatchObject({ ok: true, code: "ok" });
      expect(calls).toEqual([[]]);
    } finally {
      if (previous) host.sparkStudio = previous;
      else delete host.sparkStudio;
    }
  });

  it("未核验不显示正常，核验和打开都带着当前环境", async () => {
    installDom();
    const opened: Array<{ envId: string; platform: string }> = [];
    const checked: string[][] = [];
    const actions = accountActions({
      async openAccount(input) {
        opened.push(input);
        return { ok: true, code: "ok", message: "", envId: input.envId } as unknown as StudioError;
      },
      async checkAccounts(input) {
        checked.push(input.platforms);
        return { ok: false, code: "unsupported", message: "登录态未核验", envId: input.envId };
      },
    });
    const container = document.createElement("div");
    const page = mount(container, accountModel(), actions);
    const toutiao = container.querySelector('[data-platform="toutiao"]')?.textContent || "";
    expect(toutiao).toContain("未核验");
    expect(toutiao).not.toContain("正常");
    expect(container.querySelector('[data-platform="baijiahao"]')?.textContent).toContain("登录失效");
    expect(container.querySelector('[data-platform="sohu"]')?.getAttribute("data-state")).toBe("unknown");
    expect(container.getAttribute("data-env")).toBe(SHOP_B);
    click(container, '[data-platform="baijiahao"][data-action="relogin"]');
    click(container, '[data-platform="toutiao"][data-action="recheck"]');
    await Promise.resolve();
    expect(opened).toEqual([{ envId: SHOP_B, platform: "baijiahao" }]);
    expect(checked).toEqual([["toutiao"]]);
    expect(container.querySelector('[data-platform="toutiao"]')?.textContent).toContain("未核验");
    expect(opened).toHaveLength(1);
    page.destroy();
    click(container, '[data-platform="baijiahao"][data-action="relogin"]');
    expect(opened).toHaveLength(1);
    expect(listenerCount(container, "click")).toBe(0);
  });

  it("管理账号环境通过专用动作打开设置账号页", () => {
    installDom();
    let settingsOpened = 0;
    const opened: Array<{ envId: string; platform: string }> = [];
    const actions = accountActions({
      async openAccountSettings() {
        settingsOpened += 1;
        return { ok: true, code: "ok", message: "", envId: SHOP_B } as unknown as StudioError;
      },
      async openAccount(input) {
        opened.push(input);
        return { ok: false, code: "unsupported", message: "", envId: input.envId };
      },
    });
    const container = document.createElement("div");
    const page = mount(container, accountModel(), actions);
    click(container, '[data-action="manage-envs"]');
    expect(settingsOpened).toBe(1);
    expect(opened).toEqual([]);
    page.destroy();
  });

  it("没有环境时停止打开后台，但仍可去设置新建环境", () => {
    installDom();
    const opened: string[] = [];
    let settingsOpened = 0;
    const actions = accountActions({
      async openAccount(input) {
        opened.push(input.envId);
        return { ok: false, code: "missing_env", message: "", envId: "" };
      },
      async openAccountSettings() {
        settingsOpened += 1;
        return { ok: true, code: "ok", message: "", envId: "" } as unknown as StudioError;
      },
    });
    const container = document.createElement("div");
    mount(container, { ...accountModel(), envId: " " }, actions);
    expect(container.textContent).toContain("不会改用默认登录");
    expect(container.querySelector("[data-action=open-account]")).toBeNull();
    click(container, '[data-action="manage-envs"]');
    expect(settingsOpened).toBe(1);
    expect(opened).toEqual([]);
  });
});

function accountModel(): AccountsViewModel {
  return {
    envId: SHOP_B,
    envName: "店铺乙",
    rows: [
      { platform: "toutiao", platformName: "头条", displayName: "", state: "unknown", checkedAt: "" },
      { platform: "baijiahao", platformName: "百家", displayName: "账号乙", state: "login_missing", checkedAt: "2026-11-12T02:00:00.000Z" },
      { platform: "sohu", platformName: "搜狐", displayName: "账号丁", state: "ok", checkedAt: "" },
    ],
  };
}

function accountActions(over: Partial<PageActions> = {}): PageActions {
  const error = (envId = SHOP_B): StudioError => ({ ok: false, code: "unsupported", message: "尚未接入", envId });
  return {
    navigate: () => undefined,
    reload: async () => undefined,
    saveDraft: async () => error(),
    precheck: async () => error(),
    confirm: async () => error(),
    pickImages: async () => error(),
    checkAccounts: async () => error(),
    openAccount: async () => error(),
    openAccountSettings: async () => error(),
    refreshMetrics: async () => error(),
    openTask: async () => error(),
    verifyTask: async () => error(),
    resumeTask: async () => error(),
    fillReply: async () => error(),
    onTasksChanged: () => () => undefined,
    ...over,
  };
}

class DomNode {
  tag: string;
  children: DomNode[] = [];
  parent: DomNode | null = null;
  className = "";
  text = "";
  attrs: Record<string, string> = {};
  type = "";
  title = "";
  private listeners = new Map<string, Set<(event: Event) => void>>();

  constructor(tag: string) {
    this.tag = tag;
  }

  set textContent(value: string | null) {
    this.text = value || "";
    this.children = [];
  }

  get textContent(): string {
    if (this.children.length) return this.children.map((child) => child.textContent).join("");
    return this.text;
  }

  append(...nodes: Array<DomNode | string>): void {
    for (const node of nodes) {
      const child = typeof node === "string" ? new DomNode("#text") : node;
      if (typeof node === "string") child.textContent = node;
      child.parent = this;
      this.children.push(child);
    }
  }

  replaceChildren(...nodes: DomNode[]): void {
    for (const child of this.children) child.parent = null;
    this.children = [];
    this.append(...nodes);
  }

  setAttribute(name: string, value: string): void {
    this.attrs[name] = value;
    if (name === "title") this.title = value;
  }

  getAttribute(name: string): string | null {
    return this.attrs[name] ?? null;
  }

  addEventListener(type: string, fn: (event: Event) => void): void {
    const set = this.listeners.get(type) || new Set<(event: Event) => void>();
    set.add(fn);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, fn: (event: Event) => void): void {
    this.listeners.get(type)?.delete(fn);
  }

  listenerCount(type: string): number {
    return this.listeners.get(type)?.size || 0;
  }

  dispatchEvent(event: Event): boolean {
    this.emit(event.type);
    return true;
  }

  private emit(type: string, target: DomNode = this): void {
    const event = { type, target } as unknown as Event;
    for (const fn of this.listeners.get(type) || []) fn(event);
    this.parent?.emit(type, target);
  }

  querySelector(selector: string): DomNode | null {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector: string): DomNode[] {
    const out: DomNode[] = [];
    const walk = (node: DomNode) => {
      for (const child of node.children) {
        if (selectorMatches(child, selector)) out.push(child);
        walk(child);
      }
    };
    walk(this);
    return out;
  }

  get parentElement(): DomNode | null {
    return this.parent;
  }
}

function selectorMatches(node: DomNode, selector: string): boolean {
  const re = /\[([^\]]+)\]|\.([^.\[#]+)|([a-zA-Z0-9_-]+)/g;
  let saw = false;
  let match: RegExpExecArray | null;
  while ((match = re.exec(selector))) {
    saw = true;
    if (match[1]) {
      const body = match[1];
      const eq = body.indexOf("=");
      if (eq === -1) {
        if (node.getAttribute(body) == null) return false;
      } else if (node.getAttribute(body.slice(0, eq)) !== body.slice(eq + 1).trim().replace(/^["']|["']$/g, "")) return false;
    } else if (match[2]) {
      if (!node.className.split(/\s+/).includes(match[2])) return false;
    } else if (match[3] && node.tag !== match[3]) return false;
  }
  return saw;
}

function installDom(): void {
  Object.assign(globalThis, {
    document: { createElement: (tag: string) => new DomNode(tag) },
  });
}

function click(container: HTMLElement, selector: string): void {
  (container.querySelector(selector) as HTMLElement | null)?.dispatchEvent(new Event("click"));
}

function listenerCount(container: HTMLElement, type: string): number {
  return (container as unknown as DomNode).listenerCount(type);
}
