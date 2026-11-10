/**
 * 人机同窗（填表、回复、发帖）是否可以把最小化窗口拉回前台。
 * 最小化时一律不拉。完成只闪任务栏。窗口本来就在前台时也不再额外 focus。
 */
export function coPresenceMayRestore(minimized: boolean): boolean {
  if (minimized) return false;
  return false;
}

/**
 * agent 正在操作时，不许把用户当前的前台拽过来。
 * 没有 agent 在操作（clientId 为空）时返回 false，调用方保持原来的前台行为。
 * 标签不是这个 agent 的，或者窗口现在不在前台，都返回 true。
 */
export function mustNotStealFocus(input: {
  clientId: string;
  owner: string;
  windowFocused: boolean;
}): boolean {
  const clientId = String(input.clientId || "").trim();
  if (!clientId) return false;
  if (input.owner !== `agent:${clientId}`) return true;
  return !input.windowFocused;
}
