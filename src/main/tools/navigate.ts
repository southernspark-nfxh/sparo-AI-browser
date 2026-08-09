import type { SparkBrowser } from "../browser.js";
import type { ToolResult } from "../../shared/types.js";

export async function navigateTool(
  browser: SparkBrowser,
  url: string,
): Promise<ToolResult> {
  return browser.navigate(url);
}
