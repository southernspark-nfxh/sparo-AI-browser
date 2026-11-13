export type PageRect = { x: number; y: number; width: number; height: number };

/**
 * 页面视图被原生布局拉成整窗时，会盖住顶栏和侧栏，窗口上只剩系统按钮。
 * 停在屏幕外的后台标签（x 远小于 0）不算盖住。
 */
export type ChromeCoverBudget = { windowStart: number; fixes: number; lastFix: number };

const CHROME_COVER_WINDOW_MS = 3000;
/** 同一瞬间连着拉，只挡这一下，下一拍仍救。不许攒到 N 次后永久放弃。 */
const CHROME_COVER_DEBOUNCE_MS = 200;
/** 同一视图连续这么多次几何不动，就离开两秒节拍，改走冷却后的降频恢复。 */
export const CHROME_HEAL_STALL_LIMIT = 3;
/** 降频后的冷却。不是永久放弃，到点仍可再修。resize / restore / switchTab 会提前清掉。 */
export const CHROME_HEAL_COOLDOWN_MS = 10_000;

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

export type CoverReason = "y" | "x" | "width" | "right" | "height" | null;

/** 命中哪一条覆盖。顺序与旧布尔判断一致，先碰到哪条算哪条。 */
export function chromeCoverReason(actual: PageRect, hole: PageRect): CoverReason {
  if (actual.x < -100) return null;
  if (actual.width < 50 || actual.height < 50) return null;
  if (actual.y < hole.y - 1) return "y";
  if (actual.x < hole.x - 1) return "x";
  if (actual.width > hole.width + 4) return "width";
  if (actual.x + actual.width > hole.x + hole.width + 4) return "right";
  if (actual.height > hole.height + 8) return "height";
  return null;
}

export function pageViewCoversChrome(actual: PageRect, hole: PageRect): boolean {
  return chromeCoverReason(actual, hole) !== null;
}

/**
 * 壳层（顶栏 + 侧栏）停帧。网页视图是另一条合成链，它还在画，所以窗口里只有
 * 网页是活的，顶栏和侧栏整块发白；人得最小化再最大化才行。
 * 壳层每秒报一次「这一秒新画了几帧」，连续几拍是 0 就按停帧处理。
 */
export type ShellPaintState = { zeroStreak: number; repaints: number; lastRepaintAt: number };

/** 连续这么多拍一帧没画才算停帧。一拍只是抖动。 */
export const SHELL_PAINT_STALL_BEATS = 3;
/** 两次强制重绘的最小间隔，别对着没救回来的窗口每秒打一枪。 */
export const SHELL_PAINT_REPAINT_COOLDOWN_MS = 3_000;
/** 连续这么多拍还没恢复就落一次盘，下次复现有账可查。 */
export const SHELL_PAINT_DIAG_BEATS = 9;

/**
 * 最小化、藏起来或 Chromium 判定文档隐藏的窗口本来就不出帧，不判白屏。
 * 失焦不算：人切到别的程序去的时候壳层照样是白的，回来还得手动最大最小化。
 */
export function shellPaintStalled(
  state: ShellPaintState,
  frames: number,
  ctx: { minimized: boolean; visible: boolean; documentVisible?: boolean; now: number },
): { state: ShellPaintState; repaint: boolean } {
  const idle = { zeroStreak: 0, repaints: 0, lastRepaintAt: state.lastRepaintAt };
  if (ctx.minimized || !ctx.visible || ctx.documentVisible === false) return { state: idle, repaint: false };
  if (frames > 0) return { state: idle, repaint: false };
  const zeroStreak = state.zeroStreak + 1;
  const cooled =
    state.lastRepaintAt === 0 || ctx.now - state.lastRepaintAt >= SHELL_PAINT_REPAINT_COOLDOWN_MS;
  if (zeroStreak < SHELL_PAINT_STALL_BEATS || !cooled) {
    return {
      state: { zeroStreak, repaints: state.repaints, lastRepaintAt: state.lastRepaintAt },
      repaint: false,
    };
  }
  return {
    state: { zeroStreak, repaints: state.repaints + 1, lastRepaintAt: ctx.now },
    repaint: true,
  };
}

/**
 * 渲染进程连心跳都不发时，主进程这边的停帧计数永远不会再更新，光看 0 帧发现不了。
 * 前台窗口超过这个时间没心跳，就按「壳层已卡死」处理。
 */
export const SHELL_HEARTBEAT_GAP_MS = 5_000;
/** 轻推重绘这么多次还推不动，就不能再推了，得重启渲染进程。 */
export const SHELL_PAINT_RELOAD_AFTER_REPAINTS = 3;

/**
 * 窗口在前台、可见、未最小化，却超过 SHELL_HEARTBEAT_GAP_MS 没收到壳层心跳。
 * 最小化 / 藏起来 / 没聚焦的窗口本来就可能不出帧，不判死。
 */
export function shellSilentTooLong(
  lastBeatAt: number,
  ctx: { now: number; minimized: boolean; visible: boolean; focused: boolean },
): boolean {
  if (ctx.minimized || !ctx.visible || !ctx.focused) return false;
  if (!lastBeatAt) return false;
  return ctx.now - lastBeatAt > SHELL_HEARTBEAT_GAP_MS;
}

/**
 * 恢复阶梯：前两次只重绘（无感），第三次起重启渲染进程。
 * 已经收到 unresponsive、且重绘过一次仍没救回来，也直接重启——重绘对不响应 IPC 的进程无效。
 */
export function shellRecoveryStep(
  state: ShellPaintState,
  unresponsive = false,
): "repaint" | "reload" {
  if (state.repaints >= SHELL_PAINT_RELOAD_AFTER_REPAINTS) return "reload";
  if (unresponsive && state.repaints >= 1) return "reload";
  return "repaint";
}

/** 侧栏收起后的工具轨。侧栏宽度还没报到时，至少留出这么宽，不能把网页铺满客户区。 */
export const MIN_SIDEBAR_W = 56;

export type PageViewLimits = {
  contentWidth: number;
  contentHeight: number;
  /** 当前侧栏宽。0 表示还没报到，退到 MIN_SIDEBAR_W。展开时是 300–480，不要拿 56 当硬顶。 */
  sidebarW: number;
  chromeH: number;
  /** 页面洞。比「客户区减侧栏」更窄时以洞为准。 */
  hole?: PageRect | null;
};

/**
 * 网页视图不得盖住顶栏，也不得宽过当前页面洞。
 * 硬上限是客户区宽减去当前侧栏宽；侧栏宽度未知时才退到最小工具轨。
 */
export function clampPageView(view: PageRect, limits: PageViewLimits): PageRect {
  const reserved = limits.sidebarW > 0 ? limits.sidebarW : MIN_SIDEBAR_W;
  const contentW = Math.max(0, limits.contentWidth);
  const contentH = Math.max(0, limits.contentHeight);
  const hole = limits.hole && limits.hole.width >= 80 && limits.hole.height >= 80 ? limits.hole : null;
  let x = hole ? hole.x : view.x;
  let y = view.y;
  if (y < limits.chromeH) y = hole && hole.y >= limits.chromeH ? hole.y : limits.chromeH;
  if (hole && hole.y >= limits.chromeH && hole.y <= 200) y = hole.y;
  let width = view.width;
  let height = view.height;
  if (hole) {
    width = Math.min(width, hole.width);
    height = Math.min(height, hole.height);
  }
  const maxW = Math.max(100, contentW - reserved - Math.max(0, x));
  width = Math.min(width, maxW);
  const maxH = Math.max(100, contentH - y);
  height = Math.min(height, maxH);
  width = Math.max(100, width);
  height = Math.max(100, height);
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
  };
}

/** heal 日志里的差值。width 用 dw，正数表示视图比洞宽出多少。 */
export function chromeCoverDelta(reason: Exclude<CoverReason, null>, actual: PageRect, hole: PageRect): string {
  if (reason === "y") return `dy=${actual.y - hole.y}`;
  if (reason === "x") return `dx=${actual.x - hole.x}`;
  if (reason === "width") return `dw=${actual.width - hole.width}`;
  if (reason === "right") return `dr=${actual.x + actual.width - (hole.x + hole.width)}`;
  return `dh=${actual.height - hole.height}`;
}
