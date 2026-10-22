export type PageRect = { x: number; y: number; width: number; height: number };

/**
 * 页面视图被原生布局拉成整窗时，会盖住顶栏和侧栏，窗口上只剩系统按钮。
 * 停在屏幕外的后台标签（x 远小于 0）不算盖住。
 */
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
