import type { SparkBrowser } from "../browser.js";
import type { ToolResult } from "../../shared/types.js";

export async function clickTool(
  browser: SparkBrowser,
  target: { ref?: string; selector?: string; caret?: boolean },
  tabId?: string,
): Promise<ToolResult> {
  return browser.click(target, tabId);
}
