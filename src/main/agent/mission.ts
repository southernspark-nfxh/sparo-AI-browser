/**
 * 多步日常任务：规划器填槽 → 打开结果页 → 读页 → 汇成手册。
 * 与行程同一闭环，禁止停在站点首页。
 */
import { parseRelativeDate } from "./travel.js";

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
  | "logistics";

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
  const m =
    text.match(/([A-Za-z0-9\u4e00-\u9fff·\-]{2,24})(?:\s*(?:在|的)?\s*(?:淘宝|京东|官网|比价))/) ||
    text.match(/(?:比价|对比|看看)\s*([A-Za-z0-9\u4e00-\u9fff·\-]{2,24})/);
  const raw = (m?.[1] || text.replace(/帮我|比价|对比|看看|一下|淘宝|京东|官网|和|与|在/g, " "))
    .replace(/\s+/g, " ")
    .trim();
  return raw.slice(0, 24) || "商品";
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

export function looksLikeMissionGoal(text: string): boolean {
  const t = text.trim();
  if (t.length < 6) return false;
  return /比价|周末|周六|周日|看电影|聚餐|调研|做成笔记|是什么|挂号|租房|两居|居住证|选课|考证|文献|综述|快递|物流|投递|岗位|Boss|通勤/.test(
    t,
  );
}

export function parseMission(text: string, now = new Date()): Mission | null {
  const t = text.trim();
  if (t.length < 6) return null;

  if (/比价|淘宝.{0,16}京东|京东.{0,16}淘宝/.test(t) && !/机票|酒店/.test(t)) {
    const product = productName(t);
    return {
      kind: "compare_shop",
      title: `${product} 买前比价`,
      brief: `对比「${product}」在淘宝、京东的结果，只汇总不代买。`,
      slots: { product },
      steps: [
        {
          label: `全网比价 ${product}`,
          url: `https://www.baidu.com/s?wd=${q(`${product} 价格 淘宝 京东`)}`,
        },
      ],
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

  if (/Boss|BOSS直聘|投递|岗位|招聘/.test(t) && /经理|工程师|设计|运营|JD|岗位/.test(t)) {
    const role =
      (t.match(/(产品经理|设计师|运营|工程师)/) ||
        t.match(/([\u4e00-\u9fff]{2,8}(?:经理|工程师|设计师))/))?.[1] || "产品经理";
    return {
      kind: "job_apply",
      title: `${role} 岗位阅读`,
      brief: "打开招聘结果页，读要求，不代投。",
      slots: { role },
      steps: [{ label: `搜 ${role}`, url: `https://www.zhipin.com/web/geek/job?query=${q(role)}` }],
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
