/**
 * 工作台启动、路由和环境切换。
 * 页面文件位置已登记；T1–T4 接入前，已有能力留在这里，未接线的页面只显示空态。
 */
import { api, type LegacyBoard, type LegacyMetrics, type StudioLoad } from "./studio/api.js";
import { clear, el, field, icon, on } from "./studio/dom.js";
import { PAGE_MODULES, type DraftInput, type PageActions, type PageMount, type StudioViewId } from "./studio/types.js";

export { PAGE_MODULES };

const NAV: Array<{ id: StudioViewId; label: string; icon: "home" | "compose" | "metrics" | "comments" | "accounts" }> = [
  { id: "home", label: "工作台", icon: "home" },
  { id: "compose", label: "发稿", icon: "compose" },
  { id: "metrics", label: "数据", icon: "metrics" },
  { id: "comments", label: "评论", icon: "comments" },
  { id: "accounts", label: "账号", icon: "accounts" },
];

const NAMES: Record<string, string> = { toutiao: "头条", baijiahao: "百家", dayu: "大鱼", sohu: "搜狐" };
const PLATFORMS = Object.keys(NAMES);
const ENV_KEY = "sparo-studio-env";

type ReadyLoad = Extract<StudioLoad, { ok: true }>;

let envId = "";
let preferDraftId = "";
let view: StudioViewId = "home";
let data: ReadyLoad | null = null;
let current: { destroy: () => void } | null = null;
let actions: PageActions;

function emptyPage(title: string, reason: string): PageMount<{ title: string; reason: string }> {
  return (container, model) => {
    const stops: Array<() => void> = [];
    clear(container);
    const head = el("div", "page-head");
    head.append(el("h1", "", model.title || title), el("p", "muted", model.reason || reason));
    container.append(head);
    stops.push(() => clear(container));
    return {
      destroy() {
        for (const stop of stops.splice(0)) stop();
      },
    };
  };
}

const mountAccounts = emptyPage("账号", "账号核验尚未接入。新建和删除环境仍在设置里的账号页，这里不会切换登录态。");
const mountTasks = emptyPage("发布记录", "发布记录页面尚未接入。这里不会创建发布批次，也不会代为发布。");

function mountHome(container: HTMLElement, model: ReadyLoad): { destroy: () => void } {
  clear(container);
  const head = el("div", "page-head");
  head.append(el("h1", "", "工作台"), el("p", "muted", "当前环境：" + (model.name || model.envId)));
  const grid = el("div", "grid");
  const pending = el("div", "card span-4");
  pending.append(el("h2", "", "待发"), el("div", "kpi", String(model.overview.pending)));
  const failed = el("div", "card span-4");
  failed.append(el("h2", "", "失败"), el("div", "kpi", String(model.overview.failed)));
  const login = el("div", "card span-4");
  login.append(el("h2", "", "登录"), el("p", "", model.overview.login || "未检查"));
  grid.append(pending, failed, login);
  container.append(head, grid);
  return { destroy: () => clear(container) };
}

function readDraft(root: HTMLElement, draft: DraftInput): DraftInput {
  const next: DraftInput = { ...draft, platforms: {}, images: [], schedule: {} };
  const value = (id: string) => (root.querySelector("#" + id) as HTMLInputElement | HTMLTextAreaElement).value;
  next.title = value("title");
  next.summary = value("summary");
  next.body = value("body");
  next.cover = value("cover").trim();
  next.images = value("images").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  next.primaryPlatform = value("primary");
  root.querySelectorAll<HTMLInputElement>("[data-platform]").forEach((input) => {
    next.platforms[input.dataset.platform || ""] = { enabled: input.checked };
  });
  return next;
}

function mountCompose(container: HTMLElement, model: ReadyLoad, pageActions: PageActions): { destroy: () => void } {
  const stops: Array<() => void> = [];
  let timer = 0;
  clear(container);
  let draft = model.drafts.find((item) => item.id === preferDraftId) || model.draft;
  preferDraftId = "";
  let precheckId = "";
  const head = el("div", "page-head");
  head.append(el("h1", "", "发稿"), el("p", "muted", "写稿不要求登录。确认只记下检查结果，不会向平台写稿。"));
  const saveNote = el("p", "muted", "");
  const form = el("div", "card stack");
  const list = el("select");
  list.id = "draftList";
  list.setAttribute("aria-label", "已有草稿");
  const title = el("input");
  title.id = "title";
  const summary = el("input");
  summary.id = "summary";
  const body = el("textarea");
  body.id = "body";
  const cover = el("input");
  cover.id = "cover";
  cover.placeholder = "本地路径";
  const images = el("textarea");
  images.id = "images";
  const primary = el("select");
  primary.id = "primary";
  for (const id of PLATFORMS) primary.append(new Option(NAMES[id], id));
  const checks = el("div", "checks");
  form.append(
    field("已有草稿", list),
    field("标题", title),
    field("摘要", summary),
    field("正文", body),
    field("封面文件", cover),
    field("正文图片，一行一个路径", images),
    field("首发平台", primary),
    checks,
    saveNote,
  );
  const sheet = el("div", "stack");
  const precheck = el("button", "btn ghost", "预检");
  precheck.type = "button";
  precheck.title = "预检";
  const confirm = el("button", "btn primary", "确认发布");
  confirm.type = "button";
  confirm.title = "确认发布";
  confirm.hidden = true;
  const note = el("p", "", "");
  const ledgerHost = el("div", "table-wrap");
  const tools = el("div", "card stack");
  tools.append(el("h2", "", "预检"), precheck, sheet, confirm, note, el("h2", "", "已有台账"), ledgerHost);

  function paintChecks() {
    clear(checks);
    for (const id of PLATFORMS) {
      const label = el("label");
      const input = el("input");
      input.type = "checkbox";
      input.dataset.platform = id;
      input.checked = draft.platforms?.[id]?.enabled !== false;
      label.append(input, document.createTextNode(NAMES[id]));
      checks.append(label);
      stops.push(on(input, "change", () => scheduleSave()));
    }
  }

  function paintDraft() {
    title.value = draft.title || "";
    summary.value = draft.summary || "";
    body.value = draft.body || "";
    cover.value = draft.cover || "";
    images.value = (draft.images || []).join("\n");
    primary.value = draft.primaryPlatform || "toutiao";
    paintChecks();
    clear(list);
    for (const item of model.drafts) list.append(new Option(item.title || item.id, item.id));
    list.value = draft.id;
  }

  function paintLedger() {
    clear(ledgerHost);
    if (!model.ledger.length) {
      ledgerHost.append(el("p", "secondary", "还没有台账"));
      return;
    }
    const table = el("table");
    const row = el("tr");
    for (const name of ["平台", "标题", "状态", "原因"]) row.append(el("th", "", name));
    table.append(row);
    for (const item of model.ledger) {
      const tr = el("tr");
      const cells = [NAMES[item.platform || ""] || item.platform || "", item.title || "", item.ok ? "成功" : "失败", item.reason || item.hint || ""];
      for (const text of cells) tr.append(el("td", "", text));
      table.append(tr);
    }
    ledgerHost.append(table);
  }

  function invalidate() {
    precheckId = "";
    confirm.hidden = true;
    clear(sheet);
  }

  async function saveNow() {
    draft = readDraft(form, draft);
    saveNote.textContent = "保存中";
    const saved = await pageActions.saveDraft({ envId: model.envId, draft, revision: 0 });
    if (!saved.ok) {
      saveNote.textContent = saved.message || "保存失败";
      return;
    }
    draft = saved.draft;
    saveNote.textContent = "已自动保存";
  }

  function scheduleSave() {
    invalidate();
    clearTimeout(timer);
    timer = window.setTimeout(() => { void saveNow(); }, 400);
  }

  paintDraft();
  paintLedger();
  for (const node of [title, summary, body, cover, images]) stops.push(on(node, "input", () => scheduleSave()));
  stops.push(on(primary, "change", () => scheduleSave()));
  stops.push(on(list, "change", () => {
    const found = model.drafts.find((item) => item.id === list.value);
    if (!found) return;
    draft = found;
    invalidate();
    paintDraft();
  }));
  stops.push(on(precheck, "click", () => {
    void (async () => {
      await saveNow();
      const result = await pageActions.precheck({ envId: model.envId, draft, revision: 0 });
      clear(sheet);
      if (!result.ok) {
        note.textContent = result.message;
        confirm.hidden = true;
        return;
      }
      precheckId = result.precheckId;
      for (const row of result.rows) {
        const card = el("div", "card");
        card.append(el("p", "", row.name + "  " + (row.skip ? "已跳过" : "默认发布") + "  " + row.marks.join("  ")));
        const tag = el("span", "tag", row.level === "warn" ? "需要注意" : "可以发布");
        tag.dataset.state = row.level === "warn" ? "partial" : "ok";
        card.append(tag);
        sheet.append(card);
      }
      confirm.hidden = false;
      note.textContent = "环境 " + result.envId + " · 修订 " + String(result.draftRevision);
    })();
  }));
  stops.push(on(confirm, "click", () => {
    void (async () => {
      if (!precheckId) {
        note.textContent = "请先预检。";
        return;
      }
      const result = await pageActions.confirm({
        envId: model.envId,
        precheckId,
        confirmationId: globalThis.crypto.randomUUID(),
      });
      note.textContent = result.message || "";
    })();
  }));
  container.append(head, form, tools);
  return {
    destroy() {
      clearTimeout(timer);
      for (const stop of stops.splice(0)) stop();
      clear(container);
    },
  };
}

function metricText(value: number | null | undefined): string {
  return value == null ? "" : String(value);
}

function mountMetrics(container: HTMLElement, model: ReadyLoad, pageActions: PageActions): { destroy: () => void } {
  const stops: Array<() => void> = [];
  const host = el("div", "stack");
  function paint(metrics: LegacyMetrics) {
    clear(host);
    if (!metrics) {
      host.append(el("p", "", "还没有快照"));
      return;
    }
    host.append(el("div", "card", "总览卡：阅读 " + metrics.overview.reads + "；净增 " + metrics.overview.follows + "；收益 " + metrics.overview.revenue));
    for (const row of metrics.compare || []) {
      const money = (metrics.revenueSplit || []).find((item) => item.platform === row.platform);
      const moneyText = !money?.text ? "" : money.text.startsWith("¥") ? money.text.slice(1) + " 元" : money.text;
      const card = el("div", "card stack");
      card.append(el("p", "", [
        NAMES[row.platform || ""] || row.platform || "",
        "阅读 " + metricText(row.reads),
        "点赞 " + metricText(row.likes),
        "收益 " + moneyText,
      ].filter((part) => part.trim()).join("  ")));
      if (row.completeness) {
        const tag = el("span", "tag", row.completeness);
        const state = row.completeness === "完整" ? "ok" : row.completeness === "平台未提供" ? "unsupported" : row.completeness === "数据缺失" ? "missing" : "partial";
        tag.dataset.state = state;
        card.append(tag);
      }
      host.append(card);
    }
    const titles = (metrics.ranking || []).map((item) => item.title || "").filter(Boolean);
    host.append(el("div", "card", "内容榜：" + (titles.join("、") || "无单篇")));
    host.append(el("div", "card", "异常：" + ((metrics.overview.exceptions || []).join("；") || "无")));
    if (metrics.capturedAt) host.append(el("p", "muted", metrics.capturedAt));
  }
  clear(container);
  const head = el("div", "page-head");
  const refresh = el("button", "btn ghost", "刷新");
  refresh.type = "button";
  refresh.title = "刷新数据";
  refresh.setAttribute("aria-label", "刷新数据");
  head.append(el("h1", "", "数据"), refresh);
  paint(model.metrics);
  if (model.readError) host.prepend(el("p", "", model.readError));
  stops.push(on(refresh, "click", () => {
    void (async () => {
      refresh.setAttribute("aria-busy", "true");
      const next = await pageActions.refreshMetrics(model.envId);
      refresh.removeAttribute("aria-busy");
      if (!next.ok) {
        host.prepend(el("p", "", next.message));
        return;
      }
      await pageActions.reload(model.envId);
    })();
  }));
  container.append(head, host);
  return {
    destroy() {
      for (const stop of stops.splice(0)) stop();
      clear(container);
    },
  };
}

function mountComments(container: HTMLElement, model: ReadyLoad, pageActions: PageActions): { destroy: () => void } {
  const stops: Array<() => void> = [];
  clear(container);
  const head = el("div", "page-head");
  head.append(el("h1", "", "评论"), el("p", "muted", "只填已打开的回复框。没有发送按钮。"));
  const host = el("div", "stack");
  const boards: LegacyBoard[] = model.comments || [];
  if (!boards.length) host.append(el("p", "", "还没有评论"));
  for (const board of boards) {
    const card = el("div", "card stack");
    card.append(el("h2", "", (board.name || board.platform || "") + (board.reason ? "：" + board.reason : "")));
    if (!board.canReply) {
      const locked = el("button", "btn ghost", "只读，回复未开");
      locked.type = "button";
      locked.disabled = true;
      locked.title = board.reason || "只读，回复未开";
      card.append(locked);
      host.append(card);
      continue;
    }
    for (const item of board.comments || []) {
      const row = el("div", "card comment stack");
      row.append(el("p", "", [item.author, item.content, item.title, item.createdAt].filter(Boolean).join("  ·  ")));
      const box = el("textarea", "reply-box");
      box.placeholder = "这条评论的回复草稿";
      const go = el("button", "btn ghost", "回复");
      go.type = "button";
      go.title = "填入回复框";
      const replyNote = el("p", "muted", "");
      stops.push(on(go, "click", () => {
        void (async () => {
          const result = await pageActions.fillReply({
            envId: model.envId,
            platform: board.platform || "",
            text: box.value,
            commentId: item.commentId || "",
            content: item.content || "",
          });
          replyNote.textContent = result.message || "";
        })();
      }));
      row.append(box, go, replyNote);
      card.append(row);
    }
    host.append(card);
  }
  container.append(head, host);
  return {
    destroy() {
      for (const stop of stops.splice(0)) stop();
      clear(container);
    },
  };
}

function showGate(message: string): void {
  const page = document.getElementById("page");
  if (!page) return;
  current?.destroy();
  clear(page);
  page.append(el("h1", "", "媒体工作台"), el("p", "", message));
  current = { destroy: () => clear(page) };
}

function paintNav(): void {
  document.querySelectorAll<HTMLButtonElement>(".nav-btn").forEach((button) => {
    if (button.dataset.view === view) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
}

function mountCurrent(): void {
  const page = document.getElementById("page");
  if (!page || !data) return;
  current?.destroy();
  const stopTasks = actions.onTasksChanged(data.envId, () => {});
  const pageHandle =
    view === "home" ? mountHome(page, data) :
    view === "compose" ? mountCompose(page, data, actions) :
    view === "metrics" ? mountMetrics(page, data, actions) :
    view === "comments" ? mountComments(page, data, actions) :
    view === "accounts" ? mountAccounts(page, { title: "账号", reason: "账号核验尚未接入。新建和删除环境仍在设置里的账号页，这里不会切换登录态。" }, actions) :
    mountTasks(page, { title: "发布记录", reason: "发布记录页面尚未接入。这里不会创建发布批次，也不会代为发布。" }, actions);
  current = {
    destroy() {
      stopTasks();
      pageHandle.destroy();
    },
  };
  paintNav();
}

async function reload(nextEnv = envId): Promise<void> {
  envId = nextEnv;
  if (!envId) {
    data = null;
    showGate("还没有选择账号环境，已停止。不会改用默认登录。");
    return;
  }
  const result = await api.load(envId);
  if (!result.ok) {
    data = null;
    showGate(result.message);
    return;
  }
  data = result;
  mountCurrent();
}

function fillEnvs(choices: Array<{ envId: string; name: string }>, selected: string): void {
  const select = document.getElementById("envSelect") as HTMLSelectElement | null;
  if (!select) return;
  clear(select);
  if (!choices.length) {
    select.append(new Option("还没有环境", ""));
    select.value = "";
    return;
  }
  if (choices.length > 1) select.append(new Option("请选择环境", ""));
  for (const item of choices) select.append(new Option(item.name, item.envId));
  select.value = selected;
}

function go(next: StudioViewId): void {
  view = next;
  if (!data) {
    showGate("还没有选择账号环境，已停止。不会改用默认登录。");
    paintNav();
    return;
  }
  mountCurrent();
}

function bindActions(): PageActions {
  return {
    navigate: (next) => go(next),
    reload: (id) => reload(id),
    saveDraft: (input) => api.saveDraft(input),
    precheck: (input) => api.precheck(input),
    confirm: (input) => api.confirm(input),
    pickImages: (input) => api.pickImages(input),
    checkAccounts: (input) => api.checkAccounts(input),
    openAccount: (input) => api.openAccount(input),
    refreshMetrics: async (id) => {
      const result = await api.refresh(id);
      if (!result.ok) return result;
      return { ok: true, code: "ok", message: "", envId: result.envId };
    },
    openTask: (input) => api.openTask(input),
    verifyTask: (input) => api.verifyTask(input),
    resumeTask: (input) => api.resumeTask(input),
    fillReply: (input) => api.fillReply(input),
    onTasksChanged: (id, listener) => api.onTasksChanged(id, listener),
  };
}

export function startStudio(doc: Document = document): void {
  actions = bindActions();
  const sidebar = doc.getElementById("sidebar");
  if (sidebar) {
    clear(sidebar);
    for (const item of NAV) {
      const button = el("button", "nav-btn");
      button.type = "button";
      button.dataset.view = item.id;
      button.title = item.label;
      button.setAttribute("aria-label", item.label);
      button.append(icon(item.icon), el("span", "nav-label", item.label));
      button.addEventListener("click", () => go(item.id));
      sidebar.append(button);
    }
  }
  doc.getElementById("openTasks")?.addEventListener("click", () => go("tasks"));
  doc.getElementById("newDraft")?.addEventListener("click", () => {
    void (async () => {
      if (!envId) {
        showGate("还没有选择账号环境，已停止。不会改用默认登录。");
        return;
      }
      const created = await api.create(envId);
      if (!created.ok) {
        showGate(created.message);
        return;
      }
      preferDraftId = created.draft.id;
      view = "compose";
      await reload(envId);
    })();
  });
  doc.getElementById("envSelect")?.addEventListener("change", (event) => {
    const value = (event.target as HTMLSelectElement).value;
    if (value) sessionStorage.setItem(ENV_KEY, value);
    else sessionStorage.removeItem(ENV_KEY);
    void reload(value);
  });
  void (async () => {
    const probe = await api.load("");
    const choices = probe.availableEnvs || [];
    const stored = sessionStorage.getItem(ENV_KEY) || "";
    const selected = choices.some((item) => item.envId === stored) ? stored : choices.length === 1 ? choices[0].envId : "";
    fillEnvs(choices, selected);
    if (!selected) {
      showGate(probe.ok ? "请选择账号环境。不会改用默认登录。" : probe.message);
      paintNav();
      return;
    }
    sessionStorage.setItem(ENV_KEY, selected);
    await reload(selected);
  })();
}

if (typeof document !== "undefined") startStudio();
