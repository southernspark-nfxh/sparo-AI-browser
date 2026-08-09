import type { SparkBrowser } from "../browser.js";
import type { ToolResult } from "../../shared/types.js";

export async function fillTool(
  browser: SparkBrowser,
  target: { ref?: string; selector?: string },
  value: string,
): Promise<ToolResult> {
  return browser.fill(target, value);
}
