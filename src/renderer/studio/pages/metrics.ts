// 数据页。只画已有快照，刷新交给 PageActions，不直接请求平台。
import "./metrics.css";
import { clear, createPageSession, el, on } from "../dom.js";
import type {
  AsyncView,
  Completeness,
  DisplayState,
  MetricFact,
  MetricsViewModel,
  PageActions,
  PageMount,
} from "../types.js";

export const PLATFORM_NAMES: Record<string, string> = {
  toutiao: "头条号",
  baijiahao: "百家号",
  dayu: "大鱼号",
  sohu: "搜狐号",
};

export const REFRESH_COOLDOWN_MS = 5 * 60 * 1000;

export type TrendPoint = MetricsViewModel["trend"][number] & {
  completeness?: Completeness;
  revenueCents?: number | null;
  likes?: number | null;
  reason?: string;
  capturedAt?: string;
  source?: string;
};

export type RankRow = MetricsViewModel["ranking"][number] & {
  interaction?: number | null;
  publishedAt?: string;
  reason?: string;
  capturedAt?: string;
  source?: string;
  date?: string;
  state?: DisplayState | Completeness;
};

export type CompareRow = MetricsViewModel["compare"][number] & {
  reason?: string;
  follows?: number | null;
  capturedAt?: string;
  source?: string;
  date?: string;
};

export type RevenueRow = MetricsViewModel["revenueSplit"][number] & {
  cents?: number | null;
  ad?: number | null;
  activity?: number | null;
  subsidy?: number | null;
  reason?: string;
  capturedAt?: string;
  source?: string;
  date?: string;
};

export type ExceptionRow = MetricsViewModel["exceptions"][number] & {
  state?: DisplayState | Completeness;
  summary?: string;
  next?: string;
  capturedAt?: string;
  source?: string;
  date?: string;
};

export type MetricsPageModel = Omit<MetricsViewModel, "trend" | "ranking" | "compare" | "revenueSplit" | "exceptions"> & {
  trend: TrendPoint[];
  ranking: RankRow[];
  compare: CompareRow[];
  revenueSplit: RevenueRow[];
  exceptions: ExceptionRow[];
  hideDelta?: boolean;
  deltaText?: string;
  month?: string;
  today?: string;
  notice?: string;
  cooldownMs?: number;
  metricsKnown?: boolean;
};

export type MetricsInput = MetricsPageModel | AsyncView<MetricsPageModel>;

type Summary = {
  reads: number | null;
  follows: number | null;
  revenueCents: number | null;
  partial: boolean;
  deltaText: string;
};

type ExceptionView = {
  title: string;
  hint: string;
  action: "refresh" | "retry" | "login" | "verify" | "detail" | "none";
  actionLabel: string;
};

export function platformName(id: string): string {
  return PLATFORM_NAMES[id] || id || "未知平台";
}

export function formatInt(value: number): string {
  const negative = value < 0;
  const digits = String(Math.trunc(Math.abs(value)));
  let out = "";
  for (let index = 0; index < digits.length; index += 1) {
    if (index > 0 && (digits.length - index) % 3 === 0) out += ",";
    out += digits[index];
  }
  return (negative ? "-" : "") + out;
}

export function displayCount(value: number | null | undefined, completeness?: string): string {
  if (completeness === "missing" || completeness === "unsupported") return "—";
  if (value == null) return "—";
  return formatInt(value);
}

export function displayFollows(value: number | null | undefined, completeness?: string): string {
  if (completeness === "missing" || completeness === "unsupported") return "—";
  if (value == null) return "—";
  if (value > 0) return "+" + formatInt(value);
  return formatInt(value);
}

export function displayCents(cents: number | null | undefined, completeness?: string): string {
  if (completeness === "missing" || completeness === "unsupported") return "—";
  if (cents == null) return "—";
  const negative = cents < 0;
  const abs = Math.abs(Math.trunc(cents));
  const yuan = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, "0");
  return (negative ? "-" : "") + "¥" + formatInt(yuan) + "." + frac;
}

export function formatStamp(value: string): string {
  const matched = /(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(value || "");
  if (matched) return matched[2] + "-" + matched[3] + " " + matched[4] + ":" + matched[5];
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || "");
  if (day) return day[2] + "-" + day[3];
  return value || "";
}

export function shiftDay(day: string, delta: number): string {
  const matched = /^(\d{4})-(\d{2})-(\d{2})/.exec(day);
  if (!matched) return day;
  const date = new Date(Number(matched[1]), Number(matched[2]) - 1, Number(matched[3]));
  date.setDate(date.getDate() + delta);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const dayNum = String(date.getDate()).padStart(2, "0");
  return date.getFullYear() + "-" + month + "-" + dayNum;
}

export function completenessLabel(value: string): string {
  switch (value) {
    case "full": return "完整";
    case "partial": return "部分数据";
    case "missing": return "未获取";
    case "unsupported": return "不支持";
    case "stale": return "未更新";
    case "login_missing": return "登录失效";
    case "error": return "接口错误";
    case "unknown": return "未核验";
    default: return "未获取";
  }
}

export function exceptionCopy(state: string): ExceptionView {
  switch (state) {
    case "stale":
      return { title: "未更新", hint: "这组数还停在上次采集，可以再读一次。", action: "refresh", actionLabel: "刷新" };
    case "login_missing":
      return { title: "登录失效", hint: "这个平台的登录态失效了，其他平台照常显示。", action: "login", actionLabel: "重新登录" };
    case "error":
      return { title: "接口错误", hint: "请求失败了。旧快照还在，没有清成 0。", action: "retry", actionLabel: "保留并重试" };
    case "unknown":
      return { title: "未核验", hint: "还不能确认这组数，不能当成已经是 0。", action: "verify", actionLabel: "去核验" };
    case "missing":
      return { title: "未获取", hint: "没有拿到这项数据，不会按 0 参加合计。", action: "retry", actionLabel: "重试" };
    case "unsupported":
      return { title: "不支持", hint: "这个平台不提供这项数据，不是取失败。", action: "none", actionLabel: "" };
    case "partial":
      return { title: "部分数据", hint: "有的字段没对上。缺的留空，不写成 0。", action: "detail", actionLabel: "查看缺项" };
    default:
      return { title: "完整", hint: "这项已经拿到。", action: "none", actionLabel: "" };
  }
}

export function keptSnapshotMessage(capturedAt: string): string {
  const stamp = formatStamp(capturedAt);
  return stamp ? "未获取到新数据，仍显示 " + stamp + " 的结果" : "未获取到新数据，仍显示原时间结果";
}

function knownMetric(value: number | null | undefined, completeness?: string): number | null {
  if (completeness === "missing" || completeness === "unsupported") return null;
  if (value == null) return null;
  return value;
}

function sum(values: Array<number | null>): number | null {
  const present = values.filter((value): value is number => value != null);
  if (!present.length) return null;
  return present.reduce((total, value) => total + value, 0);
}

export function centsOf(point: { revenueCents?: number | null; revenue?: string | null; completeness?: string }): number | null {
  if (point.completeness === "missing" || point.completeness === "unsupported") return null;
  if (point.revenueCents != null) return point.revenueCents;
  if (point.revenue == null || !/^-?\d+(\.\d+)?$/.test(point.revenue)) return null;
  const yuan = Number(point.revenue);
  if (!Number.isFinite(yuan)) return null;
  return Math.round(yuan * 100);
}

export function trendSegments(points: Array<{ date: string; value: number | null }>): {
  status: "empty" | "single" | "line";
  segments: Array<Array<{ date: string; value: number }>>;
} {
  const byDate = new Map<string, number | null>();
  for (const point of points) {
    if (!point.date) continue;
    if (point.value == null) {
      if (!byDate.has(point.date)) byDate.set(point.date, null);
      continue;
    }
    byDate.set(point.date, point.value);
  }
  const dates = [...byDate.keys()].sort();
  const present = dates.filter((date) => byDate.get(date) != null);
  if (!present.length) return { status: "empty", segments: [] };
  if (present.length < 2) return { status: "single", segments: [] };
  const segments: Array<Array<{ date: string; value: number }>> = [];
  let current: Array<{ date: string; value: number }> = [];
  for (const date of dates) {
    const value = byDate.get(date);
    if (value == null) {
      if (current.length) segments.push(current);
      current = [];
      continue;
    }
    const previous = current[current.length - 1];
    if (previous && shiftDay(previous.date, 1) !== date) {
      segments.push(current);
      current = [];
    }
    current.push({ date, value });
  }
  if (current.length) segments.push(current);
  return { status: "line", segments };
}

function deltaOf(points: TrendPoint[]): string {
  const byDate = new Map<string, Array<number | null>>();
  for (const point of points) {
    if (!point.date) continue;
    const list = byDate.get(point.date) || [];
    list.push(knownMetric(point.reads, point.completeness));
    byDate.set(point.date, list);
  }
  const dates = [...byDate.keys()].sort();
  if (dates.length < 2) return "";
  const latest = dates[dates.length - 1];
  const previous = shiftDay(latest, -1);
  if (!byDate.has(previous)) return "";
  const latestSum = sum(byDate.get(latest) || []);
  const previousSum = sum(byDate.get(previous) || []);
  if (latestSum == null || previousSum == null || previousSum === 0) return "";
  const pct = Math.round(((latestSum - previousSum) / Math.abs(previousSum)) * 100);
  return (pct > 0 ? "+" : "") + String(pct) + "%";
}

export function summarizeWindow(points: TrendPoint[]): Summary {
  const partial = points.some((point) => point.completeness === "partial");
  return {
    reads: sum(points.map((point) => knownMetric(point.reads, point.completeness))),
    follows: sum(points.map((point) => knownMetric(point.follows, point.completeness))),
    revenueCents: sum(points.map((point) => centsOf(point))),
    partial,
    deltaText: partial ? "" : deltaOf(points),
  };
}

function isAsync(input: MetricsInput): input is AsyncView<MetricsPageModel> {
  return Boolean(input) && typeof input === "object" && "status" in input && !("trend" in input);
}

function emptyModel(envId: string): MetricsPageModel {
  return {
    envId,
    capturedAt: "",
    overview: { reads: null, follows: null, revenue: null },
    trend: [],
    ranking: [],
    compare: [],
    revenueSplit: [],
    exceptions: [],
    metricsKnown: false,
  };
}

export function readMetricsInput(input: MetricsInput): { model: MetricsPageModel; banner: string } {
  if (!isAsync(input)) return { model: input, banner: input.notice || "" };
  if (input.status === "ready") return { model: input.value, banner: input.value.notice || "" };
  if (input.status === "loading") return { model: emptyModel(""), banner: "正在读取已有快照" };
  if (input.status === "empty") return { model: emptyModel(""), banner: input.reason || "还没有这个环境的数据快照，不会把缺失显示成 0。" };
  const banner = input.message || "数据没有读出来";
  if (input.previous) return { model: input.previous, banner };
  return { model: emptyModel(""), banner };
}

function endDay(model: MetricsPageModel): string {
  if (model.today) return model.today;
  const dates = model.trend.map((point) => point.date).filter(Boolean).sort();
  return dates[dates.length - 1] || "";
}

function snapshotKnown(model: MetricsPageModel): boolean {
  if (model.metricsKnown === false) return false;
  return Boolean(model.capturedAt || model.trend.length || model.ranking.length || model.compare.length || model.revenueSplit.length || model.exceptions.length);
}

function trace(source: string, completeness: string, capturedAt: string): string {
  return "来源 " + (source || "本地快照") + " · " + completenessLabel(completeness) + " · 采集 " + (formatStamp(capturedAt) || "—");
}

function sourcesOf(points: TrendPoint[]): string {
  const names = [...new Set(points.map((point) => platformName(point.platform)).filter(Boolean))];
  return names.join("、") || "本地快照";
}

function card(label: string, value: string, note: string, traceText: string): HTMLElement {
  const box = el("article", "card span-4");
  box.setAttribute("data-card", label);
  const heading = el("h2", "", label);
  const number = el("div", "kpi", value);
  const caption = el("p", "muted clip", note);
  const from = el("p", "muted clip", traceText);
  box.append(heading, number, caption, from);
  return box;
}

function drawTrend(host: HTMLElement, points: TrendPoint[]): void {
  const ids = [...new Set(points.map((point) => point.platform))];
  const drawn = ids.map((platform) => ({
    platform,
    ...trendSegments(points.filter((point) => point.platform === platform).map((point) => ({
      date: point.date,
      value: knownMetric(point.reads, point.completeness),
    }))),
  })).filter((item) => item.status === "line");
  host.setAttribute("data-segments", String(drawn.reduce((total, item) => total + item.segments.length, 0)));
  if (!drawn.length) {
    const single = ids.some((platform) => trendSegments(points.filter((point) => point.platform === platform).map((point) => ({
      date: point.date,
      value: knownMetric(point.reads, point.completeness),
    }))).status === "single");
    host.append(el("p", "", single ? "暂无趋势" : "还没有历史快照"));
    return;
  }
  const dates = [...new Set(points.map((point) => point.date).filter(Boolean))].sort();
  host.append(el("p", "muted", dates.map((date) => formatStamp(date) || date).join("、")));
  const width = 640;
  const height = 160;
  const values = drawn.flatMap((item) => item.segments.flat().map((point) => point.value));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const xOf = (date: string) => dates.length <= 1 ? width / 2 : (dates.indexOf(date) / (dates.length - 1)) * (width - 16) + 8;
  const yOf = (value: number) => height - 16 - ((value - min) / span) * (height - 32);
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 " + width + " " + height);
  svg.setAttribute("class", "trend-svg");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "阅读趋势");
  for (const item of drawn) {
    for (const segment of item.segments) {
      if (segment.length < 2) {
        const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        dot.setAttribute("cx", String(xOf(segment[0].date)));
        dot.setAttribute("cy", String(yOf(segment[0].value)));
        dot.setAttribute("r", "3");
        svg.append(dot);
        continue;
      }
      const line = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
      line.setAttribute("fill", "none");
      line.setAttribute("data-platform", item.platform);
      line.setAttribute("points", segment.map((point) => xOf(point.date) + "," + yOf(point.value)).join(" "));
      svg.append(line);
    }
  }
  host.append(svg);
}

function renderCompare(host: HTMLElement, points: TrendPoint[]): void {
  const ids = [...new Set(points.map((point) => point.platform))];
  if (!ids.length) {
    host.append(el("p", "", "没有可对比的指标"));
    return;
  }
  const rows = ids.map((platform) => {
    const mine = points.filter((point) => point.platform === platform);
    const completeness = mine.some((point) => point.completeness === "partial")
      ? "partial"
      : mine.every((point) => point.completeness === "unsupported")
        ? "unsupported"
        : "full";
    return {
      platform,
      reads: sum(mine.map((point) => knownMetric(point.reads, point.completeness))),
      likes: sum(mine.map((point) => knownMetric(point.likes, point.completeness))),
      completeness,
      reason: mine.map((point) => point.reason || "").find(Boolean) || "",
    };
  });
  const max = Math.max(0, ...rows.map((row) => row.reads).filter((value): value is number => value != null));
  for (const row of rows) {
    const line = el("div", "compare-row");
    const missing = row.reads == null || row.completeness === "unsupported";
    line.setAttribute("data-state", missing ? (row.completeness === "unsupported" ? "unsupported" : "missing") : row.completeness);
    line.append(el("span", "clip", platformName(row.platform)));
    if (missing) {
      line.append(el("span", "clip", row.reason || completenessLabel(row.completeness === "unsupported" ? "unsupported" : "missing")));
      line.append(el("span", "num", "—"));
    } else {
      const track = el("div", "compare-track");
      const fill = el("span", "compare-fill");
      fill.style.width = (max > 0 ? Math.round((Number(row.reads) / max) * 100) : 0) + "%";
      track.append(fill);
      line.append(track);
      line.append(el("span", "num", displayCount(row.reads, "full")));
      line.append(el("span", "num", "点赞 " + displayCount(row.likes, row.likes == null ? "missing" : "full")));
    }
    host.append(line);
  }
}

function partText(value: number | null | undefined, completeness: string): string {
  if (completeness === "unsupported") return "不支持";
  if (completeness === "missing" || value == null) return "—";
  return displayCents(value, "full");
}

function renderRevenue(host: HTMLElement, rows: RevenueRow[]): void {
  if (!rows.length) {
    host.append(el("p", "", "没有可拆分的收益"));
    return;
  }
  for (const row of rows) {
    const line = el("div", "revenue-row");
    line.setAttribute("data-state", row.completeness);
    line.append(el("span", "clip", platformName(row.platform)));
    const totalMissing = row.completeness === "unsupported" || row.completeness === "missing" || row.cents == null;
    line.append(el("strong", "num", totalMissing ? "—" : displayCents(row.cents, row.completeness)));
    line.append(el("span", "muted", "广告 " + partText(row.ad, row.completeness)));
    line.append(el("span", "muted", "活动 " + partText(row.activity, row.completeness)));
    line.append(el("span", "muted", "补贴 " + partText(row.subsidy, row.completeness)));
    if (row.reason) line.append(el("span", "clip", row.reason));
    if (!totalMissing && row.ad == null && row.activity == null && row.subsidy == null) {
      line.append(el("span", "muted clip", "只记录了账面合计，没有广告、活动、补贴的分开数字"));
    }
    host.append(line);
  }
}

function renderRanking(host: HTMLElement, rows: RankRow[]): void {
  if (!rows.length) {
    host.append(el("p", "", "这个范围还没有单篇数据"));
    return;
  }
  const wrap = el("div", "table-wrap");
  const table = el("table");
  const head = el("tr");
  for (const name of ["标题", "平台", "阅读", "互动", "发布时间", "数据状态"]) {
    const cell = el("th", name === "阅读" || name === "互动" ? "num" : "", name);
    head.append(cell);
  }
  table.append(head);
  for (const row of rows) {
    const line = el("tr");
    const title = el("td", "clip", row.title || "—");
    title.title = row.title || "";
    const published = row.publishedAt ? formatStamp(row.publishedAt) || row.publishedAt : "—";
    const state = row.state || row.completeness;
    const tag = el("span", "tag", completenessLabel(state));
    tag.setAttribute("data-state", state);
    const stateCell = el("td", "clip");
    stateCell.append(tag);
    if (row.reason) stateCell.append(el("span", "clip", row.reason));
    line.append(
      title,
      el("td", "clip", platformName(row.platform)),
      el("td", "num", displayCount(row.reads, row.completeness)),
      el("td", "num", row.interaction == null ? "—" : displayCount(row.interaction, "full")),
      el("td", "clip", published),
      stateCell,
    );
    table.append(line);
  }
  wrap.append(table);
  host.append(wrap);
}

function renderExceptions(host: HTMLElement, rows: ExceptionRow[]): void {
  if (!rows.length) {
    host.append(el("p", "", "这个范围没有异常"));
    return;
  }
  for (const row of rows) {
    const view = exceptionCopy(row.state || row.completeness);
    const block = el("div", "exception");
    block.setAttribute("data-state", row.state || row.completeness);
    const copy = el("div", "attention-copy");
    copy.append(el("strong", "clip", platformName(row.platform) + " · " + view.title), el("p", "clip", view.hint));
    if (row.reason) copy.append(el("p", "muted clip", row.reason));
    block.append(copy);
    if (view.action !== "none" && view.actionLabel) {
      const button = el("button", "btn ghost", view.actionLabel);
      button.type = "button";
      button.title = view.actionLabel;
      button.setAttribute("data-action", view.action);
      button.setAttribute("data-platform", row.platform);
      block.append(button);
    }
    host.append(block);
  }
}

function actionTarget(event: Event): HTMLElement | null {
  const target = event.target;
  if (!target || typeof target !== "object" || !("closest" in target)) return null;
  const node = target as HTMLElement;
  return typeof node.closest === "function" ? node.closest("[data-action]") : null;
}

export function mount(container: HTMLElement, input: MetricsInput, actions: PageActions): { destroy: () => void } {
  const session = createPageSession();
  const read = readMetricsInput(input);
  const model = read.model;
  clear(container);
  const root = el("div", "metrics-page");
  const head = el("div", "page-head metrics-head");
  head.append(el("h1", "", "数据"));
  const tools = el("div", "metrics-tools");
  const platform = el("select");
  platform.setAttribute("aria-label", "平台");
  const range = el("select");
  range.setAttribute("aria-label", "时间范围");
  const all = el("option", "", "全部平台");
  all.value = "all";
  platform.append(all);
  const seen = new Set<string>();
  for (const point of [...model.trend, ...model.ranking, ...model.compare, ...model.revenueSplit, ...model.exceptions]) {
    if (!point.platform || seen.has(point.platform)) continue;
    seen.add(point.platform);
    const option = el("option", "", platformName(point.platform));
    option.value = point.platform;
    platform.append(option);
  }
  for (const [value, label] of [["7", "近 7 天"], ["30", "近 30 天"]] as const) {
    const option = el("option", "", label);
    option.value = value;
    range.append(option);
  }
  range.value = "7";
  const until = el("p", "muted clip", "数据截至 " + (formatStamp(model.capturedAt) || "还没有快照"));
  const refresh = el("button", "btn ghost", "立即刷新");
  refresh.type = "button";
  refresh.title = "立即刷新";
  refresh.setAttribute("aria-label", "立即刷新");
  tools.append(platform, range, until, refresh);
  head.append(tools);
  const banner = el("p", "metrics-banner clip", read.banner);
  const progress = el("p", "metrics-progress clip", "");
  const body = el("div", "metrics-body stack");
  root.append(head, banner, progress, body);
  container.append(root);
  const state = { platform: "all", days: 7, tab: "compare" as "compare" | "revenue" };
  if (!model.envId) {
    banner.textContent = banner.textContent || "还没有选择账号环境，已停止。不会改用默认登录。";
    refresh.disabled = true;
  }

  function renderBody(): void {
    clear(body);
    const today = endDay(model);
    const start = today ? shiftDay(today, -(state.days - 1)) : "";
    const inWindow = (date?: string) => !date || !start || !today || (date >= start && date <= today);
    const ranged = model.trend.filter((point) => (state.platform === "all" || point.platform === state.platform) && inWindow(point.date));
    const month = model.month || (today ? today.slice(0, 7) : "");
    const monthPoints = model.trend.filter((point) => (state.platform === "all" || point.platform === state.platform) && (!month || !point.date || point.date.startsWith(month)));
    const summary = summarizeWindow(ranged);
    const monthSummary = summarizeWindow(monthPoints);
    const known = snapshotKnown(model);
    const hide = summary.partial || monthSummary.partial;
    const origin = trace(sourcesOf(ranged.length ? ranged : monthPoints), hide ? "partial" : known ? "full" : "missing", model.capturedAt);
    const cards = el("div", "metrics-kpis");
    cards.setAttribute("data-block", "overview");
    const compareNote = !known ? "数据还没读出来" : hide ? "" : summary.deltaText ? "较前一日 " + summary.deltaText : "较前一日 —";
    const compareReason = !known || hide || summary.deltaText ? "" : "没有前一日快照";
    cards.append(
      card("总阅读", known ? displayCount(summary.reads, summary.reads == null ? "missing" : "full") : "—", known && summary.reads != null ? "相加，非去重" : "还没有阅读快照", origin),
      card("净增粉丝", known ? displayFollows(summary.follows, summary.follows == null ? "missing" : "full") : "—", [compareNote, compareReason].filter(Boolean).join(" · ") || "有符号数", origin),
      card("本月收益", known ? displayCents(monthSummary.revenueCents, monthSummary.revenueCents == null ? "missing" : "full") : "—", known && monthSummary.revenueCents != null ? "账面相加，非到账" : "还没有本月收益快照", origin),
      card("数据异常", known ? formatInt(model.exceptions.filter((item) => (state.platform === "all" || item.platform === state.platform) && inWindow(item.date)).length) : "—", "查看原因", origin),
    );
    const layout = el("div", "metrics-layout");
    const trend = el("section", "card");
    trend.setAttribute("data-block", "trend");
    trend.append(el("h2", "", "趋势"));
    drawTrend(trend, ranged);
    const exceptions = el("section", "card");
    exceptions.setAttribute("data-block", "exceptions");
    exceptions.append(el("h2", "", "异常"));
    renderExceptions(exceptions, model.exceptions.filter((item) => (state.platform === "all" || item.platform === state.platform) && inWindow(item.date)));
    layout.append(trend, exceptions);
    const ranking = el("section", "card");
    ranking.setAttribute("data-block", "ranking");
    ranking.append(el("h2", "", "内容榜"));
    renderRanking(ranking, model.ranking.filter((row) => (state.platform === "all" || row.platform === state.platform) && inWindow(row.date)));
    const split = el("section", "card metrics-split");
    split.setAttribute("data-block", "split");
    const tabs = el("div", "metrics-tabs");
    tabs.setAttribute("role", "tablist");
    const compareTab = el("button", "btn ghost", "平台对比");
    compareTab.type = "button";
    compareTab.setAttribute("role", "tab");
    compareTab.setAttribute("data-action", "tab-compare");
    const revenueTab = el("button", "btn ghost", "收益拆分");
    revenueTab.type = "button";
    revenueTab.setAttribute("role", "tab");
    revenueTab.setAttribute("data-action", "tab-revenue");
    tabs.append(compareTab, revenueTab);
    const comparePanel = el("div");
    comparePanel.setAttribute("data-block", "compare");
    comparePanel.setAttribute("data-panel", "compare");
    renderCompare(comparePanel, ranged);
    const revenuePanel = el("div");
    revenuePanel.setAttribute("data-block", "revenue");
    revenuePanel.setAttribute("data-panel", "revenue");
    revenuePanel.append(el("p", "muted", "所选时间范围内的账面构成。账面相加，非到账。"));
    renderRevenue(revenuePanel, model.revenueSplit.filter((row) => (state.platform === "all" || row.platform === state.platform) && inWindow(row.date)));
    const showCompare = state.tab !== "revenue";
    comparePanel.hidden = !showCompare;
    revenuePanel.hidden = showCompare;
    compareTab.setAttribute("aria-selected", showCompare ? "true" : "false");
    revenueTab.setAttribute("aria-selected", showCompare ? "false" : "true");
    split.append(tabs, comparePanel, revenuePanel);
    body.append(cards, layout, ranking, split);
  }

  function armCooldown(): void {
    refresh.disabled = true;
    refresh.textContent = "5 分钟内不再读取";
    session.later(() => {
      if (session.destroyed) return;
      refresh.disabled = false;
      refresh.textContent = "立即刷新";
    }, model.cooldownMs ?? REFRESH_COOLDOWN_MS);
  }

  async function runRefresh(): Promise<void> {
    if (session.destroyed || refresh.disabled || refresh.getAttribute("aria-busy") === "true" || !model.envId) return;
    refresh.setAttribute("aria-busy", "true");
    progress.textContent = "正在读取平台数据";
    let sent = false;
    try {
      sent = true;
      const result = await actions.refreshMetrics(model.envId);
      if (session.destroyed) return;
      if (!result.ok) {
        banner.textContent = keptSnapshotMessage(model.capturedAt);
        progress.textContent = result.message || "";
        return;
      }
      progress.textContent = result.message || "已读完，正在重新载入";
      try {
        await actions.reload(model.envId);
      } catch {
        if (!session.destroyed) banner.textContent = keptSnapshotMessage(model.capturedAt);
      }
    } catch {
      if (!session.destroyed) banner.textContent = keptSnapshotMessage(model.capturedAt);
    } finally {
      if (!session.destroyed) refresh.removeAttribute("aria-busy");
      if (sent && !session.destroyed) armCooldown();
    }
  }

  renderBody();
  session.track(on(refresh, "click", () => { void runRefresh(); }));
  session.track(on(platform, "change", () => {
    state.platform = platform.value || "all";
    renderBody();
  }));
  session.track(on(range, "change", () => {
    state.days = Number(range.value) === 30 ? 30 : 7;
    renderBody();
  }));
  session.track(on(body, "click", (event) => {
    const target = actionTarget(event);
    if (!target || session.destroyed) return;
    const action = target.getAttribute("data-action") || "";
    if (action === "tab-compare" || action === "tab-revenue") {
      state.tab = action === "tab-revenue" ? "revenue" : "compare";
      renderBody();
      return;
    }
    const name = target.getAttribute("data-platform") || "";
    if (action === "refresh" || action === "retry") void runRefresh();
    else if (action === "login" && model.envId) void actions.openAccount({ envId: model.envId, platform: name });
    else if (action === "verify" && model.envId) void actions.checkAccounts({ envId: model.envId, platforms: name ? [name] : [] });
  }));
  return {
    destroy() {
      session.destroy();
      clear(container);
    },
  };
}

export const mountMetrics: PageMount<MetricsViewModel> = (container, viewModel, actions) => mount(container, viewModel, actions);
