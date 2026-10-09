import { describe, expect, it } from "vitest";
import { parseLocalIntent } from "../src/main/agent/stub.js";
import { parseMission, shopCount } from "../src/main/agent/mission.js";
import { researchReportHtml } from "../src/main/agent/report-html.js";
import {
  filterShopOffers,
  formatShopPicks,
  looksLikeResearchAsk,
  looksLikeResearchBody,
  cleanSearchPageText,
  missionNeedsReport,
  reportChips,
  researchChatBrief,
  shouldSealShopReport,
} from "../src/main/agent/research-report.js";

const ASK = "我想在1688 买T恤 xxl码 新潮一些的 不要太贵 控制在100元以内 评分高 符合年轻人的审美的 但要简洁。你帮我筛选一些 十款吧";

describe("research report rule", () => {
  it("1688 多条件买货走选品任务，不开拼多多", () => {
    const m = parseMission(ASK);
    expect(m?.kind).toBe("sourcing");
    expect(m?.slots.intent).toBe("buy");
    expect(m?.slots.product).toMatch(/T恤/);
    expect(m?.slots.size).toBe("XXL");
    expect(m?.slots.budget).toBe("100");
    expect(m?.slots.count).toBe("10");
    expect(shopCount(ASK)).toBe(10);
    const urls = (m?.steps || []).map((s) => s.url).join("\n");
    expect(urls).toContain("s.1688.com/selloffer");
    expect(urls).toMatch(/T%E6%81%A4|T恤/);
    expect(urls).toMatch(/priceEnd=100/);
    expect(urls).not.toMatch(/XXL|100%E5%85%83/);
    expect(urls).not.toContain("yangkeduo.com");
    expect(urls).not.toContain("baidu.com");
    expect(reportChips(m!.slots)).toEqual(expect.arrayContaining(["T恤", "XXL", "100元内", "10款"]));
    expect(reportChips(m!.slots)).not.toContain("buy");
    const routed = parseLocalIntent(ASK);
    expect(routed.type).toBe("mission");
  });

  it("丢掉工作服秋裤，只留预算内短袖", () => {
    const picked = filterShopOffers(
      [
        { name: "八一建军节polo战友聚会文化衫", url: "https://detail.1688.com/offer/11111111.html", price: "¥16" },
        { name: "男士秋裤纯棉保暖", url: "https://detail.1688.com/offer/22222222.html", price: "¥15" },
        { name: "重磅纯棉短袖T恤男宽松简约", url: "https://detail.1688.com/offer/33333333.html", price: "¥68" },
        { name: "潮牌纯色短袖T恤宽松", url: "https://detail.1688.com/offer/44444444.html", price: "¥188" },
        { name: "日系水洗短袖T恤纯棉", url: "https://detail.1688.com/offer/55555555.html", price: "¥45" },
      ],
      { budget: 100, want: 10 },
    );
    expect(picked.map((o) => o.name).join(" ")).toMatch(/重磅纯棉|日系水洗/);
    expect(picked.every((o) => !/秋裤|战友/.test(o.name))).toBe(true);
    expect(picked.every((o) => !/188/.test(o.price || ""))).toBe(true);
    const md = formatShopPicks(picked, {
      userAsk: ASK,
      count: 10,
      searchUrls: ["https://s.1688.com/selloffer/offer_search.htm"],
    });
    expect(md).toContain("detail.1688.com/offer/33333333");
    expect(md).not.toContain("空空如也");
  });

  it("拼多多选品原句仍走供应商调研", () => {
    const m = parseMission(
      '我想在拼多多卖"便携式榨汁杯"，帮我调研：1）1688上前10名供应商的价格和起订量',
    );
    expect(m?.kind).toBe("sourcing");
    expect(m?.slots.intent).not.toBe("buy");
    expect(m?.steps.some((s) => /yangkeduo/.test(s.url))).toBe(true);
  });

  it("认多种信息调研，聊天只留一句", () => {
    expect(looksLikeResearchAsk(ASK)).toBe(true);
    expect(missionNeedsReport("sourcing")).toBe(true);
    expect(missionNeedsReport("weather")).toBe(false);
    expect(researchChatBrief("1688 T恤 XXL 100元内 筛选")).toMatch(/筛选报告已写好/);
    expect(researchChatBrief("1688 T恤 XXL 100元内 筛选")).not.toMatch(/\| 价格 \|/);
  });

  it("工具循环残骸也算调研正文", () => {
    expect(
      looksLikeResearchBody("你陷入了重复工具调用。请停止操作。\nsnapshot: 257\npage_text: 4442"),
    ).toBe(true);
    expect(
      shouldSealShopReport(
        "都有什么吃的玩的推荐？",
        "你陷入了重复工具调用。请停止操作。\nsnapshot: 257\npage_text: 4442",
      ),
    ).toBe(false);
  });

  it("检索页正文清洗：截掉大家还在搜和杂行", () => {
    const dirty = "免费音乐网站推荐\n铜钟音乐 免费听歌\n大家还在搜\n黄晓明正式入读上海戏剧学院\n倪萍哭到浑身发抖";
    const clean = cleanSearchPageText(dirty);
    expect(clean).toContain("铜钟音乐");
    expect(clean).not.toContain("黄晓明");
    expect(cleanSearchPageText("正在思考\n听\n真正的正文内容")).toBe("真正的正文内容");
  });

  it("报告页带原话和芯片，不是侧栏长文", () => {
    const html = researchReportHtml({
      title: "1688 T恤 XXL 100元内 筛选",
      userAsk: ASK,
      body: "| 款式 | 价格 |\n|---|---|\n| [简约短袖](https://detail.1688.com/1.html) | ¥68 |",
      chips: ["T恤", "XXL", "100"],
    });
    expect(html).toContain("SPARO 筛选报告");
    expect(html).toContain("XXL");
    expect(html).toContain("100");
    expect(html).toContain("detail.1688.com");
    expect(html).toContain("简约短袖");
  });
});
