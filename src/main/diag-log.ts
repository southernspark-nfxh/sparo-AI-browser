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
