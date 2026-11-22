/**
 * 指挥室编排。只决定该调哪一个现有动作。
 * 不碰网页，不自己跑任务，父任务也不占页面。
 * 词表法总会漏掉新说法。后续可以把 dispatch-many 做成 Free Soul 工具，让模型自己决定要不要拆页，这里先不实现。
 */

export type CommandPage = {
  tabId: string;
  title: string;
  taskId: string;
  state: string;
};

export type CommandTask = {
  id: string;
  tabId: string;
  title: string;
  state: string;
  clientId?: string;
};

export type CommandAction =
  | { type: "open"; url?: string }
  | { type: "focus"; tabId?: string; title?: string; taskId?: string }
  | { type: "dispatch"; text: string; tabId?: string; title?: string }
  | { type: "dispatch-many"; title: string; items: Array<{ title: string; text: string; url?: string }> }
  | { type: "stop"; taskId?: string; title?: string }
  | { type: "resume"; taskId?: string; title?: string }
  | { type: "close"; taskId?: string; title?: string; confirmed?: boolean }
  | { type: "ack"; taskId?: string; title?: string };

export type CommandChoice = { tabId: string; title: string; taskId: string; state: string };

export type CommandResult =
  | { ok: true; message: string; tabId?: string; taskId?: string }
  | { ok: false; message: string; code: "ambiguous" | "missing" | "tab_busy" | "confirm" | "blocked"; choices?: CommandChoice[] };

export type CommandPorts = {
  openTab: (url?: string) => { ok: boolean; tabId?: string; message: string };
  focusTask: (taskId: string) => { ok: boolean; tabId?: string; message: string };
  switchTab: (tabId: string) => { ok: boolean; message: string };
  dispatch: (tabId: string | undefined, text: string) => { ok: boolean; taskId?: string; error?: string; message: string };
  stopTask: (taskId: string) => { ok: boolean; message: string };
  resumeTask: (taskId: string) => { ok: boolean; tabId?: string; message: string };
  closeTask: (taskId: string) => { ok: boolean; message: string };
  ackTask: (taskId: string) => { ok: boolean; message: string };
};

export type TaskGroup = {
  groupId: string;
  title: string;
  childTaskIds: string[];
  createdAt: number;
  /** 整组进入终态后写出的 HTML 报告。 */
  reportPath?: string;
};

export type GroupChild = {
  id: string;
  tabId: string;
  state: string;
  unfinished?: string[];
  attention?: boolean;
};

const LIVE = new Set(["running", "queued", "waiting_human"]);

function choicesOf(rows: CommandChoice[]): CommandChoice[] {
  return rows.map((row) => ({ ...row }));
}

function matchPages(pages: CommandPage[], hint: { tabId?: string; title?: string; taskId?: string }): CommandPage[] {
  const tabId = String(hint.tabId || "").trim();
  const taskId = String(hint.taskId || "").trim();
  const title = String(hint.title || "").trim();
  if (tabId) return pages.filter((page) => page.tabId === tabId);
  if (taskId) return pages.filter((page) => page.taskId === taskId);
  if (!title) return [];
  const exact = pages.filter((page) => page.title === title || page.tabId === title || page.taskId === title);
  if (exact.length || title.length < 2) return exact;
  return pages.filter((page) => page.title.includes(title));
}

function resolveOne(
  pages: CommandPage[],
  hint: { tabId?: string; title?: string; taskId?: string },
): { ok: true; page: CommandPage } | { ok: false; result: CommandResult } {
  const hits = matchPages(pages, hint);
  if (hits.length === 1 && hits[0]) return { ok: true, page: hits[0] };
  if (hits.length === 0) return { ok: false, result: { ok: false, code: "missing", message: "没有找到这个页面" } };
  return {
    ok: false,
    result: { ok: false, code: "ambiguous", message: "有多个同名页面，请选定一个", choices: choicesOf(hits) },
  };
}

/** 执行一条已经结构化的指挥命令。含糊目标只返回候选，不猜测当前页。 */
export function runCommand(action: CommandAction, pages: CommandPage[], ports: CommandPorts): CommandResult {
  if (action.type === "dispatch-many") {
    return { ok: false, code: "blocked", message: "跨页分派要由指挥室拆开并建组" };
  }
  if (action.type === "open") {
    const opened = ports.openTab(action.url);
    return opened.ok
      ? { ok: true, message: opened.message, tabId: opened.tabId }
      : { ok: false, code: "blocked", message: opened.message };
  }
  if (action.type === "focus") {
    const found = resolveOne(pages, action);
    if (!found.ok) return found.result;
    if (found.page.taskId) {
      const focused = ports.focusTask(found.page.taskId);
      return focused.ok
        ? { ok: true, message: focused.message, tabId: focused.tabId || found.page.tabId, taskId: found.page.taskId }
        : { ok: false, code: "blocked", message: focused.message };
    }
    const switched = ports.switchTab(found.page.tabId);
    return switched.ok
      ? { ok: true, message: switched.message, tabId: found.page.tabId }
      : { ok: false, code: "blocked", message: switched.message };
  }
  if (action.type === "dispatch") {
    if (action.tabId || action.title) {
      const found = resolveOne(pages, action);
      if (!found.ok) return found.result;
      if (found.page.state !== "idle") {
        return { ok: false, code: "tab_busy", message: "这个页面正忙，不能再派任务" };
      }
      const sent = ports.dispatch(found.page.tabId, action.text);
      if (!sent.ok || sent.error === "tab_busy") {
        return { ok: false, code: "tab_busy", message: sent.message || "这个页面正忙" };
      }
      return { ok: true, message: sent.message, tabId: found.page.tabId, taskId: sent.taskId };
    }
    const opened = ports.openTab(undefined);
    if (!opened.ok || !opened.tabId) return { ok: false, code: "blocked", message: opened.message || "没能打开新页面" };
    const sent = ports.dispatch(opened.tabId, action.text);
    if (!sent.ok) return { ok: false, code: "blocked", message: sent.message };
    return { ok: true, message: sent.message, tabId: opened.tabId, taskId: sent.taskId };
  }
  if (action.type === "stop" || action.type === "resume" || action.type === "ack") {
    const found = resolveOne(pages, action);
    if (!found.ok) return found.result;
    if (!found.page.taskId) return { ok: false, code: "missing", message: "这个页面没有任务" };
    if (action.type === "stop") {
      const stopped = ports.stopTask(found.page.taskId);
      return stopped.ok
        ? { ok: true, message: stopped.message, tabId: found.page.tabId, taskId: found.page.taskId }
        : { ok: false, code: "blocked", message: stopped.message };
    }
    if (action.type === "resume") {
      const resumed = ports.resumeTask(found.page.taskId);
      return resumed.ok
        ? { ok: true, message: resumed.message, tabId: resumed.tabId || found.page.tabId, taskId: found.page.taskId }
        : { ok: false, code: "blocked", message: resumed.message };
    }
    const acked = ports.ackTask(found.page.taskId);
    return acked.ok
      ? { ok: true, message: acked.message, tabId: found.page.tabId, taskId: found.page.taskId }
      : { ok: false, code: "blocked", message: acked.message };
  }
  const found = resolveOne(pages, action);
  if (!found.ok) return found.result;
  if (!found.page.taskId) return { ok: false, code: "missing", message: "这个页面没有任务" };
  if (LIVE.has(found.page.state) && !action.confirmed) {
    return {
      ok: false,
      code: "confirm",
      message: "这个页面还在进行。确认后会先停止，再结束并关闭。",
      choices: choicesOf([found.page]),
    };
  }
  const closed = ports.closeTask(found.page.taskId);
  return closed.ok
    ? { ok: true, message: closed.message, tabId: found.page.tabId, taskId: found.page.taskId }
    : { ok: false, code: "blocked", message: closed.message };
}

/** 父级状态只从子任务推导。有失败或未完成项时，不能说全部完成。 */
export function summarizeGroup(children: GroupChild[]): {
  allDone: boolean;
  headline: string;
  tone: "green" | "red" | "yellow" | "gray";
} {
  if (!children.length) return { allDone: false, headline: "还没有子任务", tone: "gray" };
  const failed = children.some((child) => child.state === "failed" || (child.unfinished || []).length > 0);
  if (failed) return { allDone: false, headline: "有页面异常或未完成", tone: "red" };
  if (children.some((child) => child.state === "waiting_human")) {
    return { allDone: false, headline: "有页面等待人工", tone: "yellow" };
  }
  if (children.some((child) => child.state === "running" || child.state === "queued")) {
    return { allDone: false, headline: "进行中", tone: "green" };
  }
  if (children.every((child) => child.state === "done" || child.state === "closed")) {
    return { allDone: true, headline: "全部完成", tone: "gray" };
  }
  if (children.some((child) => child.state === "stopped")) {
    return { allDone: false, headline: "有页面已停止", tone: "gray" };
  }
  return { allDone: false, headline: "未完成", tone: "gray" };
}

/** 点名才算目标。没点名的「多平台 / 多站点」用这个默认两站，登记在决策点。 */
const DEFAULT_BATCH_SITES = ["京东", "淘宝"] as const;

type BatchSite = { name: string; home: string; search?: string };

/** 搜索模板里的 {q} 换成关键词。没有搜索模板的站点只用首页。 */
const BATCH_SITES: BatchSite[] = [
  { name: "京东", home: "https://www.jd.com/", search: "https://search.jd.com/Search?keyword={q}" },
  { name: "淘宝", home: "https://www.taobao.com/", search: "https://s.taobao.com/search?q={q}" },
  { name: "天猫", home: "https://www.tmall.com/" },
  { name: "1688", home: "https://www.1688.com/", search: "https://s.1688.com/selloffer/offer_search.htm?keywords={q}" },
  { name: "拼多多", home: "https://www.pinduoduo.com/", search: "https://mobile.yangkeduo.com/search_result.html?search_key={q}" },
  { name: "苏宁", home: "https://www.suning.com/", search: "https://search.suning.com/{q}/" },
  { name: "小红书", home: "https://www.xiaohongshu.com/" },
  { name: "唯品会", home: "https://www.vip.com/" },
  { name: "闲鱼", home: "https://www.goofish.com/" },
  { name: "微博", home: "https://weibo.com/" },
  { name: "知乎", home: "https://www.zhihu.com/" },
  { name: "美团", home: "https://www.meituan.com/" },
  { name: "百度", home: "https://www.baidu.com/" },
  { name: "抖音", home: "https://www.douyin.com/" },
  { name: "快手", home: "https://www.kuaishou.com/" },
];

/** 比价 / 查 / 查询 / 打开 / 看 / 搜 / 对比 / 比。比如不算比。 */
const BATCH_ACTION = /比价|查询|对比|搜索|看看|打开|查|看|搜|比(?!如)/;

function splitPageNames(raw: string): string[] {
  return raw.split(/、|，|和/).map((part) => part.trim()).filter(Boolean);
}

function uniqueSites(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of names) {
    if (seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

/** 按出现顺序抽出词表里的站点。重叠时留先出现的。 */
function sitesIn(raw: string): string[] {
  const hits: Array<{ name: string; at: number }> = [];
  for (const name of BATCH_SITES.map((site) => site.name)) {
    let from = 0;
    while (from < raw.length) {
      const at = raw.indexOf(name, from);
      if (at < 0) break;
      hits.push({ name, at });
      from = at + name.length;
    }
  }
  hits.sort((a, b) => a.at - b.at || b.name.length - a.name.length);
  const out: string[] = [];
  let cursor = -1;
  for (const hit of hits) {
    if (hit.at < cursor) continue;
    out.push(hit.name);
    cursor = hit.at + hit.name.length;
  }
  return uniqueSites(out);
}

function hasBatchCue(raw: string): boolean {
  return BATCH_ACTION.test(raw) || /都|各|分别/.test(raw);
}

function sharedTaskText(raw: string, sites: string[]): string {
  let text = raw.replace(/^同时/, "").replace(/^(?:多平台|多站点)/, "");
  for (const site of sites) text = text.split(site).join(" ");
  text = text.replace(/[、，,和与及]/g, " ").replace(/\s+/g, " ").trim();
  return text || raw;
}

/** 从共同任务句里取出搜索词。比价 iPhone 17 → iPhone 17。只剩动作词就为空。 */
export function batchQuery(taskText: string): string {
  return String(taskText || "")
    .replace(/查一下|比价|查询|对比|搜索|看看|打开|都|各|分别|一下/g, " ")
    .replace(/查|看|搜/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** 批量开页用的地址。有搜索词走搜索页，没有就落该站首页。未知名字没有地址。 */
export function openUrlForSite(name: string, taskText: string): string | undefined {
  const site = BATCH_SITES.find((item) => item.name === name);
  if (!site) return undefined;
  const query = batchQuery(taskText);
  if (site.search && query) return site.search.replaceAll("{q}", encodeURIComponent(query));
  return site.home;
}

function dispatchMany(
  raw: string,
  items: Array<{ title: string; text: string; url?: string }>,
): CommandAction | null {
  if (items.length < 2) return null;
  return {
    type: "dispatch-many",
    title: raw.slice(0, 40),
    items: items.map((item) => {
      if (item.url) return item;
      const url = openUrlForSite(item.title, item.text);
      return url ? { ...item, url } : item;
    }),
  };
}

/**
 * 先把每一页对上。
 * 有空闲同名页就复用。同名页都在忙则整组不派。
 * 一个同名页都没有时 tabId 留空，调用方开新页，不再报 missing。
 */
export function resolveGroupTargets(
  pages: CommandPage[],
  items: Array<{ title: string; text: string; url?: string }>,
): { ok: true; targets: Array<{ tabId: string; title: string; text: string; url?: string }> } | { ok: false; result: CommandResult } {
  if (items.length < 2) {
    return { ok: false, result: { ok: false, code: "missing", message: "跨页任务至少要两个页面" } };
  }
  const targets: Array<{ tabId: string; title: string; text: string; url?: string }> = [];
  for (const item of items) {
    const hits = matchPages(pages, { title: item.title });
    const idle = hits.filter((page) => page.state === "idle");
    if (idle.length > 1) {
      return {
        ok: false,
        result: { ok: false, code: "ambiguous", message: "有多个同名页面，请选定一个", choices: choicesOf(idle) },
      };
    }
    if (idle.length === 1 && idle[0]) {
      if (targets.some((target) => target.tabId && target.tabId === idle[0].tabId)) {
        return { ok: false, result: { ok: false, code: "ambiguous", message: "同一页不能接两个子任务" } };
      }
      targets.push({ tabId: idle[0].tabId, title: idle[0].title, text: item.text, url: item.url });
      continue;
    }
    if (hits.length > 0) {
      const name = hits[0]?.title || item.title;
      return { ok: false, result: { ok: false, code: "tab_busy", message: `${name}正忙，不能并进这一组` } };
    }
    if (targets.some((target) => !target.tabId && target.title === item.title)) {
      return { ok: false, result: { ok: false, code: "ambiguous", message: "同一页不能接两个子任务" } };
    }
    targets.push({ tabId: "", title: item.title, text: item.text, url: item.url });
  }
  return { ok: true, targets };
}

/** 「停止 京东」「把刚才京东那页停掉」都是停任务，不是关标签。 */
function stopTarget(raw: string): string | null {
  const direct = /^(?:停止|停掉|停下)\s*(.+)$/.exec(raw);
  if (direct?.[1]?.trim()) return direct[1].trim();
  const wrapped = /^(?:把|将)(?:刚才)?(.+?)(?:那一?页|这个页面?)?停(?:掉|下|了)$/.exec(raw);
  const title = wrapped?.[1]?.trim();
  return title || null;
}

/** 总指挥聊天里能直接执行的句子。对不上就返回 null，交给原来的对话。 */
export function parseCommandUtterance(text: string): CommandAction | null {
  const raw = String(text || "").trim();
  const simultaneous = parseSimultaneous(raw);
  if (simultaneous) return simultaneous;
  const open = /^打开\s+(https?:\/\/\S+)/i.exec(raw);
  if (open?.[1]) return { type: "open", url: open[1] };
  const confirmClose = /^确认关闭\s+(.+)$/.exec(raw);
  if (confirmClose?.[1]) return { type: "close", title: confirmClose[1].trim(), confirmed: true };
  const close = /^关闭\s+(.+)$/.exec(raw);
  if (close?.[1]) return { type: "close", title: close[1].trim() };
  const stopped = stopTarget(raw);
  if (stopped) return { type: "stop", title: stopped };
  const resume = /^继续\s+(.+)$/.exec(raw);
  if (resume?.[1]) return { type: "resume", title: resume[1].trim() };
  const focus = /^(?:定位|看看)\s+(.+)$/.exec(raw);
  if (focus?.[1]) return { type: "focus", title: focus[1].trim() };
  const dispatch = /^在\s+(.+?)\s+做\s+(.+)$/.exec(raw);
  if (dispatch?.[1] && dispatch[2]) return { type: "dispatch", title: dispatch[1].trim(), text: dispatch[2].trim() };
  return null;
}

/** 句首「同时」的原有两类：每页各做一件事，或同时改几页。对不上就返回 null，交给后面的列举句。 */
function parseLegacySimultaneous(raw: string): CommandAction | null {
  if (!raw.startsWith("同时")) return null;
  const detailed = /^同时(?:在)?(.+)$/.exec(raw);
  if (detailed?.[1]?.includes("做")) {
    const parts = detailed[1].split(/[、，和]/).map((part) => part.trim()).filter(Boolean);
    const items: Array<{ title: string; text: string }> = [];
    let parsed = true;
    for (const part of parts) {
      const step = /^(?:在)?(.+?)做(.+)$/.exec(part);
      if (!step?.[1] || !step[2]) {
        parsed = false;
        break;
      }
      items.push({ title: step[1].trim(), text: step[2].trim() });
    }
    if (parsed && items.length >= 2) return dispatchMany(raw, items);
  }
  const named = /^同时改(.+?)(?:：|:)(.+)$/.exec(raw);
  if (named?.[1] && named[2]) {
    const names = splitPageNames(named[1]);
    return dispatchMany(raw, names.map((title) => ({ title, text: named[2].trim() })));
  }
  const bare = /^同时改(.+)$/.exec(raw);
  if (!bare?.[1]) return null;
  const names = splitPageNames(bare[1]);
  return dispatchMany(raw, names.map((title) => ({ title, text: `改${title}` })));
}

/** 平台/网站/电商，配上多、各、不同、各大。不要求句首。 */
function mentionsManySites(raw: string): boolean {
  return /多平台|多站点|不同平台|不同网站|不同的?电商|各平台|各网站|各电商|多个平台|多个网站|各大平台|各大网站/.test(raw);
}

/**
 * 多目标列举，或「多个/不同/各大 + 平台、网站、电商」。
 * 纯词表，不调用模型。付款和发布不在这里执行，拆开后仍走原来的任务门禁。
 */
function parseListedBatch(raw: string): CommandAction | null {
  if (/^打开\s+https?:\/\//i.test(raw)) return null;
  if (!hasBatchCue(raw)) return null;
  let sites = sitesIn(raw);
  if (mentionsManySites(raw) && sites.length < 2) sites = [...DEFAULT_BATCH_SITES];
  if (sites.length < 2) return null;
  const text = sharedTaskText(raw, sites);
  return dispatchMany(raw, sites.map((title) => ({ title, text })));
}

function parseSimultaneous(raw: string): CommandAction | null {
  return parseLegacySimultaneous(raw) || parseListedBatch(raw);
}
