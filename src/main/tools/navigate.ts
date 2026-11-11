import type { SparkBrowser } from "../browser.js";
import type { ToolResult } from "../../shared/types.js";

export async function navigateTool(
  browser: SparkBrowser,
  url: string,
  tabId?: string,
  envId?: string,
): Promise<ToolResult> {
  const opts: { tabId?: string; envId?: string } = {};
  if (tabId) opts.tabId = tabId;
  if (envId) opts.envId = envId;
  return browser.navigate(url, opts);
}
