/**
 * CS helpers — scan + draft (fill only). Kept out of browser.ts God class surface.
 */
import type { ToolResult } from "../../shared/types.js";
import type { SparoSettings } from "../settings/store.js";
import { CS_SCAN_SCRIPT } from "./scan-script.js";
import { classifyIntent } from "./intent.js";
import { buildDraft } from "./draft.js";
import type { CsDraftData, CsScanData } from "./types.js";

export type CsBrowserSurface = {
  pageView: { webContents: { executeJavaScript: (code: string, ua?: boolean) => Promise<unknown> } };
  assertNotPaused: () => ToolResult | null;
  fill: (
    target: { ref?: string; selector?: string },
    value: string,
  ) => Promise<ToolResult>;
  getSettings: () => SparoSettings;
};

export async function runCsScan(
  browser: CsBrowserSurface,
  opts?: { fromHuman?: boolean },
): Promise<ToolResult & { data?: CsScanData }> {
  if (!opts?.fromHuman) {
    const blocked = browser.assertNotPaused();
    if (blocked) return blocked as ToolResult & { data?: CsScanData };
  }
  try {
    const data = (await browser.pageView.webContents.executeJavaScript(
      CS_SCAN_SCRIPT,
      true,
    )) as CsScanData;
    if (!data?.ok) {
      return { ok: false, message: "cs_scan failed", data };
    }
    return {
      ok: true,
      message: data.looksLikeChat
        ? `cs_scan chat-like score=${data.score} msgs=${data.messages?.length || 0}`
        : `cs_scan weak chat signal score=${data.score}（仍可尝试草稿）`,
      data,
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function runCsDraft(
  browser: CsBrowserSurface,
  input: {
    draft?: string;
    fill?: boolean;
    preferLlm?: boolean;
    /** Human clicked 一键回复 in the shell — do not treat as paused Agent. */
    fromHuman?: boolean;
  } = {},
): Promise<ToolResult & { data?: CsDraftData }> {
  if (!input.fromHuman) {
    const blocked = browser.assertNotPaused();
    if (blocked) return blocked as ToolResult & { data?: CsDraftData };
  }

  const scanRes = await runCsScan(browser, { fromHuman: input.fromHuman });
  if (!scanRes.ok || !scanRes.data) {
    return { ok: false, message: scanRes.message || "cs_scan failed", data: scanRes.data as never };
  }
  const scan = scanRes.data;
  const intent = classifyIntent(scan.messages || [], scan.lastCustomerText);
  const { draft, source } = await buildDraft({
    settings: browser.getSettings(),
    intent,
    messages: scan.messages || [],
    provided: input.draft,
    preferLlm: input.preferLlm,
  });

  const shouldFill = input.fill !== false;
  let filled = false;
  let composerRef = scan.composer?.ref;
  if (shouldFill) {
    if (!composerRef && !scan.composer?.selector) {
      return {
        ok: false,
        message: "未找到聊天输入框，无法填入草稿（请点一下输入框后再试）",
        data: {
          intent,
          draft,
          source,
          filled: false,
          sendBlocked: true,
          scan,
        },
      };
    }
    const fillRes = await browser.fill(
      { ref: composerRef, selector: scan.composer?.selector },
      draft,
    );
    filled = Boolean(fillRes.ok);
    if (!filled) {
      return {
        ok: false,
        message: `草稿已生成但填入失败：${fillRes.message}`,
        data: {
          intent,
          draft,
          source,
          filled: false,
          composerRef,
          sendBlocked: true,
          scan,
        },
      };
    }
  }

  return {
    ok: true,
    message: filled
      ? `已填入草稿（${intent.label} · ${source}）。请人确认后点击页面「发送」——Sparo 不会自动发送。`
      : `已生成草稿（${intent.label} · ${source}），未填入。`,
    data: {
      intent,
      draft,
      source,
      filled,
      composerRef,
      sendBlocked: true,
      scan,
    },
  };
}
