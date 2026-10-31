/**
 * Agent 操作时的视口。最小化窗口在 Windows 上客户区会变成 0，
 * getBoundingClientRect 和 sendInputEvent 跟着失效。
 * 填值不需要视口；要点菜单时，把窗口放到屏幕外并保持正常宽高，不拉回前台。
 */

export function viewportTooSmall(
  minimized: boolean,
  contentW: number,
  contentH: number,
): boolean {
  return minimized || contentW < 400 || contentH < 300;
}

export function offscreenAgentBounds(
  width: number,
  height: number,
): { x: number; y: number; width: number; height: number } {
  return {
    x: -30000,
    y: 0,
    width: Math.max(1100, width || 0),
    height: Math.max(760, height || 0),
  };
}

/** 页面坐标。负数或超出视口的点不能发给 sendInputEvent。 */
export function clickPointUsable(x: number, y: number): boolean {
  return Number.isFinite(x) && Number.isFinite(y) && x >= 0 && y >= 0 && x < 8000 && y < 8000;
}
