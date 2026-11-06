/** 进程级取证。只拼日志，不改任务逻辑。 */

export function crashStamp(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

export function crashLogFileName(date = new Date()): string {
  return `crash-${crashStamp(date)}.log`;
}

export function formatDiagEvent(tag: string, detail: string, date = new Date()): string {
  return `${date.toISOString()} [${tag}] ${detail}`;
}

export function formatErrorDetail(err: unknown): string {
  if (err instanceof Error) return `${err.message}\n${err.stack || ""}`.trim();
  return String(err);
}

export function formatMemLine(sample: {
  rss: number;
  heapUsed: number;
  heapTotal: number;
  external: number;
  tabs: number;
  running: number;
}): string {
  const mb = (bytes: number) => Math.round(bytes / (1024 * 1024));
  return `[mem] rss=${mb(sample.rss)} heapUsed=${mb(sample.heapUsed)} heapTotal=${mb(sample.heapTotal)} external=${mb(sample.external)} tabs=${sample.tabs} running=${sample.running}`;
}

/** 壳层渲染进程内存。getProcessMemoryInfo 的单位是 KB。 */
export function formatShellMemLine(sample: {
  privateKb: number;
  sharedKb: number;
  residentKb: number;
  rendererCount: number;
  rendererMb: number;
  note?: string;
}): string {
  const mb = (kb: number) => Math.round(kb / 1024);
  const note = (sample.note || "ok").replace(/\s+/g, " ").slice(0, 80);
  return `[mem-shell] private=${mb(sample.privateKb)} shared=${mb(sample.sharedKb)} resident=${mb(sample.residentKb)} renderers=${sample.rendererCount} rendererMb=${sample.rendererMb} note=${note}`;
}

/** 一分钟里壳层推送了多少次、平均多大。flush 少于 req 说明 100ms 节流在合并。 */
export function formatPushMinute(sample: {
  chromeReq: number;
  chromeFlush: number;
  chromeBytes: number;
  sidebarReq: number;
  sidebarFlush: number;
  sidebarBytes: number;
}): string {
  const avg = (bytes: number, n: number) => (n > 0 ? Math.round(bytes / n) : 0);
  return `[push] chrome req=${sample.chromeReq} flush=${sample.chromeFlush} avgBytes=${avg(sample.chromeBytes, sample.chromeFlush)} sidebar req=${sample.sidebarReq} flush=${sample.sidebarFlush} avgBytes=${avg(sample.sidebarBytes, sample.sidebarFlush)}`;
}

/** 渲染进程消失时的现场。sinceUnresponsiveMs 为空表示这次启动还没假死过。 */
export function formatShellCrashContext(sample: {
  reason: string;
  exitCode: number;
  bounds: string;
  tabs: number;
  chats: string;
  tasks: string;
  sinceUnresponsiveMs: number | null;
  chromeReq: number;
  chromeFlush: number;
  sidebarReq: number;
  sidebarBytes: number;
}): string {
  const since = sample.sinceUnresponsiveMs == null ? "none" : String(sample.sinceUnresponsiveMs);
  return [
    `reason=${sample.reason}`,
    `exitCode=${sample.exitCode}`,
    `bounds=${sample.bounds}`,
    `tabs=${sample.tabs}`,
    `chats=${sample.chats}`,
    `tasks=${sample.tasks}`,
    `sinceUnresponsiveMs=${since}`,
    `chromeReq=${sample.chromeReq}`,
    `chromeFlush=${sample.chromeFlush}`,
    `sidebarReq=${sample.sidebarReq}`,
    `sidebarBytes=${sample.sidebarBytes}`,
  ].join(" ");
}
