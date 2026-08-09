import type { SparkBrowser } from "../browser.js";
import type { ToolResult, PageSnapshot } from "../../shared/types.js";

export async function snapshotTool(
  browser: SparkBrowser,
  selector?: string,
): Promise<ToolResult & { data?: PageSnapshot }> {
  return browser.snapshot(selector);
}
