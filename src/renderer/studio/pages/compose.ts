/**
 * 发稿页：共性内容、平台差异、本地图片和预检确认单。
 * 只改自己的容器，只通过 actions 调用能力。确认到此为止，不发布。
 */
import { clear, createPageSession, el, on } from "../dom.js";
import type { AccountState, DraftInput, PageActions, PrecheckResult, StudioError } from "../types.js";

export type PlatformChoice = {
  enabled: boolean;
  title?: string;
  category?: string;
  original?: boolean | null;
  confirmed?: string[];
};

export type ComposeDraft = {
  id: string;
  title: string;
  summary: string;
  body: string;
  images: string[];
  cover: string;
  topics: string[];
  primaryPlatform: string;
  platforms: Record<string, PlatformChoice>;
  schedule: Record<string, never>;
  createdAt: string;
  updatedAt: string;
  envId?: string;
  revision?: number;
  association?: "linked" | "unlinked";
};

export type ComposeProfile = {
  id: string;
  name: string;
  titleMin: number | null;
  titleMax: number | null;
  bodyMax: number | null;
  coverMode: string;
  needsCover: boolean;
  minDistinctImages: number | null;
  required: Array<{ id: string; label: string }>;
  forbidden: Array<{ id: string; label: string }>;
  defaults: Array<{ id: string; label: string }>;
};

export type ComposeAccount = {
  platform: string;
  state: AccountState;
  checkedAt: string;
  displayName?: string;
};

export type ComposeViewModel = {
  envId: string;
  envName: string;
  revision: number;
  association: "linked" | "unlinked";
  draft: ComposeDraft;
  drafts: ComposeDraft[];
  profiles: ComposeProfile[];
  accounts: ComposeAccount[];
};

type HeldPrecheck = { result: PrecheckResult; stamp: string };

const STOP_ENV = "还没有选择账号环境，已停止。不会改用默认登录。";

export function countChars(text: string): number {
  return [...text].length;
}

export function imageName(file: string): string {
  const parts = file.split(/[/\\]/);
  return parts[parts.length - 1] || file;
}

export function moveItem<T>(items: readonly T[], index: number, direction: -1 | 1): T[] {
  const next = items.slice();
  const to = index + direction;
  if (index < 0 || to < 0 || index >= next.length || to >= next.length) return next;
  const [item] = next.splice(index, 1);
  next.splice(to, 0, item);
  return next;
}

export function applyPicked(draft: ComposeDraft, kind: "body" | "cover", files: readonly string[]): ComposeDraft {
  const clean = files.map((file) => file.trim()).filter(Boolean);
  if (kind === "cover") {
    if (!clean[0]) return draft;
    return { ...draft, cover: clean[0], images: [...draft.images] };
  }
  const images = [...draft.images];
  for (const file of clean) {
    if (!images.includes(file)) images.push(file);
  }
  return { ...draft, images };
}

export function editorStamp(envId: string, draft: ComposeDraft): string {
  return JSON.stringify({
    envId,
    title: draft.title,
    summary: draft.summary,
    body: draft.body,
    cover: draft.cover,
    images: draft.images,
    primaryPlatform: draft.primaryPlatform,
    platforms: draft.platforms,
  });
}

export function contentProblems(draft: ComposeDraft, profile: ComposeProfile): string[] {
  const choice = draft.platforms[profile.id];
  if (!choice?.enabled) return [];
  const problems: string[] = [];
  const title = choice.title?.trim() ? choice.title : draft.title;
  const titleLen = countChars(title);
  if (profile.titleMin != null && titleLen < profile.titleMin) problems.push("标题短于 " + profile.titleMin + " 字");
  if (profile.titleMax != null && titleLen > profile.titleMax) problems.push("标题超过 " + profile.titleMax + " 字，没有自动缩短");
  if (profile.bodyMax != null && countChars(draft.body) > profile.bodyMax) problems.push("正文超过 " + profile.bodyMax + " 字，没有自动缩短");
  if (profile.needsCover && !draft.cover) problems.push("缺封面（必填）");
  const distinct = new Set(draft.images.filter(Boolean)).size;
  if (profile.minDistinctImages != null && distinct < profile.minDistinctImages) {
    problems.push("不同图 " + distinct + " 张，需要 " + profile.minDistinctImages + " 张");
  }
  const confirmed = choice.confirmed || [];
  for (const item of profile.required) {
    if (!confirmed.includes(item.id)) problems.push("还没确认「" + item.label + "」");
  }
  for (const item of profile.forbidden) {
    if (confirmed.includes(item.id)) problems.push("不能勾「" + item.label + "」");
  }
  return problems;
}

export function shownLogin(state: string, checkedAt: string): AccountState {
  if (state === "ok" && checkedAt.trim()) return "ok";
  if (state === "checking" || state === "login_missing" || state === "error") return state;
  return "unknown";
}

export function loginLine(state: AccountState): string {
  if (state === "ok") return "登录正常";
  if (state === "login_missing") return "未登录，只跳过这个平台";
  if (state === "error") return "登录核验失败";
  if (state === "checking") return "正在核验登录";
  return "登录态未核验";
}

function clock(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return String(date.getHours()).padStart(2, "0") + ":" + String(date.getMinutes()).padStart(2, "0");
}

function platformLabel(profile: ComposeProfile): string {
  return profile.name.endsWith("号") ? profile.name : profile.name + "号";
}

function filesFromPick(result: { ok: boolean; files?: unknown }): string[] {
  if (!result.ok || !Array.isArray(result.files)) return [];
  return result.files.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function accountsFrom(result: { ok: boolean; accounts?: unknown }): ComposeAccount[] | null {
  if (!result.ok || !Array.isArray(result.accounts)) return null;
  const rows: ComposeAccount[] = [];
  for (const item of result.accounts) {
    if (!item || typeof item !== "object") continue;
    const row = item as { platform?: unknown; state?: unknown; checkedAt?: unknown; displayName?: unknown };
    if (typeof row.platform !== "string") continue;
    const checkedAt = typeof row.checkedAt === "string" ? row.checkedAt : "";
    rows.push({
      platform: row.platform,
      state: shownLogin(typeof row.state === "string" ? row.state : "", checkedAt),
      checkedAt,
      displayName: typeof row.displayName === "string" ? row.displayName : undefined,
    });
  }
  return rows;
}

function nodeOf(target: EventTarget | null): HTMLElement | null {
  if (!target || typeof (target as HTMLElement).getAttribute !== "function") return null;
  return target as HTMLElement;
}

function actionOf(target: EventTarget | null, root: HTMLElement): HTMLElement | null {
  let node = nodeOf(target);
  while (node && node !== root.parentElement) {
    if (node.getAttribute("data-action")) return node;
    node = node.parentElement;
  }
  return null;
}

export function mount(container: HTMLElement, viewModel: ComposeViewModel, actions: PageActions): { destroy: () => void } {
  const session = createPageSession();
  const envId = viewModel.envId.trim();
  let draft = cloneDraft(viewModel.draft);
  let revision = viewModel.revision;
  let association = viewModel.association;
  let accounts = viewModel.accounts.map((item) => ({ ...item, state: shownLogin(item.state, item.checkedAt) }));
  let held: HeldPrecheck | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let saveGen = 0;
  const profiles = viewModel.profiles;

  session.track(() => {
    if (timer) clearTimeout(timer);
  });
  session.track(on(container, "click", (event) => {
    if (session.destroyed) return;
    const node = actionOf(event.target, container);
    if (!node || node.hasAttribute("disabled")) return;
    const action = node.getAttribute("data-action") || "";
    if (action === "save") void saveNow();
    else if (action === "precheck" || action === "check-publish") void runPrecheck();
    else if (action === "records") actions.navigate("tasks");
    else if (action === "pick-body") void pick("body");
    else if (action === "pick-cover") void pick("cover");
    else if (action === "remove-image") changeImages(draft.images.filter((_, index) => index !== Number(node.getAttribute("data-index"))));
    else if (action === "move-image") {
      const direction = node.getAttribute("data-dir") === "up" ? -1 : 1;
      changeImages(moveItem(draft.images, Number(node.getAttribute("data-index")), direction));
    } else if (action === "clear-cover") {
      draft = readDraft();
      draft.cover = "";
      fillCover();
      refreshRules();
      invalidate();
      scheduleSave();
    } else if (action === "expand") expand(node.getAttribute("data-platform") || "");
    else if (action === "go-settings") {
      closeDialog();
      expand(node.getAttribute("data-platform") || "", true);
    } else if (action === "recheck") void recheck(node.getAttribute("data-platform") || "");
    else if (action === "close-precheck") closeDialog();
    else if (action === "confirm-publish") void confirmPublish();
  }));
  session.track(on(container, "input", () => {
    if (session.destroyed) return;
    onEdit();
  }));
  session.track(on(container, "change", (event) => {
    if (session.destroyed) return;
    const node = nodeOf(event.target);
    if (node?.getAttribute("data-field") === "draft-list") {
      switchDraft((node as HTMLSelectElement).value);
      return;
    }
    onEdit();
  }));
  session.track(() => clear(container));

  if (!envId) {
    clear(container);
    container.append(el("h1", "", "发稿"), el("p", "", STOP_ENV));
    return { destroy: () => session.destroy() };
  }

  const unlinkedCount = viewModel.drafts.filter((item) => item.association === "unlinked" || !item.envId).length;
  const editingUnlinked = association === "unlinked" || !draft.envId;
  if (editingUnlinked && envId !== "default") {
    clear(container);
    const head = el("div", "compose-head");
    head.append(el("h1", "", "发稿"), el("p", "", "环境：" + (viewModel.envName || envId)));
    container.append(head, el("p", "", "未关联草稿 " + String(unlinkedCount || 1) + " 篇，没有放进当前环境。"));
    container.setAttribute("data-env", envId);
    return { destroy: () => session.destroy() };
  }

  paint();
  return { destroy: () => session.destroy() };

  function switchDraft(id: string): void {
    const found = viewModel.drafts.find((item) => item.id === id);
    if (!found) return;
    if (found.envId && found.envId !== envId) return;
    if ((found.association === "unlinked" || !found.envId) && envId !== "default") return;
    draft = cloneDraft(found);
    revision = found.revision ?? 0;
    association = found.association || (found.envId ? "linked" : "unlinked");
    invalidate();
    paint();
  }

  function onEdit(): void {
    const images = draft.images.slice();
    const cover = draft.cover;
    draft = readDraft();
    draft.images = images;
    draft.cover = cover;
    refreshRules();
    invalidate();
    scheduleSave();
  }

  function invalidate(): void {
    held = null;
    closeDialog();
  }

  function scheduleSave(): void {
    if (session.destroyed) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      if (session.destroyed) return;
      void saveNow();
    }, 400);
  }

  function setSave(state: "saving" | "saved" | "unsaved", text: string): void {
    const note = container.querySelector("[data-save-state]");
    if (!note) return;
    note.textContent = text;
    note.setAttribute("data-save-state", state);
  }

  async function saveNow(): Promise<boolean> {
    if (session.destroyed || !envId) return false;
    const snapshot = readDraft();
    const gen = ++saveGen;
    setSave("saving", "保存中");
    const saved = await actions.saveDraft({ envId, draft: snapshot as DraftInput, revision });
    if (session.destroyed || gen !== saveGen) return false;
    if (!saved.ok) {
      setSave("unsaved", "未保存");
      return false;
    }
    revision = saved.revision;
    draft.revision = saved.revision;
    if (snapshot.association === "unlinked") {
      draft.association = "unlinked";
      delete draft.envId;
      association = "unlinked";
    }
    setSave("saved", "已自动保存 " + clock(saved.savedAt));
    return true;
  }

  async function runPrecheck(): Promise<void> {
    if (session.destroyed) return;
    if (association === "unlinked" || !draft.envId || draft.envId !== envId) {
      setSave("unsaved", "这篇草稿未关联环境，不会放进当前环境做预检。");
      return;
    }
    const saved = await saveNow();
    if (!saved || session.destroyed) return;
    const snapshot = readDraft();
    const result = await actions.precheck({ envId, draft: snapshot as DraftInput, revision });
    if (session.destroyed) return;
    if (!result.ok) {
      setSave("unsaved", result.message || "预检没有完成");
      return;
    }
    if (result.envId !== envId || result.draftRevision !== revision) {
      setSave("unsaved", "这份预检已经失效，请重新预检。");
      return;
    }
    held = { result, stamp: editorStamp(envId, snapshot) };
    openDialog(result, snapshot);
  }

  async function confirmPublish(): Promise<void> {
    const snapshot = readDraft();
    if (!held || held.stamp !== editorStamp(envId, snapshot) || held.result.envId !== envId || held.result.draftRevision !== revision) {
      invalidate();
      setSave("unsaved", "这份预检已经失效，请重新预检。");
      return;
    }
    const ready = publishable(snapshot, held.result);
    if (!ready.length) return;
    const result = await actions.confirm({
      envId,
      precheckId: held.result.precheckId,
      confirmationId: globalThis.crypto.randomUUID(),
    });
    if (session.destroyed) return;
    const note = container.querySelector("[data-role=confirm-note]");
    if (note) note.textContent = result.message || "";
  }

  async function pick(kind: "body" | "cover"): Promise<void> {
    const result = await actions.pickImages({ envId, draftId: draft.id, kind });
    if (session.destroyed) return;
    const files = filesFromPick(result as StudioError & { files?: unknown });
    const note = container.querySelector("[data-note=images]");
    if (!files.length) {
      if (note) note.textContent = result.message || "没有选中图片";
      return;
    }
    draft = applyPicked(readDraft(), kind, files);
    fillImages();
    fillCover();
    refreshRules();
    invalidate();
    scheduleSave();
    if (note) note.textContent = kind === "cover" ? "已选择封面" : "已加入 " + String(files.length) + " 张图片";
  }

  async function recheck(platform: string): Promise<void> {
    if (!platform) return;
    const result = await actions.checkAccounts({ envId, platforms: [platform] });
    if (session.destroyed) return;
    const incoming = accountsFrom(result as StudioError & { accounts?: unknown });
    const note = container.querySelector("[data-role=confirm-note]");
    if (!incoming) {
      if (note) note.textContent = result.message || "登录态未核验";
      return;
    }
    for (const item of incoming) {
      if (item.platform !== platform) continue;
      const state = shownLogin(item.state, item.checkedAt);
      const next = { ...item, state };
      const index = accounts.findIndex((row) => row.platform === platform);
      if (index >= 0) accounts[index] = next;
      else accounts.push(next);
    }
    invalidate();
    await runPrecheck();
  }

  function publishable(snapshot: ComposeDraft, result: PrecheckResult): string[] {
    return profiles.filter((profile) => toneOf(snapshot, profile, result) === "ok").map((profile) => profile.id);
  }

  function toneOf(snapshot: ComposeDraft, profile: ComposeProfile, result: PrecheckResult | null): "ok" | "attention" | "skip" {
    if (!snapshot.platforms[profile.id]?.enabled) return "skip";
    const problems = contentProblems(snapshot, profile);
    const account = accounts.find((item) => item.platform === profile.id);
    const login = shownLogin(account?.state || "unknown", account?.checkedAt || "");
    const server = result?.rows.find((row) => row.platform === profile.id);
    if (problems.length || login !== "ok" || (server && (server.level === "warn" || server.skip))) return "attention";
    return "ok";
  }

  function openDialog(result: PrecheckResult, snapshot: ComposeDraft): void {
    closeDialog();
    const ready = publishable(snapshot, result);
    const backdrop = el("div", "precheck-backdrop");
    backdrop.setAttribute("data-role", "precheck");
    const dialog = el("div", "precheck-dialog");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    const head = el("div", "precheck-head");
    head.append(el("h2", "", "发布前检查"), el("p", "", "本次使用环境：" + (viewModel.envName || envId) + "；只检查已选择的平台。"));
    const body = el("div", "precheck-body");
    for (const profile of profiles) {
      const tone = toneOf(snapshot, profile, result);
      const card = el("article", "precheck-row");
      card.setAttribute("data-platform", profile.id);
      card.setAttribute("data-status", tone);
      card.setAttribute("data-env", envId);
      const label = tone === "ok" ? "正常" : tone === "skip" ? "跳过" : "需处理";
      card.append(el("p", "precheck-name", "[" + label + "] " + platformLabel(profile)));
      if (tone === "skip") {
        card.append(el("p", "", "未选择，不参与本次发布"));
        body.append(card);
        continue;
      }
      const account = accounts.find((item) => item.platform === profile.id);
      const login = shownLogin(account?.state || "unknown", account?.checkedAt || "");
      card.append(el("p", "", "环境 " + envId));
      const problems = contentProblems(snapshot, profile);
      card.append(el("p", "", problems.length ? problems.join("；") : "标题与正文未超出规则"));
      card.append(el("p", "", profile.needsCover ? (snapshot.cover ? "封面已选" : "缺封面（必填）") : "封面模式：" + profile.coverMode));
      const required = profile.required.map((item) => item.label).join("、");
      card.append(el("p", "", required ? "必选配置：" + required : "没有额外必选项"));
      card.append(el("p", "", loginLine(login)));
      const tools = el("div", "precheck-tools");
      const settings = el("button", "btn ghost", "去设置");
      settings.type = "button";
      settings.title = "去设置";
      settings.setAttribute("data-action", "go-settings");
      settings.setAttribute("data-platform", profile.id);
      const again = el("button", "btn ghost", "重新核验");
      again.type = "button";
      again.title = "重新核验";
      again.setAttribute("data-action", "recheck");
      again.setAttribute("data-platform", profile.id);
      tools.append(settings, again);
      card.append(tools);
      body.append(card);
    }
    const foot = el("div", "precheck-foot");
    const back = el("button", "btn ghost", "返回修改");
    back.type = "button";
    back.title = "返回修改";
    back.setAttribute("data-action", "close-precheck");
    const go = el("button", "btn primary", ready.length ? "确认发布 " + String(ready.length) + " 个平台" : "没有可发布的平台");
    go.type = "button";
    go.title = go.textContent || "";
    go.setAttribute("data-action", "confirm-publish");
    if (!ready.length) go.setAttribute("disabled", "true");
    const summary = el("p", "", "当前可发布 " + String(ready.length) + " 个平台；需处理的平台默认跳过。");
    const confirmNote = el("p", "");
    confirmNote.setAttribute("data-role", "confirm-note");
    foot.append(back, go);
    dialog.append(head, summary, body, confirmNote, foot);
    backdrop.append(dialog);
    container.append(backdrop);
  }

  function closeDialog(): void {
    const existing = container.querySelector("[data-role=precheck]");
    existing?.parentElement?.removeChild(existing);
  }

  function changeImages(images: string[]): void {
    draft = readDraft();
    draft.images = images;
    fillImages();
    refreshRules();
    invalidate();
    scheduleSave();
  }

  function expand(id: string, forceOpen = false): void {
    const cards = Array.from(container.querySelectorAll("[data-role=card]"));
    const current = cards.find((card) => card.getAttribute("data-platform") === id);
    const willOpen = forceOpen || current?.getAttribute("data-open") !== "true";
    for (const card of cards) {
      const onCard = willOpen && card.getAttribute("data-platform") === id;
      card.setAttribute("data-open", onCard ? "true" : "false");
      const panel = card.querySelector("[data-role=panel]");
      if (panel) (panel as HTMLElement).hidden = !onCard;
      const button = card.querySelector("[data-action=expand]");
      if (button) button.textContent = onCard ? "收起" : "展开";
    }
  }

  function paint(): void {
    clear(container);
    container.setAttribute("data-env", envId);
    const head = el("div", "compose-head");
    const titles = el("div");
    titles.append(el("h1", "", "发稿"), el("p", "muted", "环境：" + (viewModel.envName || envId)));
    const saveNote = el("p", "muted", association === "unlinked" ? "未关联" : "");
    saveNote.setAttribute("data-save-state", association === "unlinked" ? "unsaved" : "saved");
    titles.append(saveNote);
    const records = button("发布记录", "records");
    head.append(titles, records);
    const editor = el("div", "compose-editor");
    editor.append(renderMain(), renderPlatforms(), renderActions());
    const unlinked = viewModel.drafts.filter((item) => (item.association === "unlinked" || !item.envId) && item.id !== draft.id).length;
    container.append(head, editor);
    if (unlinked) container.append(el("p", "muted", "未关联草稿 " + String(unlinked) + " 篇，没有放进当前环境。"));
    fillImages();
    fillCover();
    refreshRules();
  }

  function primarySelect(): HTMLSelectElement {
    const select = el("select");
    select.setAttribute("data-field", "primary");
    for (const profile of profiles) select.append(option(profile.id, platformLabel(profile)));
    select.value = draft.primaryPlatform || profiles[0]?.id || "";
    return select;
  }

  function renderMain(): HTMLElement {
    const main = el("div", "compose-main");
    const list = el("select");
    list.setAttribute("data-field", "draft-list");
    list.setAttribute("aria-label", "已有草稿");
    const owned = viewModel.drafts.filter((item) => item.envId === envId && item.association !== "unlinked");
    const extras = envId === "default"
      ? viewModel.drafts.filter((item) => item.association === "unlinked" || !item.envId)
      : [];
    for (const item of owned) list.append(option(item.id, item.title || item.id));
    for (const item of extras) list.append(option(item.id, (item.title || item.id) + "（未关联）"));
    if (![...owned, ...extras].some((item) => item.id === draft.id)) list.append(option(draft.id, draft.title || draft.id));
    list.value = draft.id;
    main.append(
      labeled("已有草稿", blankCount(), list),
      labeled("标题", countNode("title"), control("input", "title", draft.title)),
      labeled("摘要", countNode("summary"), control("input", "summary", draft.summary)),
      labeled("正文", countNode("body"), control("textarea", "body", draft.body)),
      imageBlock(),
      coverBlock(),
      labeled("首发平台", blankCount(), primarySelect()),
    );
    const limits = el("p", "");
    limits.setAttribute("data-note", "limits");
    main.append(limits);
    return main;
  }

  function renderPlatforms(): HTMLElement {
    const side = el("aside", "compose-side");
    side.append(el("h2", "", "发布平台"));
    for (const profile of profiles) {
      const choice = draft.platforms[profile.id] || { enabled: false };
      const card = el("article", "platform-card");
      card.setAttribute("data-role", "card");
      card.setAttribute("data-platform", profile.id);
      card.setAttribute("data-open", "false");
      const header = el("div", "platform-head");
      const toggle = el("input");
      toggle.type = "checkbox";
      toggle.checked = choice.enabled;
      toggle.title = "选择" + platformLabel(profile);
      toggle.setAttribute("aria-label", "选择" + platformLabel(profile));
      toggle.setAttribute("data-action", "toggle-platform");
      toggle.setAttribute("data-platform", profile.id);
      const name = el("span", "platform-name", platformLabel(profile));
      const complete = el("span", "tag", choice.enabled ? "完整" : "未选择");
      complete.setAttribute("data-role", "complete");
      complete.setAttribute("data-platform", profile.id);
      const gap = el("span", "platform-gap", choice.enabled ? "没有缺项" : "未选择");
      gap.setAttribute("data-role", "gap");
      gap.setAttribute("data-platform", profile.id);
      const opener = button("展开", "expand");
      opener.setAttribute("data-platform", profile.id);
      header.append(toggle, name, complete, gap, opener);
      const panel = el("div", "platform-panel");
      panel.setAttribute("data-role", "panel");
      panel.hidden = true;
      panel.append(
        labeled("平台标题", blankCount(), control("input", "platform-title", choice.title || "", profile.id)),
        textLine("封面模式：" + (profile.coverMode || "未写")),
      );
      const category = control("input", "category", choice.category || "", profile.id);
      panel.append(labeled("分类", blankCount(), category));
      const original = el("select");
      original.setAttribute("data-field", "original");
      original.setAttribute("data-platform", profile.id);
      original.append(option("", "未选择"), option("yes", "原创"), option("no", "非原创"));
      original.value = choice.original == null ? "" : choice.original ? "yes" : "no";
      panel.append(labeled("原创", blankCount(), original));
      for (const item of profile.required) panel.append(checkLine(profile.id, item.id, "确认「" + item.label + "」", (choice.confirmed || []).includes(item.id)));
      for (const item of profile.forbidden) panel.append(checkLine(profile.id, item.id, "勾选「" + item.label + "」", (choice.confirmed || []).includes(item.id)));
      if (profile.defaults.length) {
        panel.append(textLine("不会自动填写：" + profile.defaults.map((item) => item.label).join("、")));
      }
      card.append(header, panel);
      side.append(card);
    }
    return side;
  }

  function renderActions(): HTMLElement {
    const bar = el("div", "compose-actions");
    const left = el("div", "compose-action-left");
    left.append(button("保存", "save"), button("预检", "precheck"));
    bar.append(left, button("检查并发布", "check-publish", "primary"));
    return bar;
  }

  function imageBlock(): HTMLElement {
    const wrap = el("div", "compose-block");
    const tools = el("div", "compose-inline");
    tools.append(el("span", "field-label", "正文图片"), button("选择图片", "pick-body"));
    const host = el("div", "compose-images");
    host.setAttribute("data-role", "images");
    const note = el("p", "muted", "");
    note.setAttribute("data-note", "images");
    wrap.append(tools, host, note);
    return wrap;
  }

  function coverBlock(): HTMLElement {
    const wrap = el("div", "compose-block");
    const tools = el("div", "compose-inline");
    tools.append(el("span", "field-label", "封面"), button("选择封面", "pick-cover"), button("移除封面", "clear-cover"));
    const preview = el("div", "compose-cover");
    preview.setAttribute("data-role", "cover");
    wrap.append(tools, preview);
    return wrap;
  }

  function fillImages(): void {
    const host = container.querySelector("[data-role=images]");
    if (!host) return;
    clear(host as HTMLElement);
    draft.images.forEach((file, index) => {
      const row = el("div", "compose-image");
      row.setAttribute("data-role", "image");
      row.setAttribute("data-name", imageName(file));
      const img = el("img");
      img.alt = imageName(file);
      img.src = file;
      img.setAttribute("data-name", imageName(file));
      const name = el("span", "name", imageName(file));
      const up = button("上移", "move-image");
      up.setAttribute("data-dir", "up");
      up.setAttribute("data-index", String(index));
      if (index === 0) up.setAttribute("disabled", "true");
      const down = button("下移", "move-image");
      down.setAttribute("data-dir", "down");
      down.setAttribute("data-index", String(index));
      if (index === draft.images.length - 1) down.setAttribute("disabled", "true");
      const remove = button("移除", "remove-image");
      remove.setAttribute("data-index", String(index));
      row.append(img, name, up, down, remove);
      host.append(row);
    });
  }

  function fillCover(): void {
    const host = container.querySelector("[data-role=cover]");
    if (!host) return;
    clear(host as HTMLElement);
    if (!draft.cover) {
      host.append(el("p", "muted", "还没有封面"));
      return;
    }
    const img = el("img");
    img.alt = imageName(draft.cover);
    img.src = draft.cover;
    img.setAttribute("data-role", "cover-preview");
    img.setAttribute("data-name", imageName(draft.cover));
    host.append(img, el("span", "", imageName(draft.cover)));
  }

  function refreshRules(): void {
    const titleMax = tightest("titleMax");
    const bodyMax = tightest("bodyMax");
    setCount("title", countChars(draft.title), titleMax);
    setCount("summary", countChars(draft.summary), null);
    setCount("body", countChars(draft.body), bodyMax);
    const notes: string[] = [];
    for (const profile of profiles) {
      const problems = contentProblems(draft, profile);
      const complete = container.querySelector(`[data-role=complete][data-platform="${profile.id}"]`);
      const gap = container.querySelector(`[data-role=gap][data-platform="${profile.id}"]`);
      const enabled = Boolean(draft.platforms[profile.id]?.enabled);
      if (complete) {
        complete.textContent = !enabled ? "未选择" : problems[0] ? "待补充" : "完整";
        complete.setAttribute("data-state", !enabled ? "unknown" : problems.length ? "partial" : "ok");
      }
      if (gap) gap.textContent = !enabled ? "未选择" : problems[0] || "没有缺项";
      if (problems.some((item) => item.startsWith("标题超过"))) notes.push(platformLabel(profile) + "：" + problems.find((item) => item.startsWith("标题超过")));
    }
    const titleInput = container.querySelector('[data-field="title"]');
    if (titleInput) {
      if (notes.length) titleInput.setAttribute("data-over", "true");
      else titleInput.removeAttribute("data-over");
    }
    const note = container.querySelector('[data-note="limits"]');
    if (note) note.textContent = notes.join("；");
  }

  function tightest(key: "titleMax" | "bodyMax"): number | null {
    let max: number | null = null;
    for (const profile of profiles) {
      if (!draft.platforms[profile.id]?.enabled) continue;
      const limit = profile[key];
      if (limit == null) continue;
      if (max == null || limit < max) max = limit;
    }
    return max;
  }

  function setCount(name: string, count: number, max: number | null): void {
    const node = container.querySelector(`[data-count="${name}"]`);
    if (!node) return;
    node.textContent = max == null ? String(count) + " 字" : String(count) + "/" + String(max);
    if (max != null && count > max) node.setAttribute("data-over", "true");
    else node.removeAttribute("data-over");
  }

  function readDraft(): ComposeDraft {
    const next: ComposeDraft = {
      ...draft,
      title: textValue("title", draft.title),
      summary: textValue("summary", draft.summary),
      body: textValue("body", draft.body),
      images: [...draft.images],
      cover: draft.cover,
      topics: [...draft.topics],
      primaryPlatform: textValue("primary", draft.primaryPlatform),
      platforms: {},
      schedule: {},
      envId: draft.envId,
      association: draft.association,
      revision,
    };
    for (const profile of profiles) {
      const prev = draft.platforms[profile.id] || { enabled: false };
      const toggle = box(`[data-action="toggle-platform"][data-platform="${profile.id}"]`);
      const confirmed: string[] = [];
      for (const item of [...profile.required, ...profile.forbidden]) {
        const input = box(`[data-field="confirm"][data-platform="${profile.id}"][data-switch="${item.id}"]`);
        if (input?.checked) confirmed.push(item.id);
      }
      const originalValue = textValue("original", "", profile.id);
      next.platforms[profile.id] = {
        enabled: toggle ? toggle.checked : prev.enabled,
        title: textValue("platform-title", prev.title || "", profile.id),
        category: textValue("category", prev.category || "", profile.id),
        original: originalValue === "yes" ? true : originalValue === "no" ? false : null,
        confirmed,
      };
    }
    return next;
  }

  function textValue(field: string, fallback: string, platform = ""): string {
    const selector = platform
      ? `[data-field="${field}"][data-platform="${platform}"]`
      : `[data-field="${field}"]`;
    const node = container.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;
    return node ? node.value : fallback;
  }

  function box(selector: string): HTMLInputElement | null {
    return container.querySelector(selector) as HTMLInputElement | null;
  }
}

function cloneDraft(draft: ComposeDraft): ComposeDraft {
  return {
    ...draft,
    images: [...draft.images],
    topics: [...draft.topics],
    platforms: Object.fromEntries(Object.entries(draft.platforms).map(([id, item]) => [id, { ...item, confirmed: [...(item.confirmed || [])] }])),
    schedule: {},
  };
}

function button(text: string, action: string, tone = "ghost"): HTMLButtonElement {
  const node = el("button", tone === "primary" ? "btn primary" : "btn ghost", text);
  node.type = "button";
  node.title = text;
  node.setAttribute("data-action", action);
  return node;
}

function option(value: string, text: string): HTMLOptionElement {
  const node = el("option", "", text);
  node.value = value;
  return node;
}

function control(tag: "input" | "textarea", field: string, value: string, platform = ""): HTMLInputElement | HTMLTextAreaElement {
  const node = el(tag);
  node.setAttribute("data-field", field);
  if (platform) node.setAttribute("data-platform", platform);
  node.value = value;
  return node;
}

function countNode(name: string): HTMLElement {
  const node = el("span", "field-count", "");
  node.setAttribute("data-count", name);
  return node;
}

function blankCount(): HTMLElement {
  return el("span", "field-count", "");
}

function labeled(name: string, count: HTMLElement, controlNode: HTMLElement): HTMLElement {
  const wrap = el("label", "field");
  const head = el("span", "field-line");
  head.append(el("span", "field-label", name), count);
  wrap.append(head, controlNode);
  return wrap;
}

function textLine(text: string): HTMLElement {
  return el("p", "muted", text);
}

function checkLine(platform: string, id: string, label: string, checked: boolean): HTMLElement {
  const wrap = el("label", "check-line");
  const input = el("input");
  input.type = "checkbox";
  input.checked = checked;
  input.setAttribute("data-field", "confirm");
  input.setAttribute("data-platform", platform);
  input.setAttribute("data-switch", id);
  wrap.append(input, el("span", "", label));
  return wrap;
}
