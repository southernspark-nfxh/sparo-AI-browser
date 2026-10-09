import { describe, expect, it } from "vitest";
import { parseLocalIntent } from "../src/main/agent/stub.js";
import { newsTopic, parseMission, shouldSkipHeavyPage } from "../src/main/agent/mission.js";
import { parseTripPlan } from "../src/main/agent/trip-plan.js";

describe("mission pack", () => {
  const now = new Date(2026, 8, 2);

  it("周末本地：餐厅结果页 + 电影 + 地图，不去首页", () => {
    const a = parseLocalIntent("周六在北京吃川菜看场电影 再告诉我地铁怎么走");
    expect(a.type).toBe("mission");
    if (a.type !== "mission") return;
    expect(a.mission.kind).toBe("local_outing");
    expect(a.mission.steps.map((s) => s.url).join("\n")).toMatch(/baidu\.com\/s\?wd=/);
    expect(a.mission.steps.some((s) => /电影/.test(s.url) || /%E7%94%B5%E5%BD%B1/.test(s.url))).toBe(true);
    expect(a.mission.steps.some((s) => /amap\.com\/search/.test(s.url))).toBe(true);
    expect(a.mission.steps.every((s) => !/\/$/.test(s.url.replace(/https?:\/\/[^/]+/, "")))).toBe(
      true,
    );
  });

  it("比价：京东淘宝拼多多结果页", () => {
    const a = parseLocalIntent("戴森吹风机 在淘宝和京东比价");
    expect(a.type).toBe("mission");
    if (a.type !== "mission") return;
    expect(a.mission.kind).toBe("compare_shop");
    expect(a.mission.slots.product).toMatch(/戴森/);
    const urls = a.mission.steps.map((s) => s.url).join("\n");
    expect(urls).toContain("search.jd.com");
    expect(urls).toContain("s.taobao.com");
    expect(urls).toContain("yangkeduo.com");
    expect(urls).not.toContain("baidu.com/s");
  });

  it("比价能认出索尼WH-1000XM5", () => {
    const m = parseMission("帮我对比索尼WH-1000XM5在京东淘宝拼多多的价格和到货");
    expect(m?.kind).toBe("compare_shop");
    expect(m?.slots.product).toMatch(/WH-?1000XM5/i);
    expect(m?.steps).toHaveLength(3);
  });

  it("家电清单一次打开四类京东结果页", () => {
    const m = parseMission("两万元预算买冰箱洗衣机空调电视 列性价比型号");
    expect(m?.kind).toBe("home_appliance");
    expect(m?.steps).toHaveLength(4);
    expect(m?.steps.every((s) => /search\.jd\.com/.test(s.url))).toBe(true);
  });

  it("求职带上城市薪资和规模", () => {
    const job = parseMission("在Boss上看北京AI产品经理 20K 100人以上 近7天 先读JD不要投");
    expect(job?.kind).toBe("job_apply");
    expect(job?.slots.role).toMatch(/产品经理/);
    expect(job?.steps[0].url).toContain("zhipin.com");
    expect(job?.steps[0].url).toContain("salary=406");
    expect(job?.steps[0].url).toContain("scale=303");
    expect(job?.steps[0].url).toContain("sort=2");
  });

  it("出差两天走行程不是频道首页", () => {
    const q = "下周一从北京去上海出差两天 要机票和酒店 大概多少钱";
    const plan = parseTripPlan(q, now);
    expect(plan).toMatchObject({
      origin: "北京",
      cities: ["上海"],
      nights: [2],
    });
    expect(plan?.startDate).toBe("2026-09-07");
    expect(plan?.endDate).toBe("2026-09-09");
    const a = parseLocalIntent(q);
    expect(a.type).toBe("trip_plan");
  });

  it("调研打开检索页而不是只聊天", () => {
    const a = parseLocalIntent("RAG是什么 打开百度百科和知乎做成笔记");
    expect(a.type).toBe("mission");
    if (a.type !== "mission") return;
    expect(a.mission.kind).toBe("research");
    expect(a.mission.steps.some((s) => /baidu\.com\/s\?wd=/.test(s.url))).toBe(true);
    expect(a.mission.steps.some((s) => /wikipedia/.test(s.url))).toBe(true);
  });

  it("后面几项也能拆出结果页", () => {
    const job = parseMission("在Boss上看产品经理岗位 先读JD不要投");
    expect(job?.kind).toBe("job_apply");
    expect(job?.slots.role).toBe("产品经理");
    expect(job?.steps[0].url).toContain("query=%E4%BA%A7%E5%93%81%E7%BB%8F%E7%90%86");
    expect(parseMission("最近一周 AI浏览器评测汇总")?.kind).toBe("research");
    expect(parseMission("AI浏览器竞品官网和差评")?.title).toMatch(/浏览器/);
    expect(parseMission("远程办公协作工具调研 Slack Notion")?.title).toMatch(/协作/);
    expect(parseMission("宠物智能硬件市场规模和喂食器品牌")?.title).toMatch(/宠物/);
    expect(parseMission("AI写作助手竞品 豆包和元宝")?.title).toMatch(/写作/);
    expect(parseMission("望京附近5000内两居 通勤国贸")?.kind).toBe("rent");
    expect(parseMission("北京看皮肤科 怎么挂号")?.kind).toBe("hospital");
    expect(parseMission("上海居住证要准备哪些材料")?.kind).toBe("gov_errand");
    expect(parseMission("对比两门数据分析课")?.kind).toBe("course");
    expect(parseMission("检索RAG综述 列3篇出处")?.kind).toBe("papers");
    expect(parseMission("怎么用快递100查申通")?.kind).toBe("logistics");
  });

  it("只跳过商城首页，不跳过检索结果页", () => {
    expect(shouldSkipHeavyPage("https://www.jd.com/")).toBe(true);
    expect(shouldSkipHeavyPage("https://search.jd.com/Search?keyword=xm5")).toBe(false);
    expect(shouldSkipHeavyPage("https://s.taobao.com/search?q=xm5")).toBe(false);
    expect(shouldSkipHeavyPage("https://www.dianping.com/search/keyword/1/10_火锅")).toBe(false);
  });

  it("日本7日拆成东京京都大阪，机票走 Kayak，不编出发地", () => {
    const plan = parseTripPlan("帮我规划日本7日自由行 东京京都大阪 要机票和酒店", now);
    expect(plan?.origin || "").toBe("");
    expect(plan?.cities).toEqual(expect.arrayContaining(["东京", "京都", "大阪"]));
    expect(plan?.flightSite).toBe("kayak");
  });

  it("任务书 10 句原话都能拆出结果页，不掉进聊天", () => {
    const qaNow = new Date(2026, 8, 9);
    const rows: Array<[string, string, string]> = [
      [
        "mission",
        "compare_shop",
        '帮我比较京东、淘宝、拼多多上"索尼WH-1000XM5耳机"的价格，找出最便宜的，并告诉我各平台的优惠活动和预计到货时间',
      ],
      [
        "mission",
        "local_outing",
        "我下周要从北京去上海出差3天，帮我找：1）周三早上8-10点的高铁 2）陆家嘴附近的酒店（400-600元/晚）3）附近好吃的本帮菜餐厅",
      ],
      [
        "mission",
        "research",
        '帮我搜索最近一周关于"AI浏览器"的新闻和评测，汇总成一份报告，包括：产品名称、核心功能、用户评价、价格',
      ],
      [
        "mission",
        "research",
        "我要做一款AI浏览器产品，帮我分析市面上前5名的竞品：1）每个产品的官网URL 2）核心卖点 3）定价策略 4）用户差评集中在哪些方面 5）他们的社交媒体账号",
      ],
      [
        "mission",
        "job_apply",
        '帮我搜索北京地区"AI产品经理"岗位，要求：1）薪资20K以上 2）公司规模100人以上 3）最近7天发布的 4）整理成表格：公司名、薪资、要求、投递链接',
      ],
      [
        "mission",
        "research",
        "我要写一篇关于\"远程办公\"的文章，帮我收集：1）最新的远程办公工具推荐（至少10个）2）每个工具的官网、价格、优缺点 3）相关的统计数据（如远程办公人数增长趋势）4）成功案例",
      ],
      [
        "mission",
        "home_appliance",
        "我要给新家买家电，清单是：冰箱、洗衣机、空调、电视。预算2万。帮我：1）每个品类找3个性价比最高的型号 2）比较各平台价格 3）查看用户评价，避开差评多的 4）给出最终推荐方案和总价格",
      ],
      [
        "mission",
        "research",
        "我要进入\"宠物智能硬件\"市场，帮我做完整的市场调研：1）市场规模和增长趋势 2）前10名品牌及其产品 3）各价格段的产品分布 4）用户痛点（从电商差评、社交媒体提取）5）技术趋势 6）进入这个市场的机会和风险分析。最后生成一份完整的调研报告",
      ],
      [
        "trip_plan",
        "",
        "我要计划一次日本7天自由行（东京-京都-大阪），帮我：1）比较不同航空公司的机票价格和时间 2）每个城市推荐2-3个酒店（不同价位）3）规划每天的行程（景点、交通、餐饮）4）计算总预算 5）列出需要提前预订的项目 6）整理成一份完整的旅行手册",
      ],
      [
        "mission",
        "research",
        "我在做一款\"AI写作助手\"产品，帮我：1）找出市面上前10名竞品 2）每个竞品的功能对比表 3）定价策略分析 4）从用户评论中提取他们的痛点和需求 5）分析他们的营销渠道（官网、社交媒体、广告投放）6）找出市场空白点 7）给出我的产品定位和差异化策略建议。最后生成一份完整的竞品分析报告",
      ],
    ];
    for (const [type, kind, q] of rows) {
      const a = parseLocalIntent(q);
      expect(a.type, q).toBe(type);
      if (a.type === "mission") {
        expect(a.mission.kind, q).toBe(kind);
        expect(a.mission.steps.length, q).toBeGreaterThan(0);
      }
      if (a.type === "trip_plan") {
        const plan = parseTripPlan(q, qaNow);
        expect(plan?.cities).toEqual(expect.arrayContaining(["东京", "京都", "大阪"]));
        expect(plan?.flightSite).toBe("kayak");
      }
    }
    const trip = parseLocalIntent(rows[1][2]);
    expect(trip.type).toBe("mission");
    if (trip.type === "mission") {
      const urls = trip.mission.steps.map((s) => s.url).join("\n");
      expect(urls).toContain("12306");
      expect(urls).toMatch(/BJP|date=2026-09-16/);
      expect(urls).toContain("hotels.ctrip.com");
      expect(urls).toContain("dianping.com");
      expect(urls).toMatch(/400|lowPrice/);
    }
    expect(newsTopic(rows[2][2])).toBe("AI浏览器");
    const news = parseMission(rows[2][2]);
    expect(news?.steps[0].url).toContain(encodeURIComponent("AI浏览器"));
    expect(news?.steps[0].url).not.toContain(encodeURIComponent("汇总成一份报告"));
  });
});
