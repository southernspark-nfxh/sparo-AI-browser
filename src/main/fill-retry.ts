import { softFillMatch } from "./browser-helpers.js";

/** 回读为空，或不到期望长度的一半，算严重不符。 */
export function contentEditableReadbackShort(expected: string, actual: string): boolean {
  const want = String(expected || "");
  const got = String(actual || "").trim();
  if (!want) return false;
  if (!got) return true;
  return got.length * 2 < want.length;
}

/**
 * contenteditable 回读严重不符时，只再清空并 insertText 一次。
 * 重试仍失败时带上标签名和是否可编辑，不把失败说成成功。
 */
export async function retryShortContentEditable(input: {
  kind: string;
  expected: string;
  actual: string;
  retry: () => Promise<{ actual: string; tag?: string; contentEditable?: boolean }>;
}): Promise<{
  retried: boolean;
  matched: boolean;
  actual: string;
  message: string;
}> {
  if (input.kind !== "contenteditable" || !contentEditableReadbackShort(input.expected, input.actual)) {
    return { retried: false, matched: false, actual: input.actual, message: "" };
  }
  const again = await input.retry();
  const actual = String(again.actual || "");
  const tag = again.tag || "unknown";
  const contentEditable = again.contentEditable !== false;
  const matched = softFillMatch(input.expected, actual);
  return {
    retried: true,
    matched,
    actual,
    message: matched
      ? `已清空后重填 ${actual.length} 字`
      : `fill retry failed expected=${input.expected.length} actual=${actual.length} tag=${tag} contenteditable=${contentEditable}`,
  };
}
