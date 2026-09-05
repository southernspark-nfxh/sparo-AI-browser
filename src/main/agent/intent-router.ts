/**
 * Sparo browser agent: understand the user's goal, then pick a capability.
 * User chat is not a raw dump into the model — local routing decides site/tool first.
 */
import { parseTravelQuery, type TravelQuery } from "./travel.js";
import { parseTripPlan, type TripPlan } from "./trip-plan.js";
import { parseMission, type Mission } from "./mission.js";
import { parseFeishuTask, type FeishuTask } from "./feishu.js";

export type RoutedAction =
  | { type: "one_click_reply" }
  | { type: "summarize" }
  | { type: "fill_form" }
  | { type: "run_skill"; id?: string; query: string }
  | { type: "navigate"; url: string; note: string }
  | { type: "act"; url?: string; text: string }
  | ({ type: "travel_search" } & TravelQuery)
  | { type: "trip_plan"; plan: TripPlan }
  | { type: "mission"; mission: Mission }
  | { type: "feishu"; task: FeishuTask };

export type SiteCap = {
  id: string;
  label: string;
  re: RegExp;
  homeUrl: string;
  writeUrl?: string;
  skillId?: string;
  skillQuery?: string;
};

export const SITE_CAPS: SiteCap[] = [
  {
    id: "xhs",
    label: "小红书",
    re: /小红书|xiaohongshu|rednote|(?<![a-z])xhs(?![a-z])/i,
    homeUrl: "https://www.xiaohongshu.com",
    writeUrl: "https://creator.xiaohongshu.com/publish/publish?target=article",
    skillId: "xhs-longform-publish",
    skillQuery: "小红书发布",
  },
  {
    id: "zhihu",
    label: "知乎",
    re: /知乎|zhihu/i,
    homeUrl: "https://www.zhihu.com",
    writeUrl: "https://www.zhihu.com/creator",
  },
  {
    id: "weibo",
    label: "微博",
    re: /微博|weibo/i,
    homeUrl: "https://weibo.com",
    writeUrl: "https://weibo.com",
  },
  {
    id: "feishu",
    label: "飞书",
    re: /飞书|feishu|\blark\b/i,
    homeUrl: "https://www.feishu.cn/next/messenger",
    skillId: "feishu-web-work",
    skillQuery: "飞书",
  },
  {
    id: "taobao",
    label: "淘宝",
    re: /淘宝|taobao/i,
    homeUrl: "https://www.taobao.com",
  },
  {
    id: "baidumap",
    label: "百度地图",
    re: /百度地图|map\.baidu/i,
    homeUrl: "https://map.baidu.com",
  },
  {
    id: "baidu",
    label: "百度",
    re: /百度|baidu/i,
    homeUrl: "https://www.baidu.com",
  },
  {
    id: "tuniu",
    label: "途牛",
    re: /途牛|tuniu/i,
    homeUrl: "https://www.tuniu.com",
  },
  {
    id: "qunar",
    label: "去哪儿",
    re: /去哪儿|qunar/i,
    homeUrl: "https://www.qunar.com",
  },
  {
    id: "booking",
    label: "Booking",
    re: /booking\.com|(?<![a-z])booking(?![a-z])/i,
    homeUrl: "https://www.booking.com",
  },
  {
    id: "airbnb",
    label: "Airbnb",
    re: /airbnb|爱彼迎/i,
    homeUrl: "https://www.airbnb.com",
  },
  {
    id: "jd",
    label: "京东",
    re: /京东|(?<![a-z])jd\.com/i,
    homeUrl: "https://www.jd.com",
  },
  {
    id: "rail12306",
    label: "12306",
    re: /12306/i,
    homeUrl: "https://www.12306.cn",
  },
  {
    id: "dianping",
    label: "大众点评",
    re: /大众点评|dianping/i,
    homeUrl: "https://www.dianping.com",
  },
  {
    id: "bilibili",
    label: "哔哩哔哩",
    re: /哔哩哔哩|bilibili|(?<![a-z])b站(?![a-z])/i,
    homeUrl: "https://www.bilibili.com",
  },
  {
    id: "ctrip",
    label: "携程",
    re: /携程|ctrip/i,
    homeUrl: "https://www.ctrip.com",
  },
  {
    id: "amap",
    label: "高德地图",
    re: /高德|amap\.com|autonavi/i,
    homeUrl: "https://www.amap.com",
  },
];

export function detectSites(text: string): SiteCap[] {
  return SITE_CAPS.filter((s) => s.re.test(text));
}

export function detectSite(text: string): SiteCap | null {
  return detectSites(text)[0] || null;
}

export function wantsPublish(text: string): boolean {
  return (
    /发帖|发布|发文|发一篇|去发|帮我发(?!现)|post\s*(to|on)?|publish/i.test(text) ||
    /发\s*\d+\s*条/.test(text) ||
    /发(小红书|知乎|微博|朋友圈)/.test(text) ||
    /(发|写).{0,20}(微博|知乎|小红书|zhihu|weibo)/i.test(text) ||
    /(微博|知乎).{0,12}(博主|发帖|发文|写文章)/.test(text) ||
    /写(一篇|个)?(文章|回答|帖子|长文)/.test(text) ||
    /在.{0,8}(知乎|微博|小红书|zhihu|weibo).{0,8}(发|写|贴)/i.test(text)
  );
}

export function wantsReply(text: string): boolean {
  return /一键回复|帮我回|回复客户|回留言|回评论|客服回复|自动回复/i.test(text);
}

export function wantsSummarize(text: string): boolean {
  return /总结(当前)?页|列\s*\d+\s*件要对齐|这一页(说了啥|讲了什么)|读这页|页面摘要|帮我看这页|summarize|页面显示什么|这页(上|里|面)?(的)?(英文|内容|字)|翻译|英文.{0,16}(意思|含义|啥意思)|左侧.{0,12}(英文|文字|内容|网页)|这段(英文|话)|里面的英文|网页.{0,8}(英文|什么意思|啥意思)|商店状态.{0,12}(英文|意思)|这是(个|什么)?网站/i.test(
    text,
  );
}

/** First real http(s) URL; trailing Chinese / spaces are not part of the URL. */
export function extractFirstHttpUrl(text: string): string | null {
  const m = text.match(/https?:\/\/[^\s\u4e00-\u9fff<>"'）)】\]]+/i);
  if (!m) return null;
  return m[0].replace(/[.,，。、；;!?？]+$/g, "");
}

/** Extra work after “打开某站”, e.g. 搜天气. Null = just open. */
export function leftoverAfterOpen(text: string): string | null {
  const t = text.trim();
  const url = extractFirstHttpUrl(t);
  if (url) {
    const rest = t
      .replace(url, " ")
      .replace(/(?:请)?(?:帮我)?(?:打开|前往|进入)/gi, " ")
      .replace(/^[\s,，。、]+/, "")
      .trim();
    return rest.length >= 2 ? rest : null;
  }
  if (!/打开|前往|进入/.test(t)) return null;
  const chopped = t
    .replace(/^(?:请)?(?:帮我)?(?:打开|前往|进入)\s*/i, "")
    .replace(/^(首页|网页版)\s*/i, "");
  const byComma = chopped.split(/[,，;；]|然后|并且|并(?!购)|再(?!见)/);
  if (byComma.length >= 2) {
    const rest = byComma.slice(1).join("").trim();
    if (rest.length >= 2) return rest;
  }
  const afterSite = chopped
    .replace(
      /^(百度地图|百度|淘宝|天猫|京东|微博|知乎|哔哩哔哩|b站|携程|途牛|去哪儿|高德(?:地图)?|飞书|小红书|大众点评|爱彼迎|Airbnb|Booking)(?:首页|网页版)?/i,
      "",
    )
    .trim();
  if (/^(搜|搜索|查|查找|看看|告诉我|总结|填)/i.test(afterSite) || afterSite.length >= 4) {
    return afterSite.length >= 2 ? afterSite : null;
  }
  return null;
}

/** Reply language follows the user's words, not the UI locale. */
export function userReplyLang(text: string): "zh" | "en" {
  const zh = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const latin = (text.match(/[A-Za-z]/g) || []).length;
  if (zh >= 2 && zh * 2 >= latin) return "zh";
  return "en";
}

export function readPageInstruction(userAsk: string): string {
  const ask = userAsk.trim();
  const zh = userReplyLang(ask) === "zh";
  if (zh) {
    return [
      "用户在用中文问当前网页。必须用中文回答，即使界面或网页是英文。",
      "先判断用户要什么：翻译某段英文、解释某个状态，还是整页摘要。",
      "问「英文啥意思 / 商店状态」时：只解释那一段英文，用白话说结论和该改什么；不要用英文写整页摘要，不要只报导航菜单。",
      "只根据下面正文，不要编造。",
      ask ? `用户的问题：${ask}` : "用中文概括这一页要点。",
    ].join("\n");
  }
  return [
    "The user asked in English. Answer in English.",
    "If they asked what a phrase means, explain that part only. Do not dump the whole page.",
    "Use only the page text below. Do not invent.",
    ask ? `User question: ${ask}` : "Summarize this page.",
  ].join("\n");
}

export function wantsFillForm(text: string): boolean {
  return /填这(张|个)?表|帮我填|通用填表|自动填表|按资料填/i.test(text);
}

export function isContinueHint(text: string): boolean {
  const t = text.trim();
  if (!t || t.length > 48) return false;
  return /你自己(研究|想|看|学|搞|动手|试)|自己研究|继续|动手啊|那就自己|你不会|再试试|自己搞定|你来啊|你发啊/.test(
    t,
  );
}

export function sameSite(currentUrl: string, targetUrl: string): boolean {
  try {
    const host = (u: string) =>
      new URL(u).hostname.replace(/^www\./, "").toLowerCase();
    const a = host(currentUrl);
    const b = host(targetUrl);
    return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
  } catch {
    return false;
  }
}

/** True if this skill belongs to a different site than the one the user named. */
export function skillConflictsWithQuery(
  query: string,
  skillId: string,
  platform?: string,
): boolean {
  const mentioned = detectSites(query);
  if (!mentioned.length) return false;
  const blob = `${skillId} ${platform || ""}`.toLowerCase();
  const skillSites = SITE_CAPS.filter((s) => {
    if (s.skillId && skillId === s.skillId) return true;
    if (skillId.startsWith(`${s.id}-`)) return true;
    if (s.id === "xhs" && skillId.startsWith("xhs-")) return true;
    if (blob.includes(s.id) || blob.includes(s.label)) return true;
    return false;
  });
  if (!skillSites.length) return false;
  return !skillSites.some((s) => mentioned.some((m) => m.id === s.id));
}

/**
 * Route a chat line to a browser action before the LLM sees it.
 * Returns null when the line should go to the model with a strict agent prompt.
 */
export function routeUserGoal(input: string): RoutedAction | null {
  const t = input.trim();
  if (!t) return null;

  if (wantsReply(t)) return { type: "one_click_reply" };
  if (wantsFillForm(t)) return { type: "fill_form" };
  if (isContinueHint(t)) return null;

  const trip = parseTripPlan(t);
  if (trip) return { type: "trip_plan", plan: trip };

  const travel = parseTravelQuery(t);
  if (travel) return { type: "travel_search", ...travel };

  const mission = parseMission(t);
  if (mission) return { type: "mission", mission };

  const feishu = parseFeishuTask(t);
  if (feishu) return { type: "feishu", task: feishu };

  const leftover = leftoverAfterOpen(t);
  const extracted = extractFirstHttpUrl(t);
  const site = detectSite(t);

  if (extracted && leftover) {
    return { type: "act", url: extracted, text: t };
  }
  if (site && leftover && /打开|前往|进入/.test(t)) {
    return { type: "act", url: site.homeUrl, text: t };
  }

  if (wantsSummarize(t)) return { type: "summarize" };

  if (site && wantsPublish(t)) {
    if (site.skillId) {
      return { type: "run_skill", id: site.skillId, query: site.skillQuery || site.label };
    }
    return {
      type: "act",
      url: site.writeUrl || site.homeUrl,
      text: t,
    };
  }
  if (wantsPublish(t) && !site) {
    return { type: "act", text: t };
  }
  if (site && /打开|前往|去|进入/.test(t)) {
    return {
      type: "navigate",
      url: site.homeUrl,
      note: `已打开${site.label}。`,
    };
  }
  if (extracted) {
    return { type: "navigate", url: extracted, note: `已打开 ${extracted}` };
  }

  return null;
}

export function agentCapabilityBrief(locale?: string): string {
  const zh = Boolean(locale) && (locale === "zh" || String(locale).toLowerCase().startsWith("zh"));
  if (zh) {
    return [
      "你是 Sparo，会动手的 AI 浏览器。用户跟你说话，你在共享窗口里操作网页。",
      "先理解用户目标，再挑已有能力：行程规划、查机票/酒店、买前比价、调研笔记、读这一页、填表、起草回复、匹配妙招。不要拿当前页硬套用户没问的事。不要直开京东/淘宝/点评首页。",
      "做事：读这一页、填表、起草回复、飞书网页写聊天/日志草稿。发送和提交默认等人确认。",
      "能力：page_text 读当前页可见文字（翻译、解释、问这页写了什么必须先用它）；snapshot 只给点击/填写用，不是读内容；navigate；click / click_text / fill；cs_one_click_reply 起草回复（不发送）；飞书网页用 feishu_work / run_skill「飞书」（一次注入草稿，禁止循环 fill，禁止代点发送）；run_skill 仅当妙招站点与用户说的站点一致。",
      "没有对应妙招时，自己 snapshot → 点输入框 → fill。禁止说「请先录妙招」。禁止把任务推回给用户。没读到 page_text 就不要编页面内容。",
      "多段行程（出发+回国、多城、机票+酒店一起问）：先拆成去程/城际/回程机票和各城酒店，逐步打开结果页再汇总。禁止把跨国行程当成高德驾车。禁止编造航班号和价格。",
      "城市/日期弹层（携程、高德）：用 fill_suggest 输入目的地并点联想，用 pick_calendar 选日期。禁止在热门城市格子或日期数字上循环空点。同一弹层试两次仍不对就停下来说明。",
      "寒暄时只作简短自我介绍：打开网页、读页面、填表、起草回复。不要点名任何网站或社交平台，不要主动提发布、发帖、发社媒。",
      "站点纪律：用户说去哪个站就去哪个站。未点名的站点不要主动推荐。",
      "用户用哪种语言问，就用哪种语言答。界面是英文、网页是英文，只要用户在说中文，就回中文。",
      "用户明确说「发 / 发布 / 发三条」= 已授权发帖，应当填写并点击发送。付款、删号、客服点发送仍必须等人。",
      "你越用越懂这个用户：参考「你对用户的了解」个性化回复，但别生硬复述、别泄露原始字段。",
      "付款、删号、客服点发送必须等人。做完用短句报进度，不要编造已发送。",
      "用户明确说「发 / 发布 / 发三条」= 已授权发帖，应当填写并点击发送。",
      "你越用越懂这个用户：参考「你对用户的了解」个性化回复，但别生硬复述。",
    ].join("\n");
  }
  return [
    "You are Sparo, the AI browser that acts. The user talks to you; you operate the shared window.",
    "Do the work: read this page, fill forms, draft replies. Send and submit wait for the user by default.",
    "Tools: page_text reads visible page text (required before translating or explaining this page); snapshot is for click/fill refs only, not reading; navigate; click / click_text / fill; cs_one_click_reply drafts a reply (does not send); run_skill only when the saved skill’s site matches what the user asked.",
    "If there is no matching skill, snapshot → click the field → fill. Never say “please record a skill first”. Never push the task back to the user. Do not invent page content without page_text.",
    "Multi-city trips (outbound + return, flights + hotels): decompose into flight and hotel result pages, then summarize. Do not treat intercontinental legs as driving directions. Do not invent flight numbers or prices.",
    "City/date widgets (Ctrip, maps): fill_suggest for destination, pick_calendar for dates. Do not loop-click popular-city grids or bare day numbers. After two failed overlay tries, stop and say so.",
    "On greetings, give a short intro only: open pages, read this page, fill forms, draft replies. Do not name any website or social network. Do not offer to publish or post.",
    "Site discipline: go where the user named. Do not recommend a site they did not mention.",
    "Payment, account deletion, and customer-service Send must wait for the user. Reply in the same language the user is using. Do not claim you already sent.",
  ].join("\n");
}
