/**
 * execute 的页面包装。
 * awaitPromise 默认关闭：脚本若返回 Promise，仍按原样收成 {}。
 * 打开时才等待 thenable，并由主进程加超时。
 */
import { cdpUtf8Expr } from "./cdp-frames.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 120_000;

export function clampExecuteTimeout(ms: unknown): number {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_TIMEOUT_MS;
  return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, Math.floor(n)));
}

export function buildExecuteExpression(script: string, awaitPromise: boolean): string {
  const src = cdpUtf8Expr(script);
  if (!awaitPromise) {
    return `(() => {
        try {
          const __src = ${src};
          const __r = (0, eval)(__src);
          let safe;
          try { safe = JSON.parse(JSON.stringify(__r === undefined ? null : __r)); }
          catch (_) { safe = String(__r); }
          return { ok: true, result: safe };
        } catch (e) {
          return { ok: false, result: null, error: String(e && e.message ? e.message : e) };
        }
      })()`;
  }
  return `(async () => {
        try {
          const __src = ${src};
          let __r = (0, eval)(__src);
          if (__r && typeof __r.then === "function") __r = await __r;
          let safe;
          try { safe = JSON.parse(JSON.stringify(__r === undefined ? null : __r)); }
          catch (_) { safe = String(__r); }
          return { ok: true, result: safe };
        } catch (e) {
          return { ok: false, result: null, error: String(e && e.message ? e.message : e) };
        }
      })()`;
}

/** 超时后拒绝。页面里已经启动的定时器不会被取消。 */
export async function withDeadline<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`execute timeout after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
