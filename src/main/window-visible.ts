/** 窗口有没有落在工作区里。只算几何，不碰窗口、不抢焦点。 */

export type Rect = { x: number; y: number; width: number; height: number };

const MIN_W = 400;
const MIN_H = 300;
const MARGIN = 40;

export function windowOnScreen(bounds: Rect, workArea: Rect): boolean {
  return (
    bounds.width >= MIN_W &&
    bounds.height >= MIN_H &&
    bounds.x + bounds.width > workArea.x + MARGIN &&
    bounds.y + bounds.height > workArea.y + MARGIN &&
    bounds.x < workArea.x + workArea.width - MARGIN &&
    bounds.y < workArea.y + workArea.height - MARGIN
  );
}

export function windowOnAnyWorkArea(bounds: Rect, workAreas: Rect[]): boolean {
  return workAreas.some((area) => windowOnScreen(bounds, area));
}

/** 跟 ensureWindowVisible 拉回时用的同一组尺寸。 */
export function centeredBounds(workArea: Rect): Rect {
  const width = Math.min(1360, Math.max(800, workArea.width - 48));
  const height = Math.min(900, Math.max(560, workArea.height - 48));
  return {
    x: workArea.x + Math.round((workArea.width - width) / 2),
    y: workArea.y + Math.round((workArea.height - height) / 2),
    width,
    height,
  };
}

/**
 * 显示器变化时要不要挪窗口。
 * 最小化不动。任一工作区里已经放得下也不动（第二块屏不算甩出去）。
 * 都不在，才拉回主屏工作区。不负责 show / focus。
 */
export function planDisplayClamp(input: {
  minimized: boolean;
  bounds: Rect;
  workAreas: Rect[];
  home: Rect;
}): { move: boolean; bounds: Rect } {
  if (input.minimized) return { move: false, bounds: input.bounds };
  if (windowOnAnyWorkArea(input.bounds, input.workAreas)) return { move: false, bounds: input.bounds };
  return { move: true, bounds: centeredBounds(input.home) };
}

export type ClampWindow = {
  isMinimized(): boolean;
  getBounds(): Rect;
  setBounds(next: Rect): void;
};

/** 只在计划要挪时 setBounds。调用方不许顺手 focus。 */
export function applyDisplayClamp(win: ClampWindow, workAreas: Rect[], home: Rect): { moved: boolean; bounds: Rect } {
  const before = win.getBounds();
  const plan = planDisplayClamp({
    minimized: win.isMinimized(),
    bounds: before,
    workAreas,
    home,
  });
  if (!plan.move) return { moved: false, bounds: before };
  win.setBounds(plan.bounds);
  return { moved: true, bounds: plan.bounds };
}

export type DisplaySnap = { bounds: Rect; workArea: Rect; scaleFactor: number };

export function formatDisplayLine(
  event: string,
  displays: DisplaySnap[],
  win: Rect,
  extra?: { minimized?: boolean; hole?: Rect | null },
): string {
  const body =
    displays
      .map((d, i) => {
        const b = d.bounds;
        const w = d.workArea;
        return `#${i} bounds=${b.x},${b.y},${b.width}x${b.height} work=${w.x},${w.y},${w.width}x${w.height} scale=${d.scaleFactor}`;
      })
      .join(" | ") || "none";
  const hole = extra?.hole
    ? `${extra.hole.x},${extra.hole.y},${extra.hole.width}x${extra.hole.height}`
    : "none";
  return `[display] ${event} displays=${body} win=${win.x},${win.y},${win.width}x${win.height} minimized=${extra?.minimized ? 1 : 0} hole=${hole}`;
}

export function formatDisplayClamp(from: Rect, to: Rect): string {
  return `[display] clamp from=${from.x},${from.y},${from.width}x${from.height} to=${to.x},${to.y},${to.width}x${to.height}`;
}
