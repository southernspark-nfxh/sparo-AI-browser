/**
 * 地点尺子：城 / 省 / 不是地点。脑和手共用，避免各写一套。
 */

const CITY_ALIASES: Record<string, string> = {
  北京: "北京",
  beijing: "北京",
  上海: "上海",
  shanghai: "上海",
  广州: "广州",
  深圳: "深圳",
  成都: "成都",
  杭州: "杭州",
  南京: "南京",
  武汉: "武汉",
  西安: "西安",
  重庆: "重庆",
  天津: "天津",
  青岛: "青岛",
  厦门: "厦门",
  昆明: "昆明",
  大理: "大理",
  丽江: "丽江",
  香格里拉: "香格里拉",
  西双版纳: "西双版纳",
  景洪: "西双版纳",
  三亚: "三亚",
  海口: "海口",
  苏州: "苏州",
  长沙: "长沙",
  香港: "香港",
  台北: "台北",
  东京: "东京",
  tokyo: "东京",
  京都: "京都",
  kyoto: "京都",
  大阪: "大阪",
  osaka: "大阪",
  名古屋: "名古屋",
  札幌: "札幌",
  福冈: "福冈",
  首尔: "首尔",
  曼谷: "曼谷",
  bangkok: "曼谷",
  清迈: "清迈",
  "chiang mai": "清迈",
  chiangmai: "清迈",
  新加坡: "新加坡",
  伦敦: "伦敦",
  london: "伦敦",
  巴黎: "巴黎",
  paris: "巴黎",
  纽约: "纽约",
  nyc: "纽约",
  "new york": "纽约",
  newyork: "纽约",
  洛杉矶: "洛杉矶",
  "los angeles": "洛杉矶",
  losangeles: "洛杉矶",
  波士顿: "波士顿",
  boston: "波士顿",
  芝加哥: "芝加哥",
  chicago: "芝加哥",
  旧金山: "旧金山",
  "san francisco": "旧金山",
  sanfrancisco: "旧金山",
  西雅图: "西雅图",
  seattle: "西雅图",
  华盛顿: "华盛顿",
  迈阿密: "迈阿密",
  miami: "迈阿密",
  拉斯维加斯: "拉斯维加斯",
  "las vegas": "拉斯维加斯",
  lasvegas: "拉斯维加斯",
  阿姆斯特丹: "阿姆斯特丹",
  伊斯坦布尔: "伊斯坦布尔",
  istanbul: "伊斯坦布尔",
  第比利斯: "第比利斯",
  tbilisi: "第比利斯",
  巴统: "巴统",
  batumi: "巴统",
  安卡拉: "安卡拉",
  ankara: "安卡拉",
  乐山: "乐山",
  峨眉山: "峨眉山",
  九寨沟: "九寨沟",
  都江堰: "都江堰",
  青城山: "青城山",
  万宁: "万宁",
  乌鲁木齐: "乌鲁木齐",
  喀纳斯: "喀纳斯",
  伊犁: "伊宁",
  伊宁: "伊宁",
  拉萨: "拉萨",
  桂林: "桂林",
  南宁: "南宁",
  北海: "北海",
  阳朔: "阳朔",
  贵阳: "贵阳",
  安顺: "安顺",
  凯里: "凯里",
  荔波: "荔波",
  张家界: "张家界",
  凤凰: "凤凰",
  凤凰古城: "凤凰",
  鼓浪屿: "鼓浪屿",
  南靖: "南靖",
  泉州: "泉州",
  漳州: "漳州",
  乌镇: "乌镇",
  西塘: "西塘",
  周庄: "周庄",
  同里: "同里",
  南浔: "南浔",
  温州: "温州",
  绍兴: "绍兴",
  嘉兴: "嘉兴",
  金华: "金华",
  珠海: "珠海",
  佛山: "佛山",
  东莞: "东莞",
  惠州: "惠州",
  汕头: "汕头",
  湛江: "湛江",
  常州: "常州",
  扬州: "扬州",
  南通: "南通",
  徐州: "徐州",
  烟台: "烟台",
  威海: "威海",
  泰安: "泰安",
  曲阜: "曲阜",
  开封: "开封",
  宜昌: "宜昌",
  岳阳: "岳阳",
  衡阳: "衡阳",
  延吉: "延吉",
  长白山: "长白山",
  嘉峪关: "嘉峪关",
  青海湖: "青海湖",
  茶卡盐湖: "茶卡盐湖",
  太原: "太原",
  大同: "大同",
  平遥: "平遥",
  石家庄: "石家庄",
  承德: "承德",
  秦皇岛: "秦皇岛",
  沈阳: "沈阳",
  大连: "大连",
  长春: "长春",
  哈尔滨: "哈尔滨",
  合肥: "合肥",
  黄山: "黄山",
  福州: "福州",
  南昌: "南昌",
  景德镇: "景德镇",
  济南: "济南",
  郑州: "郑州",
  洛阳: "洛阳",
  兰州: "兰州",
  敦煌: "敦煌",
  西宁: "西宁",
  银川: "银川",
  呼和浩特: "呼和浩特",
  无锡: "无锡",
  宁波: "宁波",
};

/** 国家/地区口头说法 → 代表城（仅作别名，不是省）。 */
const COUNTRY_CITY: Record<string, string> = {
  土耳其: "伊斯坦布尔",
  turkey: "伊斯坦布尔",
  格鲁吉亚: "第比利斯",
  georgia: "第比利斯",
  日本: "东京",
  韩国: "首尔",
  泰国: "曼谷",
  英国: "伦敦",
  法国: "巴黎",
};

const REGIONS: Record<string, string[]> = {
  云南: ["昆明", "大理", "丽江", "香格里拉", "西双版纳"],
  四川: ["成都", "乐山", "峨眉山", "九寨沟", "都江堰", "青城山"],
  海南: ["海口", "三亚", "万宁"],
  新疆: ["乌鲁木齐", "喀纳斯", "伊宁"],
  西藏: ["拉萨"],
  贵州: ["贵阳", "安顺", "凯里", "荔波"],
  广西: ["桂林", "南宁", "北海", "阳朔"],
  山西: ["太原", "大同", "平遥"],
  陕西: ["西安"],
  河北: ["石家庄", "承德"],
  河南: ["郑州", "洛阳", "开封"],
  山东: ["济南", "青岛", "烟台", "威海", "泰安", "曲阜"],
  江苏: ["南京", "苏州", "无锡", "常州", "扬州", "南通"],
  浙江: ["杭州", "宁波", "温州", "绍兴", "嘉兴", "乌镇"],
  安徽: ["合肥", "黄山"],
  福建: ["福州", "厦门", "泉州", "漳州", "南靖", "鼓浪屿"],
  江西: ["南昌", "景德镇"],
  湖北: ["武汉", "宜昌"],
  湖南: ["长沙", "张家界", "凤凰"],
  广东: ["广州", "深圳", "珠海", "佛山", "东莞", "惠州", "汕头", "湛江"],
  辽宁: ["沈阳", "大连"],
  吉林: ["长春", "延吉", "长白山"],
  黑龙江: ["哈尔滨"],
  甘肃: ["兰州", "敦煌", "嘉峪关"],
  青海: ["西宁", "青海湖", "茶卡盐湖"],
  宁夏: ["银川"],
  内蒙古: ["呼和浩特"],
  台湾: ["台北"],
};

const NOT_PLACE =
  /^(打算|准备|想要|想去|帮我|请|你好|您好|规划|旅游|旅行|行程|酒店|机票|航班|时间|几天|七日|自由行|路线|包含|回到|出发|回来)$/;

const VERB_PHRASE = /打算|准备|想要|帮我规划|请帮我/;

const CITIES = new Set(Object.values(CITY_ALIASES));
const CHINA_MAINLAND = new Set([
  "北京",
  "上海",
  "广州",
  "深圳",
  "成都",
  "杭州",
  "南京",
  "武汉",
  "西安",
  "重庆",
  "天津",
  "青岛",
  "厦门",
  "昆明",
  "大理",
  "丽江",
  "西双版纳",
  "三亚",
  "海口",
  "苏州",
  "长沙",
  "乐山",
  "峨眉山",
  "九寨沟",
  "万宁",
  "太原",
  "大同",
  "平遥",
  "石家庄",
  "承德",
  "沈阳",
  "大连",
  "长春",
  "哈尔滨",
  "合肥",
  "黄山",
  "福州",
  "南昌",
  "济南",
  "郑州",
  "洛阳",
  "兰州",
  "敦煌",
  "西宁",
  "银川",
  "呼和浩特",
  "无锡",
  "宁波",
  "乌鲁木齐",
  "喀纳斯",
  "伊宁",
  "安顺",
  "凯里",
  "荔波",
  "张家界",
  "凤凰",
  "鼓浪屿",
  "南靖",
  "泉州",
  "漳州",
  "乌镇",
  "西塘",
  "周庄",
  "同里",
  "南浔",
  "温州",
  "绍兴",
  "嘉兴",
  "金华",
  "珠海",
  "佛山",
  "东莞",
  "惠州",
  "汕头",
  "湛江",
  "北海",
  "阳朔",
  "常州",
  "扬州",
  "南通",
  "徐州",
  "烟台",
  "威海",
  "泰安",
  "曲阜",
  "开封",
  "宜昌",
  "岳阳",
  "衡阳",
  "延吉",
  "长白山",
  "嘉峪关",
  "青海湖",
  "茶卡盐湖",
  "都江堰",
  "青城山",
]);

export function isNotPlace(raw: string): boolean {
  const t = String(raw || "").trim();
  if (!t) return true;
  if (NOT_PLACE.test(t)) return true;
  if (VERB_PHRASE.test(t) && t.length <= 4) return true;
  return false;
}

export function canonCity(raw: string): string | null {
  const t = String(raw || "").trim();
  if (!t || isNotPlace(t)) return null;
  if (REGIONS[t]) return null;
  const exact =
    CITY_ALIASES[t] || CITY_ALIASES[t.toLowerCase()] || COUNTRY_CITY[t] || COUNTRY_CITY[t.toLowerCase()];
  if (exact) return exact;
  const keys = Object.keys(CITY_ALIASES)
    .concat(Object.keys(COUNTRY_CITY))
    .sort((a, b) => b.length - a.length);
  const hit = keys.find((k) => k.length >= 2 && t.endsWith(k));
  if (!hit || isNotPlace(hit)) return null;
  return CITY_ALIASES[hit] || CITY_ALIASES[hit.toLowerCase()] || COUNTRY_CITY[hit] || null;
}

export function isCity(raw: string): boolean {
  const c = canonCity(raw);
  return Boolean(c && CITIES.has(c));
}

export function isChinaCity(raw: string): boolean {
  const c = canonCity(raw);
  return Boolean(c && CHINA_MAINLAND.has(c));
}

export function isRegion(raw: string): boolean {
  return Boolean(REGIONS[String(raw || "").trim()]);
}

/**
 * 模型说的地名，本地词库没收录时的兜底校验：
 * 2-10 字中英/间隔号，不含动作和需求词，就当它是个地方——大脑选的目的地不该被本地词表否掉。
 * 真正落不了机场/酒店时，手层还有门户映射和关键词搜索兜底。
 */
export function plausiblePlace(raw: string): string | null {
  const t = String(raw || "").trim();
  if (!t || t.length > 10 || isNotPlace(t)) return null;
  if (!/^[一-龥A-Za-z][一-龥A-Za-z·. ]{1,9}$/.test(t)) return null;
  if (/旅游|旅行|行程|酒店|机票|航班|高铁|火车|车票|住宿|餐厅|美食|景点|出发|返回|回到|回来|打算|准备|想要|帮我|自由行|路线|预算|签证|攻略|天气|门票/.test(t)) {
    return null;
  }
  if (isRegion(t)) return null;
  return t;
}

export function findRegion(text: string): string | null {
  const keys = Object.keys(REGIONS).sort((a, b) => b.length - a.length);
  for (const k of keys) {
    if (text.includes(k)) return k;
  }
  return null;
}

export function regionCities(region: string): string[] {
  return REGIONS[region] ? [...REGIONS[region]] : [];
}

export function findCities(text: string): string[] {
  const keys = Object.keys(CITY_ALIASES)
    .concat(Object.keys(COUNTRY_CITY))
    .sort((a, b) => b.length - a.length);
  const hits: { at: number; name: string }[] = [];
  const used: [number, number][] = [];
  const overlap = (a: number, b: number) => used.some(([s, e]) => a < e && b > s);
  for (const key of keys) {
    const re = new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const at = m.index;
      const end = at + m[0].length;
      if (overlap(at, end)) continue;
      const name = canonCity(m[0]);
      if (!name) continue;
      used.push([at, end]);
      hits.push({ at, name });
    }
  }
  hits.sort((a, b) => a.at - b.at);
  const uniq: string[] = [];
  for (const h of hits) {
    if (!uniq.includes(h.name)) uniq.push(h.name);
  }
  return uniq;
}

export function placeAliases(): Record<string, string> {
  return { ...CITY_ALIASES, ...COUNTRY_CITY };
}
