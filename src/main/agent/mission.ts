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
  | "home_appliance";

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
    const mall = /(?:^|\.)(jd|taobao|tmall|dianping|maoyan)\.com$/.test(host);
    if (!mall) return false;
    if (/search|list|keyword|item\.|detail|job/i.test(raw)) return false;
    if (host.startsWith("search.") || host.startsWith("s.")) return false;
    return path === "/";
  } catch {
    return /https?:\/\/(www\.)?(jd|taobao|tmall|dianping|maoyan)\.com\/?$/i.test(raw);
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
  return /比价|比较|周末|周六|周日|看电影|聚餐|调研|做成笔记|是什么|挂号|租房|两居|居住证|选课|考证|文献|综述|快递|物流|投递|岗位|Boss|通勤|家电|求职|新闻汇总|评测|竞品|远程办公|宠物智能|喂食器|写作助手|AI写作|出差/.test(
    t,
  );
}

export function parseMission(text: string, now = new Date()): Mission | null {
  const t = text.trim();
  if (t.length < 6) return null;

  if (
    (/比价|比较.{0,12}(京东|淘宝|拼多多)|淘宝.{0,16}京东|京东.{0,16}淘宝|拼多多/.test(t) &&
      !/机票|酒店|家电|冰箱/.test(t))
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
    /(吃|餐厅|电影|地铁|路线|安排|川菜|火锅)/.test(t)
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

  if (/宠物/.test(t) && /智能|硬件|喂食器|市场/.test(t)) {
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
    const area = (t.match(/望京|国贸|三里屯|陆家嘴|南山|天河/) || [])[0] || city;
    const host = city === "上海" ? "sh" : city === "深圳" ? "sz" : city === "广州" ? "gz" : "bj";
    return {
      kind: "rent",
      title: `${area} 租房候选`,
      brief: "打开房源列表，列 3 套并带链接；通勤用地图页。",
      slots: { city, area },
      steps: [
        { label: `${area} 房源`, url: `https://${host}.lianjia.com/zufang/rs${q(area)}/` },
        { label: `${area} 通勤`, url: `https://www.amap.com/search?query=${q(`${area} 到 ${/国贸/.test(t) ? "国贸" : "市中心"}`)}` },
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

  if (/选课|考证|课程.{0,8}对比|对比.{0,12}课/.test(t)) {
    const course = (t.match(/([\u4e00-\u9fffA-Za-z]{2,16}(?:课|证|分析))/) || [])[1] || "课程";
    return {
      kind: "course",
      title: `${course} 对比`,
      brief: "打开课程检索，对比要点，报名表不代提交。",
      slots: { course },
      steps: [{ label: `搜 ${course}`, url: `https://www.baidu.com/s?wd=${q(`${course} 课程 对比`)}` }],
    };
  }

  if (/文献|综述|论文/.test(t)) {
    const topic = topicOf(t) || "研究";
    return {
      kind: "papers",
      title: `${topic} 文献卡片`,
      brief: "打开学术检索，列出处链接，不编页码。",
      slots: { topic },
      steps: [{ label: `学术检索 ${topic}`, url: `https://xueshu.baidu.com/s?wd=${q(topic)}` }],
    };
  }

  if (/快递|物流|单号|申通|圆通|顺丰|中通/.test(t) && !/机票/.test(t)) {
    const no = (t.match(/\b([A-Za-z0-9]{10,18})\b/) || [])[1];
    return {
      kind: "logistics",
      title: no ? `运单 ${no}` : "查快递路径",
      brief: "打开快递100；有单号查轨迹，没有就说明怎么查。",
      slots: { no: no || "" },
      steps: [
        {
          label: no ? `查 ${no}` : "快递100",
          url: no
            ? `https://www.kuaidi100.com/chaxun?nu=${q(no)}`
            : "https://www.kuaidi100.com/",
        },
      ],
    };
  }

  return null;
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
    .map((f, i) => `### ${i + 1}. ${f.label}\n网址：${f.url}\n${f.text.slice(0, 1600)}`)
    .join("\n\n");
  return [
    "用户要一份能执行的结果，不是读当前随便一页。",
    `任务：${mission.title}。${mission.brief}`,
    "只根据下面各步正文。没有的店名、价格、岗位写成未知，不要编。",
    "店、商品、岗位、文章必须写成 [名称](链接)。没有链接就不要假造名称。",
    "登录墙或验证码如实说，仍给出已打开的结果页链接。",
    "付钱、投递、挂号提交、退款必须写「请你在窗口里点」。",
    `用户原话：${userAsk}`,
    blocks,
  ].join("\n");
}
