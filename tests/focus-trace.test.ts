import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { isPackaged: false, getPath: () => process.cwd() },
  BrowserWindow: class BrowserWindow {},
}));

import { attachFocusTrace } from "../src/main/focus-trace.js";

describe("抢焦插桩", () => {
  it("包住 show 后仍会调用原方法，并记下调用前的窗口态", () => {
    const lines: string[] = [];
    let shown = 0;
    const win = {
      minimized: true,
      isMinimized: () => win.minimized,
      isVisible: () => !win.minimized,
      isFocused: () => false,
      on: () => undefined,
      restore: () => undefined,
      show: () => {
        shown += 1;
        win.minimized = false;
      },
      focus: () => undefined,
      setFocusable: () => undefined,
      setBounds: () => undefined,
    };
    attachFocusTrace(win, (line) => lines.push(line));
    win.show();
    expect(shown).toBe(1);
    expect(lines[0]).toContain("call show");
    expect(lines[0]).toContain('"minimized":true');
    expect(lines[1]).toContain('"minimized":false');
  });
});
