import type { SparoQuote } from "./quotes.js";

/** 侧栏工位的 clientId。不占甲乙丙的座位号。 */
export const SIDEBAR_CLIENT_ID = "sidebar";

const CURRENT_PAGE_RE = /总结当前页|读这一页|读这页|这一页|这是什么网站|当前页|这个页面|本页|这页/;

/** 划词、页面引用，或用户明确说的是眼前这一页。这种任务不新开标签。 */
export function sidebarStaysOnUserTab(text: string, quotes?: Array<Pick<SparoQuote, "text">> | null): boolean {
  if (quotes && quotes.length > 0) return true;
  return CURRENT_PAGE_RE.test(String(text || ""));
}

const PAGE_TOOL_RE =
  /^(navigate|get_url|get_title|page_text|snapshot|click|fill|fill_suggest|press|pick_calendar|qa_check|click_text|menu_click|dismiss_overlays|scroll|go_back|reload|save_shot|save_image|set_file)$/;

/** 这个工具会碰到页面。侧栏开站任务要先有自己的标签。 */
export function sidebarToolNeedsPage(name: string): boolean {
  return PAGE_TOOL_RE.test(name);
}
