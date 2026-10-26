export type PageRect = { x: number; y: number; width: number; height: number };

/**
 * 页面视图被原生布局拉成整窗时，会盖住顶栏和侧栏，窗口上只剩系统按钮。
 * 停在屏幕外的后台标签（x 远小于 0）不算盖住。
 */
export type ChromeCoverBudget = { windowStart: number; fixes: number };

const CHROME_COVER_WINDOW_MS = 3000;
const CHROME_COVER_CAP = 8;

/** restore / resize 时把 8 次上限和 3 秒窗一起清掉，守卫才能再救白屏。 */
export function resetChromeCoverBudget(now: number): ChromeCoverBudget {
  return { windowStart: now, fixes: 0 };
}

/** 3 秒窗内最多 8 次。返回 allow=false 时调用方不再重排。 */
export function takeChromeCoverFix(
  state: ChromeCoverBudget,
  now: number,
): { state: ChromeCoverBudget; allow: boolean } {
  const fresh = now - state.windowStart > CHROME_COVER_WINDOW_MS ? resetChromeCoverBudget(now) : state;
  const fixes = fresh.fixes + 1;
  return {
    state: { windowStart: fresh.windowStart, fixes },
    allow: fixes <= CHROME_COVER_CAP,
  };
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
