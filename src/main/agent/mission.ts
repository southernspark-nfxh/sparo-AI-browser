/**
 * 多步日常任务：规划器填槽 → 打开结果页 → 读页 → 汇成手册。
 * 与行程同一闭环，禁止停在站点首页。
 */
import {
  addDays,
  CTRIP_HOTEL_CITY_ID,
  ctripHotelListUrl,
  extractRoutePair,
  parseRelativeDate,
  trainSearchUrl,
  ymd,
} from "./travel.js";

export type MissionKind =
  | "local_outing"
  | "compare_shop"
  | "research"
  | "job_apply"
  | "rent"
  | "hospital"
  | "gov_errand"
  | "course"
  | "papers"
  | "logistics"
  | "home_appliance"
  | "weather"
  | "movies"
  | "translate"
  | "download"
  | "attractions"
  | "sourcing"
  | "insurance"
  | "events"
  | "social_hot"
  | "cross_border"
  | "saas"
  | "supply"
  | "tech_pick"
  | "media_ops"
  | "industry";

export type MissionStep = { label: string; url: string };

export type Mission = {
  kind: MissionKind;
  title: string;
  brief: string;
  slots: Record<string, string>;
  steps: MissionStep[];
};

const DIANPING_CITY: Record<string, string> = {
  北京: "2",
  上海: "1",
  广州: "4",
  深圳: "7",
  成都: "8",
  杭州: "3",
  南京: "5",
  武汉: "16",
  西安: "17",
  重庆: "9",
};

const CITIES = Object.keys(DIANPING_CITY).concat([
  "天津",
  "苏州",
  "长沙",
  "青岛",
  "厦门",
  "昆明",
  "大连",
]);

const FOOD = /川菜|火锅|粤菜|日料|烤肉|烧烤|江浙|西餐|海鲜|本帮|湘菜|东北菜|小吃|餐厅|吃饭/;

function pickCity(text: string, fallback = "北京"): string {
  return CITIES.find((c) => text.includes(c)) || fallback;
}

function q(s: string): string {
  return encodeURIComponent(s.trim());
}

function baidu(wd: string): string {
  return `https://www.baidu.com/s?wd=${q(wd)}`;
}

function quotedOf(text: string): string {
  const m =
    text.match(/[「『]([^」』]{1,40})[」』]/) ||
    text.match(/"([^"]{1,40})"/) ||
    text.match(/“([^”]{1,40})”/);
  return (m?.[1] || "").trim();
}

const WEATHER_CITY: Record<string, string> = {
  北京: "101010100",
  上海: "101020100",
  广州: "101280101",
  深圳: "101280601",
  杭州: "101210101",
  成都: "101270101",
  南京: "101190101",
  武汉: "101200101",
};

const OFFICIAL_DOWNLOAD: Record<string, string> = {
  "obs studio": "https://obsproject.com/download",
  obs: "https://obsproject.com/download",
  vscode: "https://code.visualstudio.com/download",
  chrome: "https://www.google.com/chrome/",
};

function softwareName(text: string): string {
  const quoted = quotedOf(text);
  if (quoted) return quoted;
  const m = text.match(
    /(?:下载|安装|找到)\s*([A-Za-z][A-Za-z0-9.\- ]{1,32}?)(?:\s*的|\s*官方|$)/,
  );
  return (m?.[1] || "软件").replace(/\s+/g, " ").trim();
}

function weekSpan(now: Date): { start: string; end: string } {
  const dow = now.getDay();
  const toMon = dow === 0 ? -6 : 1 - dow;
  const start = addDays(ymd(now), toMon);
  return { start, end: addDays(start, 6) };
}

const CTRIP_SIGHT: Record<string, string> = {
  成都: "chengdu104",
  北京: "beijing1",
  上海: "shanghai2",
  杭州: "hangzhou14",
  广州: "guangzhou152",
  深圳: "shenzhen26",
  南京: "nanjing9",
  重庆: "chongqing158",
  西安: "xian7",
  武汉: "wuhan145",
};

/** 快递100 的 com。SF 开头必须走顺丰，不要被收成 EMS。 */
export function expressCompany(no: string, text = ""): { com: string; label: string } {
  const n = String(no || "").toUpperCase();
  const t = text;
  if (/^SF\d|^SF[A-Z]|\b顺丰/.test(n + t) || /顺丰/.test(t)) return { com: "shunfeng", label: "顺丰" };
  if (/^YT|\b圆通/.test(n) || /圆通/.test(t)) return { com: "yuantong", label: "圆通" };
  if (/^ZT|\b中通/.test(n) || /中通/.test(t)) return { com: "zhongtong", label: "中通" };
  if (/^YD|\b韵达/.test(n) || /韵达/.test(t)) return { com: "yunda", label: "韵达" };
  if (/^JT|\b极兔/.test(n) || /极兔/.test(t)) return { com: "jtexpress", label: "极兔" };
  if (/^JD|\b京东/.test(n) || /京东快递/.test(t)) return { com: "jd", label: "京东" };
  if (/^STO|^ST\d|\b申通/.test(n) || /申通/.test(t)) return { com: "shentong", label: "申通" };
  if (/^EMS|邮政/.test(n + t)) return { com: "ems", label: "EMS" };
  return { com: "", label: "" };
}

export function expressTrackUrl(no: string, text = ""): string {
  const { com } = expressCompany(no, text);
  const qn = q(no);
  if (com) return `https://www.kuaidi100.com/chaxun?com=${com}&nu=${qn}`;
  return `https://www.kuaidi100.com/chaxun?nu=${qn}`;
}

function productName(text: string): string {
  const xm = text.match(/((?:索尼|Sony)\s*)?(WH-?\d{3,4}XM\d)/i);
  if (xm) return `${xm[1] || ""}${xm[2]}`.replace(/\s+/g, "").slice(0, 32);
  const quoted = text.match(/[「『""](.+?)[」』""]/);
  if (quoted?.[1]) return quoted[1].slice(0, 32);
  const m =
    text.match(
      /([A-Za-z0-9\u4e00-\u9fff·.\-]{2,32})\s*(?:在|的)?\s*(?:淘宝|京东|拼多多|官网|比价)/,
    ) || text.match(/(?:比价|对比|看看)\s*([A-Za-z0-9\u4e00-\u9fff·.\-]{2,32})/);
  const raw = (m?.[1] || text.replace(/帮我|比价|对比|看看|一下|淘宝|京东|拼多多|官网|和|与|在/g, " "))
    .replace(/\s+/g, " ")
    .trim();
  return raw.slice(0, 32) || "商品";
}

const BOSS_CITY: Record<string, string> = {
  北京: "101010100",
  上海: "101020100",
  广州: "101280100",
  深圳: "101280600",
  杭州: "101210100",
  成都: "101270100",
  南京: "101190100",
  武汉: "101200100",
};

/** 只跳过商城/点评首页。检索、列表、职位页必须打开并读。 */
export function shouldSkipHeavyPage(url: string): boolean {
  const raw = String(url || "");
  try {
    const u = new URL(raw);
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    const path = (u.pathname || "/").replace(/\/+$/, "") || "/";
    const mall = /(?:^|\.)(jd|taobao|tmall|dianping|maoyan|amazon|1688)\.com$/.test(host);
    if (!mall) return false;
    if (/search|list|keyword|item\.|detail|job/i.test(raw)) return false;
    if (host.startsWith("search.") || host.startsWith("s.")) return false;
    return path === "/";
  } catch {
    return /https?:\/\/(www\.)?(jd|taobao|tmall|dianping|maoyan|amazon|1688)\.com\/?$/i.test(raw);
  }
}

function topicOf(text: string): string {
  const m =
    text.match(/([A-Za-z][A-Za-z0-9+\-]{1,24}|[\u4e00-\u9fff]{2,16})(?:是什么|调研|笔记|百科)/) ||
    text.match(/(?:检索|调研|了解一下)\s*([A-Za-z0-9\u4e00-\u9fff+\-]{2,24})/);
  return (m?.[1] || text.replace(/帮我|做成笔记|打开|百度|知乎|百科|几篇|来源/g, "").trim()).slice(
    0,
    32,
  );
}

/** 新闻/评测只抽主题，不要把整句用户原话塞进检索。 */
export function newsTopic(text: string): string {
  const quoted =
    text.match(/[「『]([^」』]{2,24})[」』]/) ||
    text.match(/"([^"]{2,24})"/) ||
    text.match(/“([^”]{2,24})”/);
  if (quoted?.[1]) return quoted[1].replace(/\s+/g, "").slice(0, 16);
  const named = text.match(/关于\s*[「"“']?([A-Za-z0-9\u4e00-\u9fff]{2,16})/);
  if (named?.[1]) return named[1].replace(/\s+/g, "");
  const hit = text.match(/AI\s*浏览器|AI\s*写作(?:助手)?|宠物智能硬件|远程办公|协作工具/);
  if (hit) return hit[0].replace(/\s+/g, "");
  return "热点";
}

export function looksLikeMissionGoal(text: string): boolean {
  const t = text.trim();
  if (t.length < 6) return false;
  return /比价|比较|周末|周六|周日|看电影|聚餐|调研|做成笔记|是什么|挂号|租房|两居|居住证|选课|考证|文献|综述|快递|物流|投递|岗位|Boss|通勤|家电|求职|新闻汇总|评测|竞品|远程办公|宠物智能|喂食器|写作助手|AI写作|出差|天气|穿衣|带伞|场次|票价|翻译|下载|安装|打卡|门票|1688|供应商|论文|重疾险|展览|课程|热搜|亚马逊|签证|SaaS|GTM|BOM|技术选型|自媒体|行业研究|筛选|推荐几|元以内|xxl|T恤/i.test(
    t,
  );
}

function shopGoods(text: string): string {
  const quoted = quotedOf(text);
  if (quoted) return quoted;
  const goods = text.match(/T恤|t恤|卫衣|衬衫|牛仔裤|运动鞋|瑜伽垫|榨汁杯/i);
  if (goods) return /t恤/i.test(goods[0]) ? "T恤" : goods[0];
  const named = text.match(/(?:买|搜|找|筛选|推荐)\s*([A-Za-z0-9\u4e00-\u9fff]{2,12})/);
  if (named?.[1]) return named[1].replace(/码$/, "").slice(0, 12);
  return "商品";
}

function shopSize(text: string): string {
  const m = text.match(/\b(XXXL|XXL|XL|L|M|S)\b/i) || text.match(/(加大码|均码)/);
  return m ? m[1].toUpperCase() : "";
}

function shopBudget(text: string): string {
  const m = text.match(/(\d{2,5})\s*元/);
  return m?.[1] || "";
}

export function shopCount(text: string, fallback = 10): number {
  const n = text.match(/(\d{1,2})\s*款/);
  if (n) return Math.min(20, Math.max(3, Number(n[1])));
  const cn: Record<string, number> = { 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  const c = text.match(/([三四五六七八九十])\s*款/);
  if (c) return cn[c[1]] || fallback;
  return fallback;
}

export function shopSearchQueries(text: string, product: string): string[] {
  if (/T恤|t恤|tee/i.test(`${product}${text}`)) {
    return ["T恤男潮牌简约宽松", "男士短袖T恤 简约 纯棉", "重磅纯棉短袖T恤男"];
  }
  const style = [/简约|简洁/.test(text) ? "简约" : "", /潮|新潮/.test(text) ? "潮" : ""]
    .filter(Boolean)
    .join(" ");
  return [...new Set([style ? `${product} ${style}`.trim() : product, product])];
}

export function shopListUrl(keyword: string, budget?: string): string {
  const u = new URL("https://s.1688.com/selloffer/offer_search.htm");
  u.searchParams.set("keywords", keyword);
  u.searchParams.set("n", "y");
  if (budget) {
    u.searchParams.set("priceStart", "8");
    u.searchParams.set("priceEnd", budget);
  }
  return u.toString();
}

export function parseMission(text: string, now = new Date()): Mission | null {
  const t = text.trim();
  if (t.length < 6) return null;

  const urlHit = t.match(/https?:\/\/[^\s\u4e00-\u9fff<>"'）)】\]]+/i);
  if (urlHit && /翻译|总结|要点|摘要/.test(t)) {
    const page = urlHit[0].replace(/[.,，。、；;!?？]+$/g, "");
    return {
      kind: "translate",
      title: "网页翻译与要点",
      brief: "打开原文，用正文翻译成中文，要点不超过 5 条。没有的句子不要编。",
      slots: { url: page },
      steps: [{ label: "打开原文", url: page }],
    };
  }

  if (/天气/.test(t) && /穿衣|带伞|温度/.test(t) && !/打开百度|打开天气/.test(t)) {
    const city = pickCity(t);
    const when = parseRelativeDate(t, now) || addDays(ymd(now), 1);
    const code = WEATHER_CITY[city] || WEATHER_CITY.北京;
    return {
      kind: "weather",
      title: `${city} ${when} 天气`,
      brief: "打开天气结果页，读气温和降水，再给带伞和穿衣建议。没有的体感不要编。",
      slots: { city, date: when },
      steps: [
        { label: `${city} 天气预报`, url: `https://www.weather.com.cn/weather/${code}.shtml` },
        { label: `${city} ${when} 穿衣`, url: baidu(`${city} ${when} 天气 穿衣 带伞`) },
      ],
    };
  }

  if (
    /电影/.test(t) &&
    /上映|场次|猫眼|淘票票|评分/.test(t) &&
    !/吃|餐厅|聚餐|打卡|景点|展览|活动/.test(t)
  ) {
    const city = pickCity(t);
    const area = (t.match(/朝阳|海淀|浦东|南山|天河|锦江|武侯/) || [])[0] || "";
    const date = parseRelativeDate(t, now) || addDays(ymd(now), 1);
    return {
      kind: "movies",
      title: `${city}${area} ${date} 电影票`,
      brief: "猫眼影片首页会 403，先开淘票票再检索场次。按评分列 3 部，票价以页上为准。",
      slots: { city, area, date },
      steps: [
        { label: "淘票票热映", url: "https://www.taopiaopiao.com/" },
        {
          label: `${city}${area} ${date} 场次`,
          url: baidu(`${city}${area} ${date} 电影 评分 场次 票价`),
        },
        { label: `${city} 评分最高`, url: baidu(`${city} 正在上映 电影 评分最高`) },
      ],
    };
  }

  if (/下载|安装步骤|官方下载/.test(t) && /官方|版本|Windows|安装/.test(t)) {
    const name = softwareName(t);
    const official =
      OFFICIAL_DOWNLOAD[name.toLowerCase()] ||
      OFFICIAL_DOWNLOAD[name.toLowerCase().replace(/\s+/g, " ")];
    return {
      kind: "download",
      title: `${name} 官方下载`,
      brief: "先开官网下载页，再读版本号和 Windows 安装步骤。不点来路不明的镜像。",
      slots: { name },
      steps: [
        {
          label: `${name} 官网`,
          url: official || baidu(`${name} 官方下载 Windows`),
        },
        { label: `${name} 安装步骤`, url: baidu(`${name} Windows 官方 安装步骤`) },
      ],
    };
  }

  if (/打卡地|网红打卡|景点推荐/.test(t) && /门票|开放|特色|地址/.test(t)) {
    const city = pickCity(t, "成都");
    const dp = DIANPING_CITY[city] || "8";
    return {
      kind: "attractions",
      title: `${city} 打卡地`,
      brief: "打开点评/携程景点页，列 5 处：特色、地址、门票、开放时间。没有的写成未知。",
      slots: { city },
      steps: [
        {
          label: `${city} 携程景点`,
          url: `https://you.ctrip.com/sight/${CTRIP_SIGHT[city] || city}.html`,
        },
        { label: `${city} 点评景点`, url: `https://www.dianping.com/search/keyword/${dp}/35_${q("网红打卡")}` },
        { label: `${city} 门票开放`, url: baidu(`${city} 网红打卡地 门票 开放时间 地址`) },
      ],
    };
  }

  if (
    /1688/.test(t) &&
    /买|筛选|推荐|T恤|衣服|尺码/.test(t) &&
    !/拼多多|起订量|利润率|亚马逊|amazon/i.test(t)
  ) {
    const product = shopGoods(t);
    const size = shopSize(t);
    const budget = shopBudget(t);
    const count = String(shopCount(t, 10));
    const queries = shopSearchQueries(t, product);
    return {
      kind: "sourcing",
      title: `${product}${size ? ` ${size}` : ""}${budget ? ` ${budget}元内` : ""} 筛选`,
      brief: `打开 1688 结果列表，抽出 ${count} 款写成报告。不把 XXL/预算写进检索词，不点详情循环，不读百度。`,
      slots: { product, size, budget, count, intent: "buy", site: "1688" },
      steps: queries.map((keyword) => ({
        label: `1688 ${keyword}`,
        url: shopListUrl(keyword, budget),
      })),
    };
  }

  if (/1688/.test(t) && /拼多多|选品|起订/.test(t) && !/亚马逊|amazon/i.test(t)) {
    const product = quotedOf(t) || productName(t.replace(/拼多多|1688|供应商|选品/g, " "));
    return {
      kind: "sourcing",
      title: `${product} 选品调研`,
      brief: "只开 1688 与拼多多结果页。利润用页上数字估算，缺运费/佣金就标未知。",
      slots: { product },
      steps: [
        {
          label: `1688 ${product}`,
          url: `https://s.1688.com/selloffer/offer_search.htm?keywords=${q(product)}`,
        },
        {
          label: `拼多多 ${product}`,
          url: `https://mobile.yangkeduo.com/search_result.html?search_key=${q(product)}`,
        },
        { label: `${product} 利润口径`, url: baidu(`${product} 选品 利润率 起订量`) },
      ],
    };
  }

  if (/亚马逊|amazon/i.test(t) && /1688|供应商|利润|跨境/.test(t)) {
    const product = quotedOf(t) || "瑜伽垫";
    const en = /瑜伽垫/.test(product) ? "yoga mat" : product;
    return {
      kind: "cross_border",
      title: `${product} 跨境选品`,
      brief: "亚马逊竞品 + 1688 供应商。月销、运费、佣金页上没有就写未知，不要编。",
      slots: { product },
      steps: [
        { label: `Amazon ${en}`, url: `https://www.amazon.com/s?k=${q(en)}` },
        {
          label: `1688 ${product}`,
          url: `https://s.1688.com/selloffer/offer_search.htm?keywords=${q(product)}`,
        },
        { label: "佣金运费口径", url: baidu(`亚马逊 ${product} FBA 佣金 运费 利润`) },
      ],
    };
  }

  if (/重疾险|保险产品/.test(t)) {
    const names = ["平安福", "国寿福", "太平洋金佑人生"].filter((n) => t.includes(n.replace(/太平洋/, "")) || t.includes(n));
    const products = names.length ? names : ["平安福", "国寿福", "太平洋金佑人生"];
    return {
      kind: "insurance",
      title: "重疾险对比",
      brief: "只根据公开介绍页对比保障和保费。保费因年龄而异，没有试算就写未知。不代买。",
      slots: { products: products.join("、") },
      steps: products.map((name) => ({
        label: name,
        url: baidu(`${name} 重疾险 保障范围 保费 优缺点`),
      })),
    };
  }

  if (/展览|线下活动|值得去的展览/.test(t)) {
    const city = pickCity(t);
    const week = weekSpan(now);
    return {
      kind: "events",
      title: `${city} 本周展览`,
      brief: `打开活动检索，筛 ${week.start} 至 ${week.end}。门票和亮点以页上为准。`,
      slots: { city, start: week.start, end: week.end },
      steps: [
        { label: "豆瓣本周活动", url: "https://www.douban.com/location/beijing/events/week/" },
        { label: "活动行", url: "https://www.huodongxing.com/events" },
        { label: `${city} 展览门票`, url: baidu(`${city} 本周 展览 活动 门票 ${week.start}`) },
      ],
    };
  }

  if (/微博热搜|热搜前/.test(t)) {
    return {
      kind: "social_hot",
      title: "微博热搜",
      brief: "打开热搜榜，列前 10。观点倾向只根据可见评论，看不清就写未知。",
      slots: {},
      steps: [
        { label: "微博热搜榜", url: "https://s.weibo.com/top/summary" },
        { label: "热搜热议", url: baidu("今天 微博热搜 前10 观点") },
      ],
    };
  }

  if (/SaaS|项目管理工具|GTM/.test(t) && /竞品|功能对比|定价|定位/.test(t)) {
    return {
      kind: "saas",
      title: "项目管理 SaaS 竞品",
      brief: "检索国内外名单和公开定价。GTM 标成建议，数字必须有出处。",
      slots: { topic: "项目管理工具" },
      steps: [
        { label: "竞品名单", url: baidu("项目管理工具 竞品 Jira Asana Monday ClickUp 飞书 2026") },
        { label: "公开评测", url: baidu("项目管理工具 G2 Jira Asana Monday 对比 2026") },
        { label: "评价与渠道", url: baidu("Jira Asana Monday 用户评价 差评 营销渠道") },
      ],
    };
  }

  if (/供应链|BOM|零部件|组装厂/.test(t) && /台灯|灯珠|传感器|外壳/.test(t)) {
    return {
      kind: "supply",
      title: "智能台灯供应链",
      brief: "1688 查灯珠/传感器/外壳/组装。询价才能确定的价格写成区间或未知。",
      slots: { product: "智能台灯" },
      steps: [
        { label: "LED 灯珠", url: `https://s.1688.com/selloffer/offer_search.htm?keywords=${q("LED灯珠 台灯")}` },
        { label: "传感器", url: `https://s.1688.com/selloffer/offer_search.htm?keywords=${q("光线传感器 台灯")}` },
        { label: "外壳", url: `https://s.1688.com/selloffer/offer_search.htm?keywords=${q("台灯外壳 注塑")}` },
        { label: "组装厂", url: `https://s.1688.com/selloffer/offer_search.htm?keywords=${q("智能台灯 组装")}` },
        { label: "BOM 口径", url: baidu("智能台灯 BOM 成本 零售价") },
      ],
    };
  }

  if (/技术选型|前端框架|后端框架/.test(t) && /React|Vue|Angular|数据库/.test(t)) {
    return {
      kind: "tech_pick",
      title: "实时聊天技术选型",
      brief: "打开对比检索，按场景推荐。性能数字必须写来源。",
      slots: { scene: "实时聊天应用" },
      steps: [
        { label: "前端对比", url: baidu("React vs Vue vs Angular 2026 实时聊天") },
        { label: "后端对比", url: baidu("Node.js vs Go vs Python 后端 聊天 并发") },
        { label: "数据库对比", url: baidu("MongoDB vs PostgreSQL vs Redis 聊天 适用场景") },
      ],
    };
  }

  if (/自媒体|运营方案/.test(t) && /B站|抖音|小红书|公众号|选题/.test(t)) {
    const niche = quotedOf(t) || "AI工具评测";
    return {
      kind: "media_ops",
      title: `${niche} 运营方案`,
      brief: "检索各平台公开特点和同类账号。选题标成建议，不编粉丝数。",
      slots: { niche },
      steps: [
        { label: "B站抖音小红书公众号", url: baidu("B站 抖音 小红书 公众号 特点 变现 2026") },
        { label: `${niche} 账号`, url: baidu(`${niche} 自媒体 选题 差异化`) },
        { label: "增长变现", url: baidu(`${niche} 账号 涨粉 变现路径`) },
      ],
    };
  }

  if (/行业研究|行业报告/.test(t) || (/宠物经济/.test(t) && /市场|产业|投资/.test(t))) {
    const topic = quotedOf(t) || (/宠物经济/.test(t) ? "中国宠物经济" : topicOf(t));
    return {
      kind: "industry",
      title: `${topic} 研报`,
      brief: "只摘公开检索里的规模和玩家。付费报告里的精确份额没有就写未知。",
      slots: { topic },
      steps: [
        { label: `${topic} 规模`, url: baidu(`${topic} 市场规模 增长 2026`) },
        { label: `${topic} 产业链`, url: baidu(`${topic} 产业链 市场份额 玩家`) },
        { label: `${topic} 用户`, url: baidu(`${topic} 用户画像 消费习惯 投资`) },
      ],
    };
  }

  if (
    (/比价|比较.{0,12}(京东|淘宝|拼多多)|淘宝.{0,16}京东|京东.{0,16}淘宝|拼多多/.test(t) &&
      !/机票|酒店|家电|冰箱|1688|供应商|选品|起订|亚马逊/.test(t))
  ) {
    const product = productName(t);
    return {
      kind: "compare_shop",
      title: `${product} 买前比价`,
      brief: `对比「${product}」在京东、淘宝、拼多多的搜索结果，只汇总不代买。`,
      slots: { product },
      steps: [
        {
          label: `京东 ${product}`,
          url: `https://search.jd.com/Search?keyword=${q(product)}&enc=utf-8`,
        },
        {
          label: `淘宝 ${product}`,
          url: `https://s.taobao.com/search?q=${q(product)}`,
        },
        {
          label: `拼多多 ${product}`,
          url: `https://mobile.yangkeduo.com/search_result.html?search_key=${q(product)}`,
        },
      ],
    };
  }

  if (/出差/.test(t) && (/高铁|火车/.test(t) || (/酒店/.test(t) && /餐厅|本帮/.test(t)))) {
    const pair = extractRoutePair(t);
    const from = pair?.from || "北京";
    const to = pair?.to || pickCity(t, "上海");
    const date = parseRelativeDate(t, now) || addDays(ymd(now), 1);
    const dayHit = t.match(/([一二三四五六七八九十两\d]+)\s*天/);
    const nights = dayHit
      ? { 两: 2, 二: 2, 三: 3, 四: 4, 五: 5 }[dayHit[1]] || Number(dayHit[1]) || 2
      : 2;
    const leave = addDays(date, Math.max(1, nights));
    const area = (t.match(/陆家嘴|外滩|静安|徐家汇|望京|国贸|三里屯|南山|天河/) || [])[0] || "";
    const price = t.match(/(\d{3,4})\s*[-~到至]\s*(\d{3,4})/);
    const cityId = CTRIP_HOTEL_CITY_ID[to] || 2;
    const food = (t.match(FOOD)?.[0] || "本帮菜").replace(/吃饭/, "餐厅");
    const dpCity = DIANPING_CITY[to] || "1";
    const steps: MissionStep[] = [
      {
        label: `${from} → ${to} 火车 ${date}`,
        url: trainSearchUrl({
          kind: "train",
          site: "12306",
          from,
          to,
          date,
        }),
      },
    ];
    if (/酒店|住宿/.test(t)) {
      steps.push({
        label: `${to}${area || ""} 酒店`,
        url: ctripHotelListUrl(cityId, date, leave, {
          keyword: area || undefined,
          priceMin: price ? Number(price[1]) : undefined,
          priceMax: price ? Number(price[2]) : undefined,
        }),
      });
    }
    if (/餐厅|本帮|吃饭|川菜|火锅/.test(t)) {
      steps.push({
        label: `${to} ${food}`,
        url: `https://www.dianping.com/search/keyword/${dpCity}/10_${q(area ? `${area}${food}` : food)}`,
      });
    }
    return {
      kind: "local_outing",
      title: `${from}→${to} 出差`,
      brief: "火车走 12306，酒店走携程列表，餐厅走点评检索。不代订。",
      slots: { from, to, date, area, food },
      steps,
    };
  }

  if (
    (/冰箱/.test(t) && /洗衣机/.test(t)) ||
    (/家电/.test(t) && /万|清单|预算|新家/.test(t))
  ) {
    const catalog = [
      { key: "冰箱", query: "冰箱 性价比 一级能效" },
      { key: "洗衣机", query: "洗衣机 性价比" },
      { key: "空调", query: "空调 性价比 一级能效" },
      { key: "电视", query: "电视 性价比" },
    ];
    const named = catalog.filter((i) => t.includes(i.key));
    const items = named.length ? named : catalog;
    return {
      kind: "home_appliance",
      title: "新家家电清单",
      brief: "按品类打开京东结果页，列自营/国补型号和价，不代下单。",
      slots: { items: items.map((i) => i.key).join("、") },
      steps: items.map((i) => ({
        label: `京东 ${i.key}`,
        url: `https://search.jd.com/Search?keyword=${q(i.query)}&enc=utf-8`,
      })),
    };
  }

  if (
    /(周末|周六|周日|星期六|星期日|看电影|聚餐)/.test(t) &&
    /(吃|餐厅|电影|地铁|路线|安排|川菜|火锅)/.test(t) &&
    !/上映|场次|票价|猫眼|淘票票|评分最高/.test(t)
  ) {
    const city = pickCity(t);
    const date = parseRelativeDate(t, now) || "";
    const food = (t.match(FOOD)?.[0] || "餐厅").replace(/吃饭/, "餐厅");
    const steps: MissionStep[] = [
      {
        label: `${city} ${food} 餐厅`,
        url: `https://www.baidu.com/s?wd=${q(`${city} ${food} 餐厅 大众点评`)}`,
      },
    ];
    if (/电影/.test(t)) {
      steps.push({
        label: `${city} 电影场次`,
        url: `https://www.baidu.com/s?wd=${q(`${city} 正在上映 电影 猫眼`)}`,
      });
    }
    if (/地铁|路线|怎么走/.test(t)) {
      steps.push({
        label: `${city} 出行`,
        url: `https://www.amap.com/search?query=${q(`${city} 地铁`)}`,
      });
    }
    return {
      kind: "local_outing",
      title: `${date ? date + " " : ""}${city} 本地安排`,
      brief: `查${food}${/电影/.test(t) ? "和电影" : ""}，给出可点链接；地铁只给路线入口。`,
      slots: { city, date, food },
      steps,
    };
  }

  if (/新闻汇总|评测汇总|最近一周/.test(t) || (/评测|新闻/.test(t) && /汇总|最近/.test(t))) {
    const topic = newsTopic(t);
    return {
      kind: "research",
      title: `${topic} 新闻评测`,
      brief: "先读检索页，再开少量正文。日期以文内时间为准，检索摘要不算最近一周。",
      slots: { topic },
      steps: [
        {
          label: `百度搜 ${topic}`,
          url: `https://www.baidu.com/s?wd=${q(`${topic} 评测 2026`)}`,
        },
        {
          label: `百度资讯 ${topic}`,
          url: `https://www.baidu.com/s?tn=news&word=${q(`${topic} 2026`)}`,
        },
      ],
    };
  }

  if (/AI\s*浏览器/.test(t) && /竞品|官网|差评|Atlas|Comet|定价/.test(t)) {
    return {
      kind: "research",
      title: "AI 浏览器竞品",
      brief: "检索名单和公开评测。海外官网被拦就记 URL，不编定价。",
      slots: { topic: "AI浏览器" },
      steps: [
        {
          label: "检索竞品名单",
          url: `https://www.baidu.com/s?wd=${q("AI浏览器 竞品 官网 定价 Atlas Comet Arc")}`,
        },
        {
          label: "检索差评",
          url: `https://www.baidu.com/s?wd=${q("AI浏览器 差评 Atlas Comet")}`,
        },
      ],
    };
  }

  if (/远程办公|协作工具/.test(t) && /素材|调研|对比|工具|Slack|Notion|飞书/.test(t)) {
    return {
      kind: "research",
      title: "远程协作工具",
      brief: "检索公开定价，丢掉爱采购广告。没有来源的增长率不要写。",
      slots: { topic: "远程协作" },
      steps: [
        {
          label: "检索协作工具",
          url: `https://www.baidu.com/s?wd=${q("2026 远程协作工具对比 飞书 钉钉 Slack Zoom Notion")}`,
        },
        {
          label: "检索公开定价",
          url: `https://www.baidu.com/s?wd=${q("飞书 钉钉 Slack Notion 定价")}`,
        },
      ],
    };
  }

  if (/宠物/.test(t) && /智能硬件|喂食器/.test(t) && !/宠物经济/.test(t)) {
    return {
      kind: "research",
      title: "宠物智能硬件",
      brief: "规模数字并列来源；品牌只写京东列表里出现的。",
      slots: { topic: "宠物智能硬件" },
      steps: [
        {
          label: "市场规模",
          url: `https://www.baidu.com/s?wd=${q("宠物智能硬件 市场规模 2026")}`,
        },
        {
          label: "京东喂食器",
          url: `https://search.jd.com/Search?keyword=${q("智能喂食器")}&enc=utf-8`,
        },
        {
          label: "差评检索",
          url: `https://www.baidu.com/s?wd=${q("智能喂食器 差评")}`,
        },
      ],
    };
  }

  if (/AI\s*写作|写作助手/.test(t) && /竞品|对比|调研|定价|Jasper|豆包|元宝/.test(t)) {
    return {
      kind: "research",
      title: "AI 写作竞品",
      brief: "名单来自页面；空白点和定位单独标判断。",
      slots: { topic: "AI写作" },
      steps: [
        {
          label: "检索写作助手",
          url: `https://www.baidu.com/s?wd=${q("AI写作助手 竞品 定价 豆包 腾讯元宝 Jasper")}`,
        },
        {
          label: "检索评测",
          url: `https://www.baidu.com/s?wd=${q("豆包 腾讯元宝 写作 评测")}`,
        },
      ],
    };
  }

  if (/(是什么|调研|做成笔记|百科)/.test(t) && !/网站|这一页|当前页/.test(t)) {
    const topic = topicOf(t) || "主题";
    return {
      kind: "research",
      title: `${topic} 调研笔记`,
      brief: `打开检索和百科，只根据正文做笔记，每条带出处。`,
      slots: { topic },
      steps: [
        { label: `百度搜 ${topic}`, url: `https://www.baidu.com/s?wd=${q(topic)}` },
        { label: `维基百科 ${topic}`, url: `https://zh.wikipedia.org/w/index.php?search=${q(topic)}` },
        { label: `知乎 ${topic}`, url: `https://www.zhihu.com/search?type=content&q=${q(topic)}` },
      ],
    };
  }

  if (/Boss|BOSS直聘|投递|岗位|招聘|求职/.test(t) && /经理|工程师|设计|运营|JD|岗位|产品/.test(t)) {
    const role =
      (t.match(/(AI\s*产品经理|产品经理|设计师|运营|工程师)/) ||
        t.match(/([\u4e00-\u9fffA-Za-z]{2,12}(?:经理|工程师|设计师))/))?.[1] || "产品经理";
    const city = pickCity(t);
    const cityCode = BOSS_CITY[city] || "101010100";
    const salary = /20\s*[kK万]|2万/.test(t) ? "406" : "";
    const scale = /100\s*人/.test(t) ? "303" : "";
    const qs = [
      `query=${q(role)}`,
      `city=${cityCode}`,
      salary ? `salary=${salary}` : "",
      scale ? `scale=${scale}` : "",
      /7\s*天|近一周|最新/.test(t) ? "sort=2" : "",
    ]
      .filter(Boolean)
      .join("&");
    return {
      kind: "job_apply",
      title: `${role} 岗位阅读`,
      brief: "打开招聘结果页，读要求，不代投。薪资读不清就写页上加密。",
      slots: { role, city, salary, scale },
      steps: [{ label: `搜 ${role}`, url: `https://www.zhipin.com/web/geek/job?${qs}` }],
    };
  }

  if (/租房|两居|一居|三居/.test(t)) {
    const city = pickCity(t);
    const area =
      ["西二旗", "陆家嘴", "三里屯", "望京", "国贸", "南山", "天河", "海淀", "朝阳"].find((a) =>
        t.includes(a),
      ) || city;
    const host = city === "上海" ? "sh" : city === "深圳" ? "sz" : city === "广州" ? "gz" : "bj";
    const rooms = /一居/.test(t) ? "一居室" : /两居|二居/.test(t) ? "两居室" : /三居/.test(t) ? "三居室" : "租房";
    return {
      kind: "rent",
      title: `${area} ${rooms} 对比`,
      brief: "打开链家、贝壳、自如结果页，列 3 套并带链接。登录墙如实说。",
      slots: { city, area, rooms },
      steps: [
        { label: `链家 ${area}`, url: `https://${host}.lianjia.com/zufang/rs${q(area)}/` },
        { label: `贝壳 ${area}`, url: `https://${host}.ke.com/zufang/rs${q(area)}/` },
        { label: `自如 ${area}`, url: baidu(`自如 ${city} ${area} ${rooms}`) },
        { label: `${area} ${rooms} 检索`, url: baidu(`${city} ${area} ${rooms} 链家 自如 贝壳`) },
      ],
    };
  }

  if (/挂号|看诊|皮肤科|内科|牙科/.test(t)) {
    const city = pickCity(t);
    const dept = (t.match(/皮肤科|内科|牙科|眼科|骨科/) || [])[0] || "门诊";
    return {
      kind: "hospital",
      title: `${city}${dept} 挂号路径`,
      brief: "打开说明页，写清怎么挂；登录挂号由人点。",
      slots: { city, dept },
      steps: [
        { label: `${city}${dept} 挂号`, url: `https://www.baidu.com/s?wd=${q(`${city} ${dept} 挂号 微医`)}` },
        { label: "微医挂号说明", url: `https://www.guahao.com/search/hospital?q=${q(city + dept)}` },
      ],
    };
  }

  if (/居住证|材料清单|政务办事/.test(t)) {
    const city = pickCity(t, "上海");
    const matter = t.includes("居住证") ? "居住证" : "办事材料";
    return {
      kind: "gov_errand",
      title: `${city}${matter} 清单`,
      brief: "打开官方检索，只摘材料，不编造窗口电话。",
      slots: { city, matter },
      steps: [
        { label: `${city}${matter} 官方`, url: `https://www.baidu.com/s?wd=${q(`${city} ${matter} 官方 材料清单 site:gov.cn`)}` },
      ],
    };
  }

  if (/选课|考证|课程.{0,8}对比|对比.{0,12}课|在线课程|Coursera|Udemy|网易云课堂/.test(t)) {
    const course = quotedOf(t) || (t.match(/([\u4e00-\u9fffA-Za-z]{2,24}(?:课|证|分析))/) || [])[1] || "课程";
    const en = /python/i.test(course) ? "Python data analysis" : course;
    return {
      kind: "course",
      title: `${course} 课程对比`,
      brief: "打开 Coursera / Udemy / 网易云课堂结果页。报名表不代提交。",
      slots: { course },
      steps: [
        { label: `Coursera ${course}`, url: `https://www.coursera.org/search?query=${q(en)}` },
        { label: `Udemy ${course}`, url: `https://www.udemy.com/courses/search/?q=${q(en)}` },
        { label: `网易云课堂 ${course}`, url: `https://study.163.com/courses-search?keyword=${q(course)}` },
      ],
    };
  }

  if (/文献|综述|论文/.test(t)) {
    const topic = quotedOf(t) || topicOf(t) || "研究";
    return {
      kind: "papers",
      title: `${topic} 文献卡片`,
      brief: "打开学术检索，按引用和时间列 5 篇。没有引用数就写未知，不编页码。",
      slots: { topic },
      steps: [
        { label: `Google Scholar ${topic}`, url: `https://scholar.google.com/scholar?q=${q(topic)}&as_ylo=2023` },
        { label: `${topic} 论文检索`, url: baidu(`${topic} 高引用 论文 摘要 2023 2024 2025 2026`) },
        { label: `百度学术 ${topic}`, url: `https://xueshu.baidu.com/s?wd=${q(topic)}&sort=sc_cited` },
      ],
    };
  }

  if (/快递|物流|单号|申通|圆通|顺丰|中通/.test(t) && !/机票/.test(t)) {
    const no = (t.match(/\b([A-Za-z0-9]{10,18})\b/) || [])[1];
    const co = no ? expressCompany(no, t) : { com: "", label: "" };
    return {
      kind: "logistics",
      title: no ? `运单 ${no}` : "查快递路径",
      brief: "打开快递100，按单号前缀认公司。没有轨迹就写查无结果，不要编。",
      slots: { no: no || "", company: co.label },
      steps: no
        ? [
            { label: `查 ${co.label || "快递"} ${no}`, url: expressTrackUrl(no, t) },
            { label: `${no} 轨迹检索`, url: baidu(`${no} ${co.label || "快递"} 物流轨迹`) },
          ]
        : [{ label: "快递100", url: "https://www.kuaidi100.com/" }],
    };
  }

  // 通用多品买前对比（无专门品类分支时兜底）：X 和 Y 哪个值得买 / 三款对比出报告
  if (
    !/机票|酒店|高铁|火车|景点|旅游|行程|目的地|城市|餐厅|美食/.test(t) &&
    (/哪个值得买|哪个更值得|哪款值得|哪个好|哪款好|选哪[个款]|怎么选|对比报告|买前/.test(t) ||
      (/对比|比价/.test(t) && /价格|参数|配置|预算|性价比|评测|优缺点|值得买/.test(t)))
  ) {
    const head =
      t
        .split(/[，。,.！!？?]/)[0]
        .replace(/^在?\d+\s*元?预算[下内以]?/, " ")
        .replace(
          /帮我|麻烦|请问|想问下?|出一?个?对比报告?|哪个值得买|哪个更值得|哪款值得|哪个好|哪款好|选哪[个款]|怎么选|对比|比价|值得买/g,
          " ",
        )
        .replace(/\s+/g, "")
        .replace(/^在/, "")
        .slice(0, 36) || "商品";
    // 候选品抽取：对原话全文做品牌词切（候选品常在第二分句且无分隔符：
    // 「预算5000买轻薄本，联想小新Pro14、华为MateBook 14、MacBook Air M3三款对比」），
    // 退回按 和/与/、 切。这是原话里的确定性事实，本地听写要准。
    const BRANDS =
      "联想|华为|荣耀|小米|红米|REDMI|苹果|MacBook|iPhone|iPad|戴尔|惠普|华硕|宏碁|微星|神舟|戴森|徕芬|追觅|美的|格力|海尔|松下|飞利浦|苏泊尔|九阳|小熊|大疆|索尼|佳能|尼康|BOSE|JBL|ThinkPad|Switch";
    const BRAND_HEAD = new RegExp(`^(?:${BRANDS})`);
    const blob = t.replace(/\s+/g, "").slice(0, 60);
    const brandSplit = blob
      .split(new RegExp(`(?=${BRANDS})`))
      .map((s) =>
        s
          .split(/[，。,、]|对比|哪个|怎么选|值得买/)[0]
          .replace(/(和|与|、)+$/, "")
          .replace(/[两三四几]款?$/, "")
          .replace(/款?(轻薄本|笔记本电脑?|游戏本|吹风机|手机|平板电脑?|耳机|手表|吸尘器)$/, "")
          .trim(),
      )
      .filter((s) => BRAND_HEAD.test(s) && s.length >= 3 && s.length <= 20)
      .slice(0, 4);
    const candidates = brandSplit.length
      ? brandSplit
      : head
          .split(/和|与|、|,|，|\s+/)
          .map((s) =>
            s
              .replace(/^[这那两三四几]款?/, "")
              .replace(/[两三四几]款?$/, "")
              .replace(/款?(轻薄本|笔记本电脑?|游戏本|吹风机|手机|平板电脑?|耳机|手表)$/, ""),
          )
          .filter((s) => s.length >= 2 && s.length <= 12)
          .slice(0, 3);
    const category =
      head.match(/吹风机|轻薄本|笔记本电脑?|游戏本|手机|平板电脑?|耳机|手表|吸尘器|空调|冰箱|洗衣机/)?.[0] ||
      "";
    const [c0 = "", c1 = ""] = candidates;
    const steps: MissionStep[] =
      candidates.length >= 2
        ? [
            { label: `${c0} vs ${c1} 对比评测`, url: baidu(`${c0} ${c1} 对比 评测`) },
            { label: `${c0} ${c1} 参数价格`, url: baidu(`${c0} ${c1} 参数 价格`) },
            {
              label: `京东 ${category || head}`,
              url: `https://search.jd.com/Search?keyword=${q(category || head)}&enc=utf-8`,
            },
            ...candidates.slice(0, 3).map((c) => ({
              label: `${c} 评测与缺点`,
              url: baidu(`${c} 评测 缺点 吐槽`),
            })),
          ].slice(0, 6)
        : [
            { label: `${head} 对比评测`, url: baidu(`${head} 对比 评测 哪个值得买`) },
            { label: `${head} 参数价格`, url: baidu(`${head} 参数 价格 区别`) },
            {
              label: `什么值得买 ${category || head}`,
              url: `https://search.smzdm.com/?c=home&s=${q(head)}&v=b`,
            },
            {
              label: `京东 ${category || head}`,
              url: `https://search.jd.com/Search?keyword=${q(category || head)}&enc=utf-8`,
            },
            ...candidates.map((c) => ({
              label: `${c} 评测与缺点`,
              url: baidu(`${c} 评测 缺点 吐槽`),
            })),
          ].slice(0, 6);
    return {
      kind: "research",
      title: `${head} 买前对比`,
      brief:
        "按用户原话给的维度（价格、参数、优缺点等）做对照表，每条带出处；查不到的格子写未知，不编参数和价格。",
      slots: { topic: head },
      steps,
    };
  }

  return null;
}

export function tripEatPlayMission(plan: { cities: string[] }): Mission {
  const cities = (plan.cities || []).filter(Boolean).slice(0, 3);
  const steps: MissionStep[] = [];
  for (const city of cities) {
    steps.push({
      label: `${city} 必吃`,
      url: baidu(`${city} 必吃 美食 推荐`),
    });
    steps.push({
      label: `${city} 必去`,
      url: baidu(`${city} 必去景点 推荐`),
    });
  }
  return {
    kind: "attractions",
    title: `${cities.join("、")} 吃喝玩`,
    brief: "只读百度检索页，每城列出吃/玩。不要打开点评首页。没有的写未知。",
    slots: { cities: cities.join("、") },
    steps,
  };
}

export function missionProgress(m: Mission): string {
  return `${m.brief} 先打开结果页再汇总，不在首页空点。`;
}

export function missionSynthesizePrompt(
  userAsk: string,
  mission: Mission,
  findings: Array<{ label: string; url: string; text: string }>,
): string {
  const blocks = findings
    .map((f, i) => `### ${i + 1}. ${f.label}\n网址：${f.url}\n${f.text.slice(0, 1200)}`)
    .join("\n\n");
  return [
    "用户要一份能执行的结果，不是读当前随便一页。",
    `任务：${mission.title}。${mission.brief}`,
    "只根据下面各步正文。没有的店名、价格、岗位、销量、保费写成未知，不要编。",
    "店、商品、岗位、文章必须写成 [名称](链接)。没有链接就不要假造名称。",
    "登录墙或验证码如实说，仍给出已打开的结果页链接。",
    "付钱、投递、挂号提交、退款必须写「请你在窗口里点」。",
    mission.kind === "weather"
      ? "先写天气和温度区间，再判断带伞，最后给穿衣建议。建议必须扣住页上气温。"
      : "",
    mission.kind === "movies"
      ? "只列评分最高的最多 3 部。每部写名称、评分、类型、至少 2 个场次和票价。没有场次就写未知并留猫眼链接。"
      : "",
    mission.kind === "translate"
      ? "先写标题，再译关键段，最后不超过 5 条要点。页是空的就说打不开，不要编文章。"
      : "",
    mission.kind === "download"
      ? "必须给出官网链接、版本号、Windows 下载链、分步安装。镜像站不要当官网。"
      : "",
    mission.kind === "attractions"
      ? /吃喝玩/.test(mission.title)
        ? "每座城分「吃」和「玩」。吃写店名、菜、人均；玩写景点、门票、开放时间。没有的写未知。不要写成商品筛选报告。"
        : "列 5 个地点，每条：特色、地址、门票、开放时间。没有门票就写免费或未知。"
      : "",
    mission.kind === "research"
      ? "写成给人看的清单：每个推荐项写名称、链接、一句话理由。不要照抄检索页原文；页脚、「大家还在搜」、热搜、广告一律不要。没有的写未知。"
      : "",
    mission.kind === "sourcing" && mission.slots.intent === "buy"
      ? `这是帮人挑货，不是算利润。只从列表页选最多 ${mission.slots.count || 10} 款。每款写：名称、价格、是否有该尺码、评分/销量、为什么符合预算和风格、链接。没有的字段写未知。不要编。不要建议再点进详情循环。不要输出检索页页脚、热门搜索、空空如也原文。`
      : mission.kind === "sourcing" || mission.kind === "cross_border"
        ? "供应商和售价必须来自页上。利润=售价-供货-运费-佣金；缺一项就不要算出精确利润率。"
        : "",
    mission.kind === "papers"
      ? "最多 5 篇，写标题、作者、年份、摘要、引用量。引用量没有就写未知。只列近 3 年能确认的。"
      : "",
    mission.kind === "rent"
      ? "三个平台对照后给出性价比最高 3 套：地址、价格、面积、平台、链接。"
      : "",
    mission.kind === "insurance"
      ? "做成对比表：保障范围、保费、优缺点。保费随年龄变化，没有试算器数字就写未知。不代买。"
      : "",
    mission.kind === "events"
      ? "至少 5 个本周活动：名称、地点、时间、门票、亮点。"
      : "",
    mission.kind === "course"
      ? "三平台对照后给出评分最高 3 门：课名、讲师、价格、课时、评分、平台。"
      : "",
    mission.kind === "social_hot"
      ? "热搜前 10：话题、热度、主要内容、倾向。评论看不见就倾向写未知。"
      : "",
    mission.kind === "saas"
      ? "8 个竞品、功能矩阵、定价、正负面评价、渠道、空白点、定位和 GTM。没有的数字标判断。"
      : "",
    mission.kind === "supply"
      ? "灯珠/传感器/外壳/组装分开写价格区间。BOM 只能加总页上数字。建议零售价标成估算。"
      : "",
    mission.kind === "tech_pick"
      ? "三张对比表 + 推荐栈和理由，扣住实时聊天场景。"
      : "",
    mission.kind === "media_ops"
      ? "平台选择、定位、10 个选题、变现、增长。不要编粉丝量和收益。"
      : "",
    mission.kind === "industry"
      ? "按研报结构写。规模和份额必须带出处。付费报告里的精确数字没有就写未知。"
      : "",
    mission.kind === "logistics"
      ? "写快递公司、状态、当前位置、预计送达、轨迹时间线。页上没有预计送达就写未知。"
      : "",
    `用户原话：${userAsk}`,
    blocks,
  ].join("\n");
}
