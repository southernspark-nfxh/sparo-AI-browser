/**
 * 标签保活。只决定哪些后台页可以卸掉渲染进程。
 * 不处理「切一下白一下」：那是丢帧重画，不是这次的重载。
 */

export type MemorySaverMode = "smart" | "off" | "aggressive";

/** 剩余内存低于总内存的这个比例，智能档才允许回收。 */
export const MEMORY_FREE_RATIO = 0.2;

export type DiscardTaskState = "running" | "waiting_human" | "queued" | "done" | "idle" | "";

export type DiscardCandidate = {
  id: string;
  discarded?: boolean;
  audible?: boolean;
  lastActiveAt?: number;
  /** 用户手开的页，含环境里人自己开的。 */
  userOwned: boolean;
  /** 任务已经结束的 agent 工位。 */
  agentDone?: boolean;
  taskState?: DiscardTaskState;
};

export type DiscardPickInput = {
  mode: MemorySaverMode;
  now: number;
  idleMs: number;
  /** 每一扇窗口当前正看着的标签。 */
  activeIds: string[];
  /** 剩余 / 总量。智能档低于 pressureRatio 才回收。 */
  freeRatio: number;
  pressureRatio?: number;
  tabs: DiscardCandidate[];
};

const LIVE_TASK = new Set<DiscardTaskState>(["running", "waiting_human", "queued"]);

export function normalizeMemorySaverMode(value: unknown): MemorySaverMode | null {
  if (value === "smart" || value === "off" || value === "aggressive") return value;
  return null;
}

/**
 * 旧文件没有 memorySaverMode。
 * memorySaver: false 是人关过的，迁到全保活。
 * 缺省或 true 迁到智能，不再按分钟杀用户的页。
 */
export function migrateMemorySaverMode(file: {
  memorySaver?: boolean;
  memorySaverMode?: unknown;
}): MemorySaverMode {
  const explicit = normalizeMemorySaverMode(file.memorySaverMode);
  if (explicit) return explicit;
  if (file.memorySaver === false) return "off";
  return "smart";
}

export function memoryIsTight(freeRatio: number, pressureRatio = MEMORY_FREE_RATIO): boolean {
  if (!Number.isFinite(freeRatio) || !Number.isFinite(pressureRatio)) return false;
  return freeRatio < pressureRatio;
}

function eligible(tab: DiscardCandidate, active: Set<string>): boolean {
  if (!tab.id || tab.discarded) return false;
  if (active.has(tab.id)) return false;
  if (tab.audible) return false;
  if (LIVE_TASK.has(tab.taskState || "")) return false;
  return true;
}

/**
 * 智能：内存宽裕时一张不杀。紧了先收已完成的 agent 工位，再收一张最久没看的用户页。
 * 激进：闲置够了就杀后台页，但仍排除各窗当前页、在播声音、以及还在跑或等人的工位。
 * 全保活：自动扫描不杀。手动「优化内存」另走激进且闲置为 0。
 */
export function pickTabsToDiscard(input: DiscardPickInput): string[] {
  if (input.mode === "off") return [];
  const active = new Set(input.activeIds.filter(Boolean));
  const pool = input.tabs.filter((tab) => eligible(tab, active));
  if (input.mode === "aggressive") {
    const idleMs = Math.max(0, input.idleMs || 0);
    return pool
      .filter((tab) => input.now - (tab.lastActiveAt || 0) >= idleMs)
      .map((tab) => tab.id);
  }
  if (!memoryIsTight(input.freeRatio, input.pressureRatio ?? MEMORY_FREE_RATIO)) return [];
  const byAge = (a: DiscardCandidate, b: DiscardCandidate) => (a.lastActiveAt || 0) - (b.lastActiveAt || 0);
  const doneAgents = pool.filter((tab) => !tab.userOwned && tab.agentDone).sort(byAge);
  const oldestUser = pool.filter((tab) => tab.userOwned).sort(byAge)[0];
  const ids = doneAgents.map((tab) => tab.id);
  if (oldestUser) ids.push(oldestUser.id);
  return ids;
}
