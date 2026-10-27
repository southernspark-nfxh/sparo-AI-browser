import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { app, type BrowserWindow } from "electron";

export function focusTraceEnabled(): boolean {
  return !app.isPackaged || process.argv.includes("--sparo-trace");
}

type TraceWin = {
  isMinimized: () => boolean;
  isVisible: () => boolean;
  isFocused: () => boolean;
  on: (event: string, fn: () => void) => void;
  restore: (...args: unknown[]) => unknown;
  show: (...args: unknown[]) => unknown;
  focus: (...args: unknown[]) => unknown;
  setFocusable: (...args: unknown[]) => unknown;
  setBounds: (...args: unknown[]) => unknown;
};

/** 包住主窗口的抢焦调用。write 由调用方提供，便于单测；默认落主进程日志和 userData。 */
export function attachFocusTrace(win: TraceWin, write: (line: string) => void): void {
  const snap = () => {
    try {
      return { minimized: win.isMinimized(), visible: win.isVisible(), focused: win.isFocused() };
    } catch {
      return { destroyed: true };
    }
  };
  const stack = () =>
    (new Error().stack || "")
      .split("\n")
      .slice(2, 8)
      .map((line) => line.trim())
      .join(" <- ");
  const host = win as unknown as Record<string, (...args: unknown[]) => unknown>;
  for (const name of ["restore", "show", "focus", "setFocusable", "setBounds"]) {
    const orig = host[name].bind(win);
    host[name] = (...args: unknown[]) => {
      write(`${new Date().toISOString()} call ${name} before=${JSON.stringify(snap())} stack=${stack()}`);
      const result = orig(...args);
      write(`${new Date().toISOString()} call ${name} after=${JSON.stringify(snap())}`);
      return result;
    };
  }
  for (const event of ["restore", "focus", "maximize"]) {
    win.on(event, () => {
      write(`${new Date().toISOString()} event ${event} state=${JSON.stringify(snap())}`);
    });
  }
}

export function traceMainWindow(win: BrowserWindow): void {
  if (!focusTraceEnabled()) return;
  const file = join(app.getPath("userData"), "focus-trace.log");
  attachFocusTrace(win as unknown as TraceWin, (line) => {
    console.log(`[focus-trace] ${line}`);
    try {
      appendFileSync(file, `${line}\n`);
    } catch {
      /* 磁盘不可写时仍有控制台 */
    }
  });
}
