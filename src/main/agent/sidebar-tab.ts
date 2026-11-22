import type { SparoQuote } from "./quotes.js";

/** 侧栏工位的 clientId。不占甲乙丙的座位号。 */
export const SIDEBAR_CLIENT_ID = "sidebar";

/**
 * 用户在说眼前这一页。中间可以插「的 / 这个 / 外国」，
 * 「当前的页面」「当前这个网页」「这个外国网页」都算。
 * 「打开微博」这类点名别的站点不算。
 */
const CURRENT_PAGE_RE =
  /总结当前页|读这一页|读这页|这一页|这是什么网站|当前(?:的|这个)?(?:网页|页面|窗口|页)|这个(?:外国)?(?:网页|页面|网站)|这个窗口|就用这个窗口|本页|这页|眼前这(?:页|个网页)|正在看的(?:网页|页面|网站)/;

/** 划词、页面引用，或用户明确说的是眼前这一页。这种任务不新开标签。 */
export function sidebarStaysOnUserTab(text: string, quotes?: Array<Pick<SparoQuote, "text">> | null): boolean {
  if (quotes && quotes.length > 0) return true;
  return CURRENT_PAGE_RE.test(String(text || ""));
}

/**
 * 人已经停在一张网页上。这句话没有要求打开别处、另开窗口或给出网址，
 * 就在眼前这一页回答，不要为此弹出百度首页。
 */
export function visiblePageKeepsTurn(text: string): boolean {
  const raw = String(text || "").trim();
  if (!raw) return false;
  if (/新窗口|另开一扇|再开一扇/.test(raw)) return false;
  if (/https?:\/\//i.test(raw)) return false;
  if (/打开|前往|去看|跳到/.test(raw)) return false;
  return true;
}

const PAGE_TOOL_RE =
  /^(navigate|get_url|get_title|page_text|snapshot|click|fill|fill_suggest|press|pick_calendar|qa_check|click_text|menu_click|dismiss_overlays|scroll|go_back|reload|save_shot|save_image|set_file)$/;

/** 这个工具会碰到页面。侧栏开站任务要先有自己的标签。 */
export function sidebarToolNeedsPage(name: string): boolean {
  return PAGE_TOOL_RE.test(name);
}
