import { describe, expect, it } from "vitest";
import { parseLocalIntent } from "../src/main/agent/stub.js";
import { expressTrackUrl, parseMission } from "../src/main/agent/mission.js";
import { parseTripPlan } from "../src/main/agent/trip-plan.js";

const NOW = new Date(2026, 8, 9);

const QA20: Array<{
  id: number;
  kind: string;
  q: string;
  type: "mission" | "trip_plan";
  must: RegExp[];
  mustNot?: RegExp[];
}> = [
  {
    id: 1,
    kind: "logistics",
    type: "mission",
    q: "帮我查询快递单号 SF1234567890 的物流信息，告诉我现在到哪了，预计什么时候到",
    must: [/kuaidi100\.com/, /SF1234567890/, /com=shunfeng/],
    mustNot: [/ems\.shtml|com=ems/],
  },
  {
    id: 2,
    kind: "translate",
    type: "mission",
    q: "帮我打开这个英文网页 https://example.com/article，翻译成中文，并总结核心要点（不超过5条）",
    must: [/example\.com\/article/],
  },
  {
    id: 3,
    kind: "movies",
    type: "mission",
    q: "帮我查一下本周六北京朝阳区上映的电影，找出评分最高的3部，告诉我场次时间和票价",
    must: [/taopiaopiao/i, /2026-09-12|朝阳/],
    mustNot: [/baidu\.com\/s\?wd=.*川菜/, /maoyan\.com\/films/],
  },
  {
    id: 4,
    kind: "weather",
    type: "mission",
    q: "查一下明天北京的天气，告诉我温度、是否需要带伞，并给出穿衣建议",
    must: [/weather\.com\.cn|北京.*天气/],
  },
  {
    id: 5,
    kind: "download",
    type: "mission",
    q: "帮我找到 OBS Studio 的官方下载链接，告诉我最新版本号，并给出 Windows 系统的安装步骤",
    must: [/obsproject\.com/],
  },
  {
    id: 6,
    kind: "attractions",
    type: "mission",
    q: "帮我搜索成都最值得去的5个网红打卡地，告诉我每个地方的特色、地址、门票价格和开放时间",
    must: [/chengdu104|you\.ctrip/, /dianping/],
  },
  {
    id: 7,
    kind: "sourcing",
    type: "mission",
    q: '我想在拼多多卖"便携式榨汁杯"，帮我调研：1）1688上前10名供应商的价格和起订量 2）拼多多上同类产品的售价区间 3）利润率分析 4）给出选品建议',
    must: [/1688\.com/, /yangkeduo\.com|pinduoduo/],
    mustNot: [/search\.jd\.com/],
  },
  {
    id: 8,
    kind: "papers",
    type: "mission",
    q: '帮我搜索最近3年关于"大语言模型在教育领域应用"的学术论文，找出引用量最高的5篇，告诉我标题、作者、发表年份、摘要和引用量',
    must: [/xueshu\.baidu|semanticscholar|scholar\.google/],
  },
  {
    id: 9,
    kind: "rent",
    type: "mission",
    q: "帮我搜索北京海淀区西二旗附近的一居室租房信息，对比链家、自如、贝壳三个平台的价格，找出性价比最高的3个房源",
    must: [/lianjia\.com/, /西二旗|%E8%A5%BF%E4%BA%8C%E6%97%97/, /ke\.com/, /自如/],
    mustNot: [/ziroom\.com\/z\/z1-q/],
  },
  {
    id: 10,
    kind: "insurance",
    type: "mission",
    q: "帮我对比3款重疾险产品（平安福、国寿福、太平洋金佑人生），告诉我保障范围、保费、优缺点，给出购买建议",
    must: [/平安福|%E5%B9%B3%E5%AE%89%E7%A6%8F/, /国寿福|金佑/],
  },
  {
    id: 11,
    kind: "events",
    type: "mission",
    q: "帮我搜索本周北京值得去的展览和活动（至少5个），告诉我名称、地点、时间、门票价格和亮点",
    must: [/douban|huodongxing|展览/],
  },
  {
    id: 12,
    kind: "course",
    type: "mission",
    q: '帮我搜索"Python数据分析"的在线课程，对比Coursera、Udemy、网易云课堂三个平台，找出评分最高的3门课程，告诉我课程名、讲师、价格、课时和评分',
    must: [/coursera\.org/, /udemy\.com/, /163\.com/],
  },
  {
    id: 13,
    kind: "social_hot",
    type: "mission",
    q: "帮我分析今天微博热搜前10的话题，告诉我每个话题的热度、主要内容、网友观点倾向（正面/负面/中立）",
    must: [/weibo\.com/],
  },
  {
    id: 14,
    kind: "cross_border",
    type: "mission",
    q: '我想在亚马逊美国站卖"瑜伽垫"，帮我做完整调研：1）亚马逊上前10名竞品的价格、评分、月销量 2）1688上前10名供应商的价格、起订量、发货时间 3）利润空间分析（含运费、平台佣金） 4）市场进入建议',
    must: [/amazon\.com/, /1688\.com/],
  },
  {
    id: 15,
    kind: "trip",
    type: "trip_plan",
    q: "我要计划一次泰国5天自由行（曼谷+清迈），帮我：1）签证办理流程和费用 2）机票对比（至少3家航空公司）3）酒店推荐（每个城市2-3个）4）5天行程规划 5）预算计算 6）注意事项和必备物品清单",
    must: [],
  },
  {
    id: 16,
    kind: "saas",
    type: "mission",
    q: '我在做一款"项目管理工具"SaaS产品，帮我：1）找出前8名竞品（国内外）2）功能对比矩阵 3）定价策略分析 4）用户评价分析（正面/负面）5）营销渠道分析 6）市场空白点 7）我的产品定位和GTM策略建议',
    must: [/项目管理|Jira|Asana|Monday/],
  },
  {
    id: 17,
    kind: "supply",
    type: "mission",
    q: '我想做一款"智能台灯"产品，帮我做供应链调研：1）核心零部件供应商（LED灯珠、传感器、外壳）2）各零部件价格区间 3）组装厂推荐 4）BOM成本估算 5）建议零售价',
    must: [/1688\.com/, /台灯|LED/],
  },
  {
    id: 18,
    kind: "tech_pick",
    type: "mission",
    q: '我要开发一个"实时聊天应用"，帮我做技术选型调研：1）对比3种前端框架（React/Vue/Angular）2）对比3种后端框架（Node.js/Go/Python）3）对比3种数据库（MongoDB/PostgreSQL/Redis）4）给出推荐技术栈和理由',
    must: [/React|Vue/, /MongoDB|PostgreSQL/],
  },
  {
    id: 19,
    kind: "media_ops",
    type: "mission",
    q: "我要从0开始做一个\"AI工具评测\"的自媒体账号，帮我制定完整的运营方案：1）平台选择（B站/抖音/小红书/公众号）2）内容定位和差异化 3）内容选题规划（第1个月的10个选题）4）变现路径 5）增长策略",
    must: [/bilibili|抖音|小红书|公众号/],
  },
  {
    id: 20,
    kind: "industry",
    type: "mission",
    q: '帮我做一份"中国宠物经济"的行业研究报告，包括：1）市场规模和增长趋势 2）产业链分析（上游/中游/下游）3）主要玩家和市场份额 4）用户画像和消费习惯 5）行业驱动因素 6）未来发展趋势 7）投资机会和风险',
    must: [/宠物经济/],
    mustNot: [/智能喂食器/],
  },
];

describe("第二轮 20 场景原话", () => {
  it("每句都走进结果页任务，不掉进闲聊", () => {
    const gaps: string[] = [];
    for (const row of QA20) {
      const a = parseLocalIntent(row.q);
      if (a.type !== row.type) {
        gaps.push(`#${row.id} 实际=${a.type} 期望=${row.type}`);
        continue;
      }
      if (row.type === "trip_plan") {
        const plan = parseTripPlan(row.q, NOW);
        if (!plan) gaps.push(`#${row.id} trip_plan 解析失败`);
        else {
          if (!plan.cities.includes("曼谷")) gaps.push(`#${row.id} 缺曼谷`);
          if (!plan.cities.includes("清迈")) gaps.push(`#${row.id} 缺清迈`);
          if (!plan.extras?.some((e) => /签证/.test(e.label))) gaps.push(`#${row.id} 缺签证步`);
        }
        continue;
      }
      if (a.type !== "mission") continue;
      if (a.mission.kind !== row.kind) {
        gaps.push(`#${row.id} kind=${a.mission.kind} 期望=${row.kind}`);
      }
      const blob = a.mission.steps.map((s) => `${s.label} ${s.url}`).join("\n");
      for (const re of row.must) {
        if (!re.test(blob)) gaps.push(`#${row.id} 缺 ${re}`);
      }
      for (const re of row.mustNot || []) {
        if (re.test(blob)) gaps.push(`#${row.id} 不该有 ${re}`);
      }
    }
    expect(gaps, gaps.join("\n")).toEqual([]);
  });

  it("论文主题不要整句原话", () => {
    const m = parseMission(QA20[7].q, NOW);
    expect(m?.slots.topic).toMatch(/大语言模型/);
    expect(m?.slots.topic).not.toMatch(/告诉我标题/);
  });

  it("租房能认出西二旗一居", () => {
    const m = parseMission(QA20[8].q, NOW);
    expect(m?.slots.area).toMatch(/西二旗/);
    expect(m?.steps.length).toBeGreaterThanOrEqual(3);
  });

  it("SF 单号带上顺丰公司参数", () => {
    expect(expressTrackUrl("SF1234567890")).toContain("com=shunfeng");
    expect(expressTrackUrl("SF1234567890")).not.toContain("com=ems");
  });
});
