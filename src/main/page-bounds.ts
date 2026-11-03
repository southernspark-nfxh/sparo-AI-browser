export type PageRect = { x: number; y: number; width: number; height: number };

/**
 * 页面视图被原生布局拉成整窗时，会盖住顶栏和侧栏，窗口上只剩系统按钮。
 * 停在屏幕外的后台标签（x 远小于 0）不算盖住。
 */
export type ChromeCoverBudget = { windowStart: number; fixes: number; lastFix: number };

const CHROME_COVER_WINDOW_MS = 3000;
/** 同一瞬间连着拉，只挡这一下，下一拍仍救。不许攒到 N 次后永久放弃。 */
const CHROME_COVER_DEBOUNCE_MS = 200;

/** restore / resize 时清掉去抖计数，守卫接着救白屏。 */
export function resetChromeCoverBudget(now: number): ChromeCoverBudget {
  return { windowStart: now, fixes: 0, lastFix: 0 };
}

/** 只做限频去抖。allow=false 只表示这一下太密，过了去抖间隔必须再允许。 */
export function takeChromeCoverFix(
  state: ChromeCoverBudget,
  now: number,
): { state: ChromeCoverBudget; allow: boolean } {
  if (state.lastFix > 0 && now - state.lastFix < CHROME_COVER_DEBOUNCE_MS) {
    return { state, allow: false };
  }
  const fresh = now - state.windowStart > CHROME_COVER_WINDOW_MS ? resetChromeCoverBudget(now) : state;
  return {
    state: { windowStart: fresh.windowStart, fixes: fresh.fixes + 1, lastFix: now },
    allow: true,
  };
}

/** DPI 取整会让宽高在相邻两像素间来回跳。1px 以内视为同一矩形，避免重排回路。 */
export function boundsWithinOnePixel(a: PageRect, b: PageRect): boolean {
  return (
    Math.abs(a.x - b.x) <= 1 &&
    Math.abs(a.y - b.y) <= 1 &&
    Math.abs(a.width - b.width) <= 1 &&
    Math.abs(a.height - b.height) <= 1
  );
}

export function pageViewCoversChrome(actual: PageRect, hole: PageRect): boolean {
  if (actual.x < -100) return false;
  if (actual.width < 50 || actual.height < 50) return false;
  if (actual.y < hole.y - 1) return true;
  if (actual.x < hole.x - 1) return true;
  if (actual.width > hole.width + 4) return true;
  if (actual.x + actual.width > hole.x + hole.width + 4) return true;
  if (actual.height > hole.height + 8) return true;
  return false;
}
