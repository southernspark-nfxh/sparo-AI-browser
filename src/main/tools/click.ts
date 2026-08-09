import type { SparkBrowser } from "../browser.js";
import type { ToolResult } from "../../shared/types.js";

export async function clickTool(
  browser: SparkBrowser,
  target: { ref?: string; selector?: string; caret?: boolean },
): Promise<ToolResult> {
  return browser.click(target);
}
