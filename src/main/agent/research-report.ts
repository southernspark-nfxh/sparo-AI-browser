/**
 * 死规则：多种信息调研必须落成报告页，禁止把对照表堆进侧栏。
 */
import type { MissionKind } from "./mission.js";

/** 多源对照 / 筛选 / 研报：必须出报告页。单页查询（天气、翻译、快递）除外。 */
export const RESEARCH_MISSION_KINDS = new Set<MissionKind>([
  "local_outing",
  "compare_shop",
  "research",
  "job_apply",
  "rent",
  "course",
  "papers",
  "home_appliance",
  "movies",
  "attractions",
  "sourcing",
  "insurance",
  "events",
  "social_hot",
  "cross_border",
  "saas",
  "supply",
  "tech_pick",
  "media_ops",
  "industry",
]);

export function missionNeedsReport(kind: MissionKind): boolean {
  return RESEARCH_MISSION_KINDS.has(kind);
}

/** 行程后的吃喝玩，不是 1688 选品。 */
export function looksLikeEatPlayAsk(text: string): boolean {
  const t = String(text || "").trim();
  if (!t || t.length > 48) return false;
  if (/1688|比价|T恤|选品|起订|供应商/.test(t)) return false;
  return /吃的|玩的|美食|景点|好吃|好玩|怎么玩|去哪玩/.test(t);
}

export function shouldSealShopReport(userAsk: string, body: string): boolean {
  if (looksLikeEatPlayAsk(userAsk)) return false;
  return looksLikeResearchAsk(userAsk) || looksLikeResearchBody(body);
}

export function looksLikeResearchAsk(text: string): boolean {
  const t = String(text || "").trim();
  if (t.length < 8) return false;
  if (/1688/.test(t) && /买|筛选|推荐|T恤|衣服|供应商|选品/.test(t)) return true;
  // 比价/对比/调研/热搜/文献本身就是多源对照的强信号
  if (/比价|对比|货比|调研|研报|竞品|热搜|热榜|排行榜|综述|论文|文献|值不值得|适不适合|值得去/.test(t)) {
    return true;
  }
  const shop = /买|筛选|推荐几|帮我选|挑几款|比价|对比|调研|竞品|选品|做成笔记|研报/;
  const multi =
    /评分|价格|元以内|以内|尺码|码|起订|性价比|几款|三家|平台|清单|笔记|审美|新潮|简洁/;
  return shop.test(t) && multi.test(t);
}

/** 检索页正文清洗：截掉「大家还在搜」和热榜，去掉孤立杂行。 */
export function cleanSearchPageText(text: string): string {
  let t = String(text || "");
  t = t.split(/大家还在搜|百度热榜|热搜榜|相关搜索推荐|为您推荐/)[0];
  return t
    .split("\n")
    .filter((line) => {
      const s = line.trim();
      if (!s) return false;
      if (s.length <= 4 && /^(正在思考|播报|暂停|听|播放|展开|收起)$/.test(s)) return false;
      return true;
    })
    .join("\n")
    .trim();
}

export function looksLikeResearchBody(text: string): boolean {  const t = String(text || "");
  if (/陷入了重复工具调用/.test(t)) return true;
  if (t.length >= 800 && /价格|评分|推荐|对比|供应商|起订/.test(t)) return true;
  const rows = t.match(/^\s*[-*|]|\|/gm) || [];
  return rows.length >= 6;
}

export function researchChatBrief(title: string): string {
  const name = String(title || "筛选").trim() || "筛选";
  if (/吃喝玩/.test(name)) return `吃喝玩已写好：${name}。窗口里打开了完整页。`;
  return `筛选报告已写好：${name}。窗口里打开了完整页，侧栏不再堆对照文字。`;
}

export function tripChatBrief(title: string): string {
  return `行程手册已写好：${title}。窗口里打开了完整页。`;
}

export function researchReportTitle(userAsk: string, fallback = "筛选报告"): string {
  const t = String(userAsk || "").replace(/\s+/g, " ").trim();
  if (/1688/.test(t) && /T恤|t恤/i.test(t)) return "1688 T恤筛选";
  if (/比价/.test(t)) return `${fallback}`.replace(/筛选报告/, "买前比价");
  if (looksLikeEatPlayAsk(t)) return "吃喝玩推荐";
  return fallback;
}

export function reportChips(slots: Record<string, string>): string[] {
  const skip = new Set(["intent", "site"]);
  const out: string[] = [];
  for (const [k, v] of Object.entries(slots || {})) {
    const val = String(v || "").trim();
    if (!val || skip.has(k)) continue;
    if (k === "budget") out.push(`${val}元内`);
    else if (k === "count") out.push(`${val}款`);
    else out.push(val);
  }
  return out;
}

export type ShopOffer = {
  name: string;
  url: string;
  price?: string;
  sales?: string;
  shop?: string;
};

const SHOP_JUNK =
  /工作服|文化衫|印logo|印Logo|定制logo|战友|建军|秋裤|保暖裤|广告衫|团体|企业周年|工装|工衣|道教|法器|polo衫定制|翻领t恤短袖工装|polo战友/i;

export function isShopJunkTitle(name: string): boolean {
  return SHOP_JUNK.test(String(name || ""));
}

export function offerYuan(price?: string): number | null {
  const m = String(price || "").replace(/,/g, "").match(/(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : null;
}

export function filterShopOffers(
  offers: ShopOffer[],
  opts: { budget?: number; want?: number },
): ShopOffer[] {
  const want = Math.min(20, Math.max(3, opts.want || 10));
  const budget = opts.budget && opts.budget > 0 ? opts.budget : 0;
  const seen = new Set<string>();
  const scored: Array<ShopOffer & { score: number }> = [];
  for (const raw of offers) {
    const name = String(raw.name || "").replace(/\s+/g, " ").trim();
    const url = String(raw.url || "");
    if (name.length < 6 || !/^https?:/i.test(url) || isShopJunkTitle(name)) continue;
    const id = (url.match(/offer\/(\d{8,})/) || url.match(/offerId=(\d{8,})/) || [])[1] || url;
    if (seen.has(id)) continue;
    const yuan = offerYuan(raw.price);
    if (budget && yuan !== null && yuan > budget) continue;
    seen.add(id);
    let score = 0;
    if (/短袖|纯棉|宽松|简约|纯色|重磅|水洗/.test(name)) score += 2;
    if (/潮|ins|美式|日系/.test(name)) score += 1;
    if (/长袖|翻领|Polo|polo|卫衣/.test(name)) score -= 1;
    if (yuan !== null) score += 1;
    scored.push({
      name: name.slice(0, 72),
      url: /offer\/\d+/.test(url)
        ? `https://detail.1688.com/offer/${id}.html`
        : url,
      price: raw.price,
      sales: raw.sales,
      shop: raw.shop,
      score,
    });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, want).map(({ score: _s, ...o }) => o);
}

export function formatShopPicks(
  offers: ShopOffer[],
  opts: { userAsk: string; count: number; searchUrls: string[] },
): string {
  if (!offers.length) {
    const links = opts.searchUrls
      .map((u, i) => `${i + 1}. [1688 检索 ${i + 1}](${u})`)
      .join("\n");
    return [
      "列表里没抽出能用的短袖 T 恤。常见原因：检索词过窄、页还没刷出卡片、或这一页全是工作服/定制衫。",
      "请点开下面检索页再看，或换一句更短的词。",
      links,
    ].join("\n\n");
  }
  const rows = offers.map((o, i) => {
    const price = o.price || "未知";
    const sales = o.sales || "未知";
    const shop = o.shop || "未知";
    return `| ${i + 1} | [${o.name}](${o.url}) | ${price} | ${sales} | ${shop} |`;
  });
  return [
    `按你的要求从 1688 列表筛了 ${offers.length} 款（目标 ${opts.count} 款）。尺码是否有 ${/xxl/i.test(opts.userAsk) ? "XXL" : "你要的码"}，以下单页为准。`,
    "",
    "| # | 款式 | 价格 | 销量 | 店铺 |",
    "|---|---|---|---|---|",
    ...rows,
    "",
    "已去掉工作服、秋裤、聚会定制衫。付钱请你在窗口里点。",
  ].join("\n");
}
