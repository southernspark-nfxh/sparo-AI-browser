/**
 * 账号页只看当前环境的平台登录状态。
 * 新建和删除环境仍去设置 → 账号。这里不读取 token，也不切换别的环境。
 */
import { clear, createPageSession, el, on } from "../dom.js";
import type { AccountState, PageActions, StudioError } from "../types.js";

export type AccountRowModel = {
  platform: string;
  platformName: string;
  displayName: string;
  state: AccountState;
  checkedAt: string;
};

export type AccountsViewModel = {
  envId: string;
  envName: string;
  rows: AccountRowModel[];
};

const STOP_ENV = "还没有选择账号环境，已停止。不会改用默认登录。";

export function shownAccountState(state: string, checkedAt: string): AccountState {
  if (state === "ok" && checkedAt.trim()) return "ok";
  if (state === "checking" || state === "login_missing" || state === "error") return state;
  return "unknown";
}

export function accountLabel(state: AccountState): string {
  if (state === "checking") return "正在核验";
  if (state === "ok") return "正常";
  if (state === "login_missing") return "登录失效";
  if (state === "error") return "核验失败";
  return "未核验";
}

export function checkedLabel(iso: string, now = new Date()): string {
  if (!iso.trim()) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const hm = String(date.getHours()).padStart(2, "0") + ":" + String(date.getMinutes()).padStart(2, "0");
  if (date.toDateString() === now.toDateString()) return hm;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "昨天";
  return String(date.getMonth() + 1) + "-" + String(date.getDate()) + " " + hm;
}

function accountsFrom(result: { ok: boolean; accounts?: unknown }): AccountRowModel[] | null {
  if (!result.ok || !Array.isArray(result.accounts)) return null;
  const rows: AccountRowModel[] = [];
  for (const item of result.accounts) {
    if (!item || typeof item !== "object") continue;
    const row = item as { platform?: unknown; platformName?: unknown; displayName?: unknown; state?: unknown; checkedAt?: unknown };
    if (typeof row.platform !== "string") continue;
    const checkedAt = typeof row.checkedAt === "string" ? row.checkedAt : "";
    rows.push({
      platform: row.platform,
      platformName: typeof row.platformName === "string" ? row.platformName : row.platform,
      displayName: typeof row.displayName === "string" && row.displayName.trim() ? row.displayName.trim() : "未识别",
      state: shownAccountState(typeof row.state === "string" ? row.state : "", checkedAt),
      checkedAt,
    });
  }
  return rows;
}

function nodeOf(target: EventTarget | null): HTMLElement | null {
  if (!target || typeof (target as HTMLElement).getAttribute !== "function") return null;
  return target as HTMLElement;
}

export function mount(container: HTMLElement, viewModel: AccountsViewModel, actions: PageActions): { destroy: () => void } {
  const session = createPageSession();
  const envId = viewModel.envId.trim();
  let rows = viewModel.rows.map((row) => ({
    ...row,
    displayName: row.displayName.trim() || "未识别",
    state: shownAccountState(row.state, row.checkedAt),
  }));

  session.track(on(container, "click", (event) => {
    if (session.destroyed || !envId) return;
    const node = nodeOf(event.target);
    const actionNode = walk(node);
    if (!actionNode) return;
    const action = actionNode.getAttribute("data-action") || "";
    const platform = actionNode.getAttribute("data-platform") || "";
    if (action === "manage-envs") {
      const note = container.querySelector("[data-role=manage-note]");
      if (note) note.setAttribute("data-current", "true");
      return;
    }
    if (!platform) return;
    if (action === "open-account" || action === "relogin") {
      void actions.openAccount({ envId, platform });
      return;
    }
    if (action === "recheck") void recheck(platform);
  }));
  session.track(() => clear(container));

  paint();
  return { destroy: () => session.destroy() };

  function walk(node: HTMLElement | null): HTMLElement | null {
    let current = node;
    while (current && current !== container.parentElement) {
      if (current.getAttribute("data-action")) return current;
      current = current.parentElement;
    }
    return null;
  }

  async function recheck(platform: string): Promise<void> {
    const result = await actions.checkAccounts({ envId, platforms: [platform] });
    if (session.destroyed) return;
    const incoming = accountsFrom(result as StudioError & { accounts?: unknown });
    if (!incoming) {
      const note = container.querySelector("[data-role=account-note]");
      if (note) note.textContent = result.message || "登录态未核验";
      return;
    }
    rows = rows.map((row) => {
      const next = incoming.find((item) => item.platform === platform);
      if (!next || row.platform !== platform) return row;
      return {
        ...row,
        displayName: next.displayName,
        checkedAt: next.checkedAt,
        state: shownAccountState(next.state, next.checkedAt),
      };
    });
    paint();
  }

  function paint(): void {
    clear(container);
    container.setAttribute("data-env", envId);
    const head = el("div", "accounts-head");
    head.append(el("h1", "", "账号"), el("p", "muted", envId ? "环境：" + (viewModel.envName || envId) : STOP_ENV));
    const manage = el("button", "btn ghost", "管理账号环境");
    manage.type = "button";
    manage.title = "管理账号环境";
    manage.setAttribute("data-action", "manage-envs");
    head.append(manage);
    const note = el("p", "", "新建和删除环境请到设置 → 账号。这一页不会另建环境，也不会切换登录态。");
    note.setAttribute("data-role", "manage-note");
    container.append(head, note);
    if (!envId) {
      container.append(el("p", "", STOP_ENV));
      return;
    }
    const status = el("p", "muted", "");
    status.setAttribute("data-role", "account-note");
    const table = el("table");
    const header = el("tr");
    for (const name of ["平台", "当前环境", "账号", "状态", "最近核验", "操作"]) header.append(el("th", "", name));
    table.append(header);
    for (const row of rows) {
      const tr = el("tr");
      tr.setAttribute("data-platform", row.platform);
      tr.setAttribute("data-state", row.state);
      const state = el("span", "tag", accountLabel(row.state));
      state.setAttribute("data-state", row.state);
      const ops = el("div", "accounts-ops");
      ops.append(actionButton(row.state === "login_missing" || row.state === "error" ? "重新登录" : "打开后台", row.state === "login_missing" || row.state === "error" ? "relogin" : "open-account", row.platform));
      if (row.state !== "checking") ops.append(actionButton(row.state === "unknown" ? "核验登录" : "重新核验", "recheck", row.platform));
      tr.append(
        el("td", "", row.platformName),
        el("td", "", viewModel.envName || envId),
        el("td", "", row.displayName || "未识别"),
        cell(state),
        el("td", "", checkedLabel(row.checkedAt)),
        cell(ops),
      );
      table.append(tr);
    }
    const wrap = el("div", "table-wrap");
    wrap.append(table);
    container.append(status, wrap);
  }
}

function cell(child: HTMLElement): HTMLElement {
  const td = el("td");
  td.append(child);
  return td;
}

function actionButton(text: string, action: string, platform: string): HTMLButtonElement {
  const button = el("button", "btn ghost", text);
  button.type = "button";
  button.title = text;
  button.setAttribute("data-action", action);
  button.setAttribute("data-platform", platform);
  return button;
}
