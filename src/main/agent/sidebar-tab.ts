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
/** 人明确要离开眼前这一页。新开标签和另开一扇都算。 */
export function asksToLeavePage(text: string): boolean {
  return /新窗口|另开一扇|再开一扇|新开(?:一个)?标签|另开(?:一个)?标签|再开(?:一个)?标签/.test(String(text || ""));
}

export function visiblePageKeepsTurn(text: string): boolean {
  const raw = String(text || "").trim();
  if (!raw) return false;
  if (asksToLeavePage(raw)) return false;
  if (/https?:\/\//i.test(raw)) return false;
  if (/打开|前往|去看|跳到/.test(raw)) return false;
  return true;
}

const SITE_HOSTS: Array<{ re: RegExp; host: string }> = [
  { re: /微博|weibo/i, host: "weibo.com" },
  { re: /知乎|zhihu/i, host: "zhihu.com" },
  { re: /头条|toutiao/i, host: "toutiao.com" },
  { re: /百家号|baijiahao/i, host: "baijiahao.baidu.com" },
  { re: /京东|(?:^|[^a-z])jd(?:\.com)?/i, host: "jd.com" },
  { re: /淘宝|taobao/i, host: "taobao.com" },
  { re: /小红书|xiaohongshu|xhslink/i, host: "xiaohongshu.com" },
];

function hostMatches(pageHost: string, siteHost: string): boolean {
  if (pageHost === siteHost || pageHost.endsWith(`.${siteHost}`)) return true;
  return siteHost.includes("weibo") && pageHost.includes("weibo");
}

/** 人已经在这个站上。去站内的某个人、某条内容，仍用眼前这一页，不另开。 */
export function sameSiteWork(text: string, pageUrl: string): boolean {
  const raw = String(text || "");
  if (asksToLeavePage(raw)) return false;
  let host = "";
  try {
    host = new URL(pageUrl).hostname.replace(/^www\./, "").replace(/^m\./, "").toLowerCase();
  } catch {
    return false;
  }
  if (!host) return false;
  const named = SITE_HOSTS.filter((site) => site.re.test(raw));
  if (!named.length) return false;
  return named.every((site) => hostMatches(host, site.host));
}

const PAGE_TOOL_RE =
  /^(navigate|get_url|get_title|page_text|snapshot|click|fill|fill_suggest|press|pick_calendar|qa_check|click_text|menu_click|dismiss_overlays|scroll|go_back|reload|save_shot|save_image|set_file)$/;

/** 这个工具会碰到页面。侧栏开站任务要先有自己的标签。 */
export function sidebarToolNeedsPage(name: string): boolean {
  return PAGE_TOOL_RE.test(name);
}
