/**
 * 测试工装：把 Object.create 出来的空壳实例补成"一扇可用窗口"。
 *
 * 背景：多开改造后，当前窗口从隐式的单窗变成了显式的 `activeWinId` + `wins` 表，
 * 相关状态都存在按窗口分的 Map/Set 里。测试用 `Object.create(SparkBrowser.prototype)`
 * 造实例，不跑字段初始化器，这些状态全是 undefined/空 —— 于是"按窗口过滤标签""遍历
 * 所有窗口"这类逻辑在工装里什么都拿不到。
 *
 * 这里只做补字段这件事，不改变任何断言。
 */
import { SparkBrowser } from "../../src/main/browser.js";

type FakeWin = object;

type Host = Record<string, unknown>;

function hostOf(browser: SparkBrowser): Host {
  return browser as unknown as Host;
}

/**
 * 确保某个集合存在。
 *
 * 先读：字段可能是惰性 getter（读一次就建好了），绝不能整体赋值把 getter 覆盖掉。
 * 读不到再写：字段是普通属性但没初始化时，补一个上去。
 */
function ensure<T>(host: Host, key: string, factory: () => T): T {
  const current = host[key] as T | undefined;
  if (current) return current;
  const made = factory();
  try {
    host[key] = made;
  } catch {
    /* getter-only：读的时候已经建好，不需要写 */
  }
  return (host[key] as T | undefined) ?? made;
}

/**
 * 造一个空壳实例，等价于"只有一个 main 窗口"的状态。
 *
 * @param win 可选的假窗口；传了就直接挂成 main 窗口（window 与 wins 双向一致）
 */
export function makeBrowser(win?: FakeWin): { browser: SparkBrowser; win?: FakeWin } {
  const browser = Object.create(SparkBrowser.prototype) as SparkBrowser;
  const host = hostOf(browser);
  ensure(host, "wins", () => new Map<string, unknown>());
  ensure(host, "activeTabs", () => new Map<string, string>());
  ensure(host, "shellReadyWins", () => new Set<string>());
  ensure(host, "holeBoundsByWin", () => new Map<string, unknown>());
  ensure(host, "sidebarWByWin", () => new Map<string, number>());
  ensure(host, "lastGoodContentByWin", () => new Map<string, unknown>());
  ensure(host, "lastLayoutContentByWin", () => new Map<string, unknown>());
  if (!host.activeWinId) host.activeWinId = "main";
  // 生产里主窗口上屏时才算"摆过"，工装默认认为已上屏。
  ensure(host, "placedWins", () => new Set<string>()).add("main");
  if (win) bindWindow(browser, win);
  return { browser, win };
}

/**
 * 给实例挂一扇假窗口：`window` 与 `wins["main"]` 同时指向它。
 *
 * 生产里 `win` getter 走的是 `wins.get(activeWinId) || this.window`，
 * 只设一边（旧工装的做法）会让"遍历所有窗口"的逻辑看到空表。
 */
export function bindWindow<T extends FakeWin>(browser: SparkBrowser, win: T): T {
  const host = hostOf(browser);
  if (!host.activeWinId) host.activeWinId = "main";
  const wins = ensure(host, "wins", () => new Map<string, unknown>());
  const placed = ensure(host, "placedWins", () => new Set<string>());
  host.window = win;
  wins.set("main", win);
  placed.add("main");
  return win;
}
