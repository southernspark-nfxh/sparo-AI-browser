/** 评论收件箱。只通过 actions 填回复草稿，不发送。 */
import { clear, createPageSession, el, on } from "../dom.js";
import type { CommentItem, CommentsViewModel, PageActions, PageMount, ReplyResult } from "../types.js";

const REPLY_PLATFORMS = new Set(["toutiao", "baijiahao"]);
const PLATFORM_LABEL: Record<string, string> = {
  toutiao: "头条号",
  baijiahao: "百家号",
  dayu: "大鱼号",
  sohu: "搜狐号",
};

export type CommentFilter = {
  scope: "open" | "all";
  platform: string;
  content: string;
  time: "all" | "24h" | "7d";
};

export type CommentsMountModel =
  | { status: "loading"; envId?: string }
  | { status: "empty"; reason: string; envId?: string }
  | { status: "error" | "missing" | "unsupported" | "stale" | "login_missing"; message: string; envId?: string }
  | (CommentsViewModel & { status?: "ready"; envName?: string });

type CommentRow = CommentItem & { replied: boolean };

const STATUS_TEXT = {
  ready: "已读取",
  empty: "列表为空",
  error: "读取失败",
  login_missing: "登录失效",
  unsupported: "探针未通",
} as const;

export function commentLayout(width: number): "columns" | "drill" {
  return width < 900 ? "drill" : "columns";
}

export function parseCommentTime(value: string): number | null {
  const text = value.trim();
  if (!text) return null;
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(text)
    ? text.replace(" ", "T") + ":00"
    : text.includes(" ")
      ? text.replace(" ", "T")
      : text;
  const time = Date.parse(normalized);
  return Number.isNaN(time) ? null : time;
}

export function accountDataStatus(board: { reason: string; comments: readonly unknown[] }): keyof typeof STATUS_TEXT {
  const reason = board.reason || "";
  if (/登录/.test(reason)) return "login_missing";
  if (/未实测|探针未通|不可用/.test(reason)) return "unsupported";
  if (/不是 JSON|读取失败|失败/.test(reason)) return "error";
  if (board.comments.length === 0) return "empty";
  return "ready";
}

export function unrepliedCount(board: { reason: string; comments: ReadonlyArray<CommentItem & { replied?: boolean }> }): number | null {
  const status = accountDataStatus(board);
  if (status !== "ready" && status !== "empty") return null;
  return board.comments.filter((item) => !repliedOf(item)).length;
}

export function filterCommentRows<T extends CommentRow>(rows: readonly T[], query: CommentFilter, now = Date.now()): T[] {
  const needle = query.content.trim().toLowerCase();
  const windowMs = query.time === "24h" ? 86_400_000 : query.time === "7d" ? 7 * 86_400_000 : 0;
  return rows.filter((row) => {
    if (query.scope !== "all" && row.replied) return false;
    if (query.platform && row.platform !== query.platform) return false;
    if (needle) {
      const hay = (row.title + "\n" + row.content + "\n" + row.author).toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    if (windowMs) {
      const at = parseCommentTime(row.createdAt);
      if (at == null || now - at > windowMs) return false;
    }
    return true;
  });
}

function repliedOf(item: CommentItem): boolean {
  if (!Object.prototype.hasOwnProperty.call(item, "replied")) return false;
  return (item as CommentItem & { replied?: boolean }).replied === true;
}

function platformLabel(id: string, name?: string): string {
  if (PLATFORM_LABEL[id]) return PLATFORM_LABEL[id];
  if (!name) return id;
  return name.endsWith("号") ? name : name + "号";
}

function boardCanFill(board: { platform: string; canReply: boolean; reason: string; comments: readonly unknown[] }): boolean {
  return REPLY_PLATFORMS.has(board.platform) && board.canReply === true && accountDataStatus(board) === "ready";
}

function asElement(target: EventTarget | null): HTMLElement | null {
  if (!target || typeof target !== "object" || !("getAttribute" in target)) return null;
  const node = target as HTMLElement;
  return typeof node.getAttribute === "function" ? node : null;
}

function asHtml(node: Element | null): HTMLElement | null {
  if (!node || !("hidden" in node)) return null;
  return node as HTMLElement;
}

function hide(node: HTMLElement, value: boolean): void {
  node.hidden = value;
  if (value) node.setAttribute("hidden", "");
  else node.removeAttribute("hidden");
}

function readWidth(container: HTMLElement): number {
  const marked = Number(container.getAttribute("data-viewport") || "");
  if (marked > 0) return marked;
  const host = globalThis as { matchMedia?: (query: string) => { matches: boolean } };
  if (typeof host.matchMedia === "function") return host.matchMedia("(max-width: 899px)").matches ? 800 : 1200;
  if (container.clientWidth > 0) return container.clientWidth;
  return 1200;
}

function isReady(model: CommentsMountModel): model is CommentsViewModel & { status?: "ready"; envName?: string } {
  if ("status" in model && model.status && model.status !== "ready") return false;
  return "boards" in model && Array.isArray(model.boards) && typeof model.envId === "string";
}

function envNameOf(model: CommentsViewModel & { envName?: string }): string {
  return typeof model.envName === "string" && model.envName ? model.envName : model.envId;
}

function rowsOf(model: CommentsViewModel): CommentRow[] {
  const rows: CommentRow[] = [];
  for (const board of model.boards) {
    const status = accountDataStatus(board);
    if (status !== "ready" && status !== "empty") continue;
    for (const item of board.comments) {
      rows.push({ ...item, platform: item.platform || board.platform, replied: repliedOf(item) });
    }
  }
  return rows;
}

function addOption(select: HTMLSelectElement, value: string, label: string): void {
  const option = el("option", "", label);
  option.value = value;
  option.setAttribute("value", value);
  select.append(option);
}

function pendingResult(result: ReplyResult): boolean {
  if (result.code === "filled_pending_get") return true;
  if (!("filled" in result)) return false;
  return (result as ReplyResult & { filled?: boolean }).filled === true;
}

export const mount: PageMount<CommentsMountModel> = (container, viewModel, actions) => {
  const session = createPageSession();
  clear(container);
  if (!isReady(viewModel)) {
    const status = "status" in viewModel && viewModel.status ? viewModel.status : "error";
    let text = "评论没有读出来。";
    if (status === "loading") text = "正在读取评论";
    else if (status === "empty" && "reason" in viewModel) text = viewModel.reason;
    else if ("message" in viewModel && typeof viewModel.message === "string") text = viewModel.message;
    const screen = el("section", "comments-page comments-screen");
    screen.setAttribute("data-screen", status);
    screen.setAttribute("data-state", status);
    screen.append(el("h1", "", "评论"), el("p", "comments-clip", text));
    container.append(screen);
    return {
      destroy() {
        session.destroy();
        clear(container);
      },
    };
  }
  if (!viewModel.envId.trim()) {
    const screen = el("section", "comments-page comments-screen");
    screen.setAttribute("data-screen", "missing");
    screen.setAttribute("data-state", "missing");
    screen.append(el("h1", "", "评论"), el("p", "comments-clip", "还没有选择账号环境，已停止。不会改用默认登录。"));
    container.append(screen);
    return {
      destroy() {
        session.destroy();
        clear(container);
      },
    };
  }

  const model = viewModel;
  const state: CommentFilter & { selectedId: string; pane: "list" | "detail" } = {
    scope: "open",
    platform: "",
    content: "",
    time: "all",
    selectedId: "",
    pane: "list",
  };
  const drafts = new Map<string, string>();
  const root = el("section", "comments-page");
  root.setAttribute("data-screen", "ready");
  root.setAttribute("data-columns", "3-5-4");
  const accounts = el("aside", "comments-accounts");
  const list = el("section", "comments-list");
  const detail = el("section", "comments-detail");
  const accountBody = el("div");
  accountBody.setAttribute("data-role", "account-body");
  const listBody = el("div");
  listBody.setAttribute("data-role", "list-body");
  const detailBody = el("div");
  detailBody.setAttribute("data-role", "detail-body");
  const filters = el("div", "comments-filters");
  const scope = el("select");
  scope.setAttribute("data-role", "filter-scope");
  addOption(scope, "open", "未回复");
  addOption(scope, "all", "全部");
  scope.value = "open";
  const time = el("select");
  time.setAttribute("data-role", "filter-time");
  addOption(time, "all", "全部时间");
  addOption(time, "24h", "近24小时");
  addOption(time, "7d", "近7天");
  time.value = "all";
  const content = el("input");
  content.setAttribute("data-role", "content-filter");
  content.placeholder = "按内容筛选";
  filters.append(scope, time, content);
  accounts.append(el("h1", "", "评论"), el("p", "comments-clip", "当前环境 " + envNameOf(model)), accountBody);
  list.append(filters, listBody);
  detail.append(detailBody);
  root.append(accounts, list, detail);
  container.append(root);

  function layout(): void {
    const mode = commentLayout(readWidth(container));
    root.setAttribute("data-layout", mode);
    const back = asHtml(detailBody.querySelector("[data-role=back-list]"));
    if (mode === "columns") {
      root.setAttribute("data-pane", "columns");
      hide(accounts, false);
      hide(list, false);
      hide(detail, false);
      if (back) hide(back, true);
      return;
    }
    const showDetail = state.pane === "detail" && Boolean(state.selectedId);
    root.setAttribute("data-pane", showDetail ? "detail" : "list");
    hide(accounts, showDetail);
    hide(list, showDetail);
    hide(detail, !showDetail);
    if (back) hide(back, !showDetail);
  }

  function renderAccounts(): void {
    clear(accountBody);
    const all = el("button", "comments-account");
    all.type = "button";
    all.setAttribute("data-role", "account-all");
    all.textContent = "全部平台";
    if (!state.platform) all.setAttribute("aria-pressed", "true");
    accountBody.append(all);
    for (const board of model.boards) {
      const status = accountDataStatus(board);
      const count = unrepliedCount(board);
      const button = el("button", "comments-account");
      button.type = "button";
      button.setAttribute("data-role", "account");
      button.setAttribute("data-platform", board.platform);
      button.setAttribute("data-state", status);
      if (state.platform === board.platform) button.setAttribute("aria-pressed", "true");
      button.append(
        el("span", "comments-clip", platformLabel(board.platform, board.name)),
        el("span", "comments-clip", "未回复 " + (count == null ? "—" : String(count))),
        el("span", "comments-status", STATUS_TEXT[status]),
      );
      const tag = button.querySelector(".comments-status");
      if (tag) tag.setAttribute("data-state", status);
      accountBody.append(button);
    }
  }

  function renderList(): void {
    clear(listBody);
    const selected = state.platform ? model.boards.find((board) => board.platform === state.platform) : undefined;
    if (selected) {
      const status = accountDataStatus(selected);
      if (status === "unsupported" || status === "login_missing" || status === "error") {
        listBody.setAttribute("data-state", status);
        listBody.append(el("p", "comments-clip", selected.reason || STATUS_TEXT[status]));
        return;
      }
    }
    const open = model.boards.some((board) => {
      const status = accountDataStatus(board);
      return status === "ready" || status === "empty";
    });
    if (!open) {
      listBody.setAttribute("data-state", "unsupported");
      listBody.append(el("p", "comments-clip", "探针未通，没有可显示的评论列表"));
      return;
    }
    const base = rowsOf(model).filter((row) => !state.platform || row.platform === state.platform);
    const filtered = filterCommentRows(base, state);
    if (!filtered.length) {
      listBody.setAttribute("data-state", "empty");
      const text = !base.length
        ? "还没有评论"
        : state.scope === "open" && base.every((row) => row.replied)
          ? "没有未回复的评论"
          : "没有符合筛选的评论";
      listBody.append(el("p", "comments-clip", text));
      return;
    }
    listBody.setAttribute("data-state", "ready");
    for (const item of filtered) {
      const row = el("button", "comments-row");
      row.type = "button";
      row.setAttribute("data-role", "comment");
      row.setAttribute("data-comment-id", item.commentId);
      row.setAttribute("data-replied", item.replied ? "true" : "false");
      row.append(
        el("span", "comments-clip", item.author),
        el("span", "comments-summary comments-clip", item.content),
        el("span", "comments-clip", item.title),
        el("span", "comments-clip", item.createdAt),
      );
      listBody.append(row);
    }
  }

  function renderDetail(): void {
    clear(detailBody);
    const back = el("button", "btn ghost", "返回列表");
    back.type = "button";
    back.setAttribute("data-role", "back-list");
    detailBody.append(back);
    const item = rowsOf(model).find((row) => row.commentId === state.selectedId);
    const board = model.boards.find((entry) => entry.platform === (item?.platform || state.platform));
    if (!item || !board) {
      detailBody.append(el("p", "comments-clip", "选择一条评论后在这里写回复草稿。"));
      layout();
      return;
    }
    detailBody.append(
      el("p", "comments-clip", item.author),
      el("p", "comments-full", item.content),
      el("p", "comments-clip", item.title),
    );
    if (!boardCanFill(board)) {
      detailBody.append(el("p", "comments-status", "只读，回复未开"));
      if (board.reason) detailBody.append(el("p", "comments-clip", board.reason));
      layout();
      return;
    }
    const box = el("textarea", "reply-box");
    box.setAttribute("data-role", "reply-draft");
    box.placeholder = "回复草稿";
    box.value = drafts.get(item.commentId) || "";
    const go = el("button", "btn ghost", "填入平台回复框");
    go.type = "button";
    go.setAttribute("data-role", "fill-reply");
    const note = el("p", "comments-status", "还没有填写。");
    note.setAttribute("data-role", "reply-status");
    detailBody.append(box, go, note, el("p", "comments-clip", "只把草稿填进平台回复框。发送要你自己在平台页面上点。"));
    layout();
  }

  function closestRole(target: EventTarget | null): { role: string; node: HTMLElement } | null {
    let node = asElement(target);
    while (node && node !== root) {
      const role = node.getAttribute("data-role");
      if (role) return { role, node };
      const parent = node.parentElement;
      node = parent && parent !== node ? parent : null;
    }
    return null;
  }

  function paint(): void {
    renderAccounts();
    renderList();
    renderDetail();
  }

  session.track(on(root, "click", (event) => {
    const hit = closestRole(event.target);
    if (!hit || session.destroyed) return;
    if (hit.role === "account-all") {
      state.platform = "";
      state.selectedId = "";
      state.pane = "list";
      paint();
      return;
    }
    if (hit.role === "account") {
      state.platform = hit.node.getAttribute("data-platform") || "";
      state.selectedId = "";
      state.pane = "list";
      paint();
      return;
    }
    if (hit.role === "comment") {
      state.selectedId = hit.node.getAttribute("data-comment-id") || "";
      state.pane = "detail";
      renderDetail();
      return;
    }
    if (hit.role === "back-list") {
      state.pane = "list";
      layout();
      return;
    }
    if (hit.role === "fill-reply") {
      const current = rowsOf(model).find((row) => row.commentId === state.selectedId);
      const board = model.boards.find((entry) => entry.platform === current?.platform);
      if (!current || !board || !boardCanFill(board) || session.destroyed) return;
      const box = detailBody.querySelector("[data-role=reply-draft]");
      const text = box && "value" in box ? String((box as HTMLTextAreaElement).value || "") : drafts.get(current.commentId) || "";
      drafts.set(current.commentId, text);
      const go = hit.node;
      go.setAttribute("aria-busy", "true");
      const commentId = current.commentId;
      const platform = current.platform;
      const contentText = current.content;
      void (async () => {
        try {
          const result = await actions.fillReply({
            envId: model.envId,
            platform,
            commentId,
            text,
            content: contentText,
          });
          if (session.destroyed || state.selectedId !== commentId) return;
          const status = detailBody.querySelector("[data-role=reply-status]");
          if (status) {
            status.textContent = result.message || "";
            status.setAttribute("data-state", pendingResult(result) ? "pending" : "error");
          }
          const row = listBody.querySelector('[data-comment-id="' + commentId + '"]');
          if (row && row.getAttribute("data-replied") !== "true") row.setAttribute("data-replied", "false");
        } catch {
          if (session.destroyed || state.selectedId !== commentId) return;
          const status = detailBody.querySelector("[data-role=reply-status]");
          if (status) status.textContent = "没有写进回复框，草稿还留着。";
        } finally {
          if (!session.destroyed) go.removeAttribute("aria-busy");
        }
      })();
    }
  }));

  session.track(on(root, "input", (event) => {
    const hit = closestRole(event.target);
    if (!hit || session.destroyed) return;
    if (hit.role === "content-filter" && "value" in hit.node) {
      state.content = String((hit.node as HTMLInputElement).value || "");
      renderList();
      return;
    }
    if (hit.role === "reply-draft" && state.selectedId && "value" in hit.node) {
      drafts.set(state.selectedId, String((hit.node as HTMLTextAreaElement).value || ""));
    }
  }));

  session.track(on(root, "change", (event) => {
    const hit = closestRole(event.target);
    if (!hit || session.destroyed || !("value" in hit.node)) return;
    const value = String((hit.node as HTMLSelectElement).value || "");
    if (hit.role === "filter-scope" && (value === "open" || value === "all")) state.scope = value;
    if (hit.role === "filter-time" && (value === "all" || value === "24h" || value === "7d")) state.time = value;
    renderList();
  }));

  const host = globalThis as {
    matchMedia?: (query: string) => { addEventListener?: (type: string, fn: () => void) => void; removeEventListener?: (type: string, fn: () => void) => void };
    addEventListener?: (type: string, fn: () => void) => void;
    removeEventListener?: (type: string, fn: () => void) => void;
  };
  if (typeof host.matchMedia === "function") {
    const media = host.matchMedia("(max-width: 899px)");
    const onChange = () => {
      if (!session.destroyed) layout();
    };
    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", onChange);
      session.track(() => media.removeEventListener?.( "change", onChange));
    }
  }
  if (typeof host.addEventListener === "function") {
    const onResize = () => {
      if (!session.destroyed) layout();
    };
    host.addEventListener("resize", onResize);
    session.track(() => host.removeEventListener?.("resize", onResize));
  }

  paint();
  return {
    destroy() {
      session.destroy();
      clear(container);
    },
  };
};
