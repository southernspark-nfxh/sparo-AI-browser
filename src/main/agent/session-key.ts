/** 会话键只在这里生成，避免各处拼出不同格式。 */

export const COMMAND_SESSION_KEY = "command";

export function pageSessionKey(tabId: string): string {
  return `page:${String(tabId || "").trim()}`;
}

export function taskSessionKey(tabId: string, taskId: string): string {
  return `${pageSessionKey(tabId)}/task:${String(taskId || "").trim()}`;
}

export function isTaskSessionKey(key: string): boolean {
  return key.startsWith("page:") && key.includes("/task:");
}

export function isPageSessionKey(key: string): boolean {
  return key.startsWith("page:") && !key.includes("/task:");
}
