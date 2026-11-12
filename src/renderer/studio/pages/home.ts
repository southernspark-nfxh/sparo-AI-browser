// 工作台首页。先放需要人处理的事，再用已有快照画摘要，不编趋势。
import "./home.css";
import { clear, createPageSession, el, on } from "../dom.js";
import type { AsyncView, HomeViewModel, PageActions, PageMount, StudioViewId } from "../types.js";
import { completenessLabel, displayCents, displayCount, formatStamp, platformName } from "./metrics.js";

export type HomeAttention = HomeViewModel["attention"][number] & {
  platform?: string;
  jobId?: string;
  action?: "login" | "task" | "verify" | "account";
};

export type HomePageModel = Omit<HomeViewModel, "attention"> & {
  attention: HomeAttention[];
  hideDelta?: boolean;
  deltaText?: string;
  tasksKnown?: boolean;
  commentsKnown?: boolean;
  metricsKnown?: boolean;
  notice?: string;
};

export type HomeInput = HomePageModel | AsyncView<HomePageModel>;

const VIEWS: StudioViewId[] = ["home", "compose", "metrics", "comments", "accounts", "tasks"];

function isAsync(input: HomeInput): input is AsyncView<HomePageModel> {
  return Boolean(input) && typeof input === "object" && "status" in input && !("attention" in input);
}

function emptyModel(envId: string): HomePageModel {
  return {
    envId,
    capturedAt: "",
    attention: [],
    pendingCount: 0,
    failedCount: 0,
    reads: null,
    revenue: null,
    recentTasks: [],
    recentComments: [],
    tasksKnown: false,
    commentsKnown: false,
    metricsKnown: false,
  };
}

export function readHomeInput(input: HomeInput): { model: HomePageModel; banner: string } {
  if (!isAsync(input)) return { model: input, banner: input.notice || "" };
  if (input.status === "ready") return { model: input.value, banner: input.value.notice || "" };
  if (input.status === "loading") return { model: emptyModel(""), banner: "正在读取已有快照" };
  if (input.status === "empty") return { model: emptyModel(""), banner: input.reason || "还没有这个环境的快照，不会编造趋势和数字。" };
  if (input.previous) return { model: input.previous, banner: input.message || "没有读到新的快照" };
  return { model: emptyModel(""), banner: input.message || "没有读到这个环境的快照" };
}

function countText(known: boolean | undefined, count: number): string {
  if (known === false) return "—";
  return displayCount(count, "full");
}

function factText(known: boolean | undefined, fact: HomePageModel["reads"], money: boolean): string {
  if (known === false || !fact || fact.value == null) return "—";
  if (fact.completeness === "missing" || fact.completeness === "unsupported") return "—";
  if (money) return fact.text && fact.text !== "—" ? fact.text : displayCents(fact.value, fact.completeness);
  if (fact.value === 0) return "0";
  return fact.text || displayCount(fact.value, fact.completeness);
}

function factNote(known: boolean | undefined, fact: HomePageModel["reads"], ready: string, empty: string): string {
  if (known === false) return "数据还没读出来";
  if (!fact || fact.value == null || fact.completeness === "missing" || fact.completeness === "unsupported") return empty;
  return ready;
}

function factTrace(fact: HomePageModel["reads"]): string {
  if (!fact) return "来源 还没有快照 · 采集 —";
  return "来源 " + (fact.source || "本地快照") + " · " + completenessLabel(fact.completeness) + " · 采集 " + (formatStamp(fact.capturedAt) || "—");
}

function actionTarget(event: Event): HTMLElement | null {
  const target = event.target;
  if (!target || typeof target !== "object" || !("closest" in target)) return null;
  const node = target as HTMLElement;
  return typeof node.closest === "function" ? node.closest("[data-action]") : null;
}

export function mount(container: HTMLElement, input: HomeInput, actions: PageActions): { destroy: () => void } {
  const session = createPageSession();
  const read = readHomeInput(input);
  const model = read.model;
  clear(container);
  const root = el("div", "home-page");
  const head = el("div", "page-head");
  head.append(
    el("h1", "", "工作台"),
    el("p", "muted clip", "当前环境：" + (model.envId || "未选择") + " · 数据截至 " + (formatStamp(model.capturedAt) || "还没有快照")),
  );
  if (read.banner) head.append(el("p", "clip", read.banner));
  const hideDelta = model.hideDelta === true || model.reads?.completeness === "partial" || model.revenue?.completeness === "partial";

  const attention = el("section", "card");
  attention.setAttribute("data-block", "attention");
  attention.append(el("h2", "", "需要处理"));
  if (!model.attention.length) {
    attention.append(el("p", "muted", "当前没有需要你处理的事项"));
  } else {
    for (const item of model.attention) {
      const row = el("div", "attention-row");
      const copy = el("div", "attention-copy");
      copy.append(el("strong", "clip", item.title), el("p", "clip", item.detail));
      const tag = el("span", "tag", completenessLabel(item.state));
      tag.setAttribute("data-state", item.state);
      copy.append(tag);
      row.append(copy);
      const action = item.action || (item.state === "login_missing" ? "login" : item.state === "unknown" ? "verify" : "task");
      const label = action === "login" ? "重新登录" : action === "verify" ? "核验结果" : action === "account" ? "查看账号" : "查看任务";
      const button = el("button", "btn ghost", label);
      button.type = "button";
      button.title = label;
      button.setAttribute("data-action", action);
      button.setAttribute("data-platform", item.platform || "");
      button.setAttribute("data-job", item.jobId || "");
      if (!item.platform && action === "login") {
        button.disabled = true;
        button.title = "还不知道是哪个平台，不能打开登录页";
      }
      row.append(button);
      attention.append(row);
    }
  }

  const kpis = el("div", "home-kpis");
  kpis.setAttribute("data-block", "summary");
  const cards: Array<[string, string, string, string, string, string]> = [
    ["pending", "待发任务", countText(model.tasksKnown, model.pendingCount), "查看发布记录", "tasks", "pending"],
    ["failed", "失败任务", countText(model.tasksKnown, model.failedCount), "需要处理", "tasks", "failed"],
    ["reads", "昨日阅读", factText(model.metricsKnown, model.reads, false), factNote(model.metricsKnown, model.reads, "相加，非去重", "还没有昨日阅读快照"), "metrics", "reads"],
    ["revenue", "本月收益", factText(model.metricsKnown, model.revenue, true), factNote(model.metricsKnown, model.revenue, "账面相加，非到账", "还没有本月收益快照"), "metrics", "revenue"],
  ];
  for (const [key, label, value, note, view, filter] of cards) {
    const button = el("button", "card span-4 kpi-card");
    button.type = "button";
    button.setAttribute("data-action", "navigate");
    button.setAttribute("data-view", view);
    button.setAttribute("data-filter", filter);
    button.setAttribute("data-card", key);
    button.append(el("span", "", label), el("span", "kpi", value), el("span", "muted clip", note));
    if (key === "reads") button.append(el("span", "muted clip", factTrace(model.reads)));
    if (key === "revenue") button.append(el("span", "muted clip", factTrace(model.revenue)));
    if (!hideDelta && key === "reads" && model.deltaText) button.append(el("span", "muted", "较前一日 " + model.deltaText));
    else if (!hideDelta && key === "reads" && model.metricsKnown !== false && model.reads) button.append(el("span", "muted", "较前一日 — · 没有前一日快照"));
    kpis.append(button);
  }

  const columns = el("div", "home-columns");
  const tasks = el("section", "card span-8");
  tasks.setAttribute("data-block", "recent-tasks");
  tasks.append(el("h2", "", "最近发布"));
  if (model.tasksKnown === false) tasks.append(el("p", "", "发布记录还没读出来"));
  else if (!model.recentTasks.length) tasks.append(el("p", "", "还没有发布记录"));
  else {
    const wrap = el("div", "table-wrap");
    const table = el("table");
    const head = el("tr");
    for (const name of ["标题", "平台", "阶段", "更新时间"]) head.append(el("th", "", name));
    table.append(head);
    for (const item of model.recentTasks.slice(0, 8)) {
      const line = el("tr");
      const title = el("td", "clip", item.title || "—");
      title.title = item.title || "";
      line.append(title, el("td", "clip", platformName(item.platform)), el("td", "clip", item.stage || "—"), el("td", "num", formatStamp(item.updatedAt) || "—"));
      table.append(line);
    }
    wrap.append(table);
    tasks.append(wrap);
  }
  const comments = el("section", "card span-4");
  comments.setAttribute("data-block", "recent-comments");
  comments.append(el("h2", "", "最新评论"));
  if (model.commentsKnown === false) comments.append(el("p", "", "评论还没读出来"));
  else if (!model.recentComments.length) comments.append(el("p", "", "还没有评论"));
  else {
    for (const item of model.recentComments.slice(0, 4)) {
      const row = el("p", "clip", [platformName(item.platform), item.author || "—", item.summary || "—", formatStamp(item.createdAt) || "—"].join(" · "));
      row.title = item.summary || "";
      comments.append(row);
    }
  }
  columns.append(tasks, comments);
  root.append(head, attention, kpis, columns);
  container.append(root);

  session.track(on(root, "click", (event) => {
    const target = actionTarget(event);
    if (!target || session.destroyed) return;
    if ("disabled" in target && (target as HTMLButtonElement).disabled) return;
    const action = target.getAttribute("data-action") || "";
    const view = target.getAttribute("data-view") || "";
    const filter = target.getAttribute("data-filter") || "";
    const name = target.getAttribute("data-platform") || "";
    const jobId = target.getAttribute("data-job") || "";
    if (action === "navigate" && VIEWS.includes(view as StudioViewId)) {
      actions.navigate(view as StudioViewId, filter || undefined);
      return;
    }
    if (!model.envId) return;
    if (action === "login") void actions.openAccount({ envId: model.envId, platform: name });
    else if (action === "verify") actions.navigate("tasks", jobId ? "verify:" + jobId : "verify");
    else if (action === "account") actions.navigate("accounts", name || undefined);
    else if (action === "task") actions.navigate("tasks", jobId ? "job:" + jobId : "failed");
  }));

  return {
    destroy() {
      session.destroy();
      clear(container);
    },
  };
}

export const mountHome: PageMount<HomeViewModel> = (container, viewModel, actions) => mount(container, viewModel, actions);
