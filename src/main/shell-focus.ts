/**
 * 人机同窗（填表、回复、发帖）是否可以把最小化窗口拉回前台。
 * 最小化时一律不拉。完成只闪任务栏。窗口本来就在前台时也不再额外 focus。
 */
export function coPresenceMayRestore(minimized: boolean): boolean {
  if (minimized) return false;
  return false;
}
