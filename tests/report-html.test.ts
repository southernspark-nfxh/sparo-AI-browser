import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  flightHintFromText,
  hotelReason,
  markdownToHtml,
  isPendingRewrite,
  readingReportHtml,
  readingTitleOf,
  shouldSealLongRead,
  stripReadingTitle,
  tripReportHtml,
  writeHtmlReport,
} from "../src/main/agent/report-html.js";

describe("markdownToHtml", () => {
  it("renders heading, list and table", () => {
    const html = markdownToHtml(
      [
        "## 日程表",
        "",
        "| 日期 | 城市 |",
        "|---|---|",
        "| 9/18 | 伊斯坦布尔 |",
        "",
        "- **国航** 直飞",
      ].join("\n"),
    );
    expect(html).toContain("<h3>日程表</h3>");
    expect(html).toContain("<th>日期</th>");
    expect(html).toContain("<td>伊斯坦布尔</td>");
    expect(html).toContain("<strong>国航</strong>");
  });

  it("turns [店名](链接) into a clickable hotel link", () => {
    const html = markdownToHtml("- [万达文华酒店](https://hotels.ctrip.com/hotels/123.html)");
    expect(html).toContain('href="https://hotels.ctrip.com/hotels/123.html"');
    expect(html).toContain("万达文华酒店");
    expect(html).toContain("hotel-link");
  });

  it("downgrades non-URL pseudo links like [机票：未知](未知) to plain text", () => {
    const html = markdownToHtml("- [机票：未知](未知)");
    expect(html).not.toContain("](未知)");
    expect(html).not.toContain('href="未知"');
    expect(html).toContain("机票：未知");
  });

  it("never freezes on a loose pipe line without a table separator", () => {
    // 旧实现：含 | 却不是表格的行不被消费，i 永不前进，主进程 100% CPU 死循环
    const text = Array.from({ length: 2000 }, () => "全季酒店(外滩店) | ¥439 | 评分4.8").join("\n");
    const t0 = Date.now();
    const html = markdownToHtml(text);
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(html).toContain("全季酒店(外滩店)");
  });
});

describe("阅读优先：长回答落页", () => {
  it("seals long prose, structured sections and tables", () => {
    expect(shouldSealLongRead("短句，直接聊天回复。")).toBe(false);
    expect(shouldSealLongRead("一".repeat(600))).toBe(true);
    const dbg = [
      "# 方案",
      "## 背景",
      "项目背景说明".repeat(24),
      "## 目标",
      "目标说明".repeat(24),
    ].join("\n");
    expect(shouldSealLongRead(dbg)).toBe(true);
    const table = [
      "| 城市 | 销量 | 退货率 |",
      "|---|---|---|",
      ...Array.from({ length: 12 }, (_, i) => `| 城市${i + 1} | ${100 - i} | 3.${i} |`),
    ].join("\n");
    expect(shouldSealLongRead(table)).toBe(true);
  });

  it("takes title from heading or first sentence and strips it from body", () => {
    const md = "# 星火计划申报方案\n\n## 背景\n正文";
    expect(readingTitleOf(md)).toBe("星火计划申报方案");
    expect(stripReadingTitle(md)).toBe("## 背景\n正文");
    expect(readingTitleOf("这是一份没有标题的整理稿。后面还有内容", "兜底")).toBe(
      "这是一份没有标题的整理稿",
    );
    expect(readingTitleOf("", "兜底")).toBe("兜底");
    // 模型把一级标题写成「正文」这类空话时，退回第一句
    expect(readingTitleOf("# 正文\n\n秋天来了。后面还有内容", "帮我写一篇散文")).toBe(
      "秋天来了",
    );
  });

  it("第一句升成标题后不再当正文第一段", () => {
    const md = "这段话是说明，后面是正文";
    const title = readingTitleOf(md);
    const html = readingReportHtml({ title, body: stripReadingTitle(md) });
    expect(html).toContain(`<h1>${title}</h1>`);
    const body = html.slice(html.indexOf('<div class="body">'));
    expect(body).not.toContain(title);
  });

  it("页头用来源 URL，域名不拆开", () => {
    const html = readingReportHtml({
      title: "收盘怎么看",
      body: "这是正文，不是标题。",
      source: { url: "https://weibo.com/u/1216826604", title: "wu2198", siteName: "微博" },
    });
    expect(html).toContain('<a href="https://weibo.com/u/1216826604">');
    expect(html).toContain("weibo.com");
    expect(html).not.toContain("wei bo.com");
  });

  it("只答应重新生成时不算已经改完", () => {
    expect(isPendingRewrite("阅读页里那句一并删掉，重新生成一版。")).toBe(true);
    expect(isPendingRewrite("# 收盘\n\n正文已经改过。")).toBe(false);
    expect(isPendingRewrite("")).toBe(true);
  });
});

describe("tripReportHtml", () => {
  it("writes a day-first handbook with flight and hotel actions", () => {
    const html = tripReportHtml({
      plan: {
        origin: "北京",
        cities: ["伊斯坦布尔", "第比利斯"],
        startDate: "2026-09-18",
        endDate: "2026-09-27",
        flightSite: "ctrip",
        hotelSite: "ctrip",
      },
      userAsk: "规划土耳其格鲁吉亚",
      summary: "## 机票\n\n- 国航 直飞",
      hotels: [
        {
          city: "伊斯坦布尔",
          name: "万达文华酒店",
          url: "https://hotels.ctrip.com/hotels/123.html",
        },
      ],
      flights: [
        {
          label: "北京 → 伊斯坦布尔 2026-09-18",
          url: "https://flights.ctrip.com/online/list/oneway-bjs-ist?depdate=2026-09-18",
        },
      ],
    });
    expect(html).toContain("按天走，先看怎么选，再点开订");
    expect(html).toContain("到伊斯坦布尔");
    expect(html).toContain("北京 → 伊斯坦布尔");
    expect(html).toContain("oneway-bjs-ist");
    expect(html).toContain("万达文华酒店");
    expect(html).toContain("航班时刻、粗算和说明");
    expect(html).not.toContain("可直接打开的酒店");
    expect(html).toContain("行程手册");
    const dir = mkdtempSync(join(tmpdir(), "sparo-report-"));
    const doc = writeHtmlReport(dir, "trip-demo", html, {
      title: "北京 → 伊斯坦布尔",
      kind: "trip",
    });
    expect(readFileSync(doc.path, "utf8")).toContain("SPARO 行程手册");
  });

  it("explains hotel pick and flight range", () => {
    expect(hotelReason({ city: "上海", name: "全季酒店(上海外滩山东中路店)", url: "https://x", price: "¥439" }, 1)).toMatch(
      /外滩/,
    );
    expect(flightHintFromText("直飞 06:55 ¥650起 中转 ¥530")).toMatch(/530|650|6:55/);
  });

  it("open-jaw trip without origin renders no fake return row and no leading arrows", () => {
    const html = tripReportHtml({
      plan: {
        origin: "",
        cities: ["杭州", "上海", "乌镇", "苏州"],
        startDate: "2026-10-12",
        endDate: "2026-10-16",
        flightSite: "ctrip",
        hotelSite: "ctrip",
      },
      userAsk: "杭州进上海出华东5天高铁",
      summary: "## 路线",
    });
    expect(html).toContain("<title>杭州 → 上海 → 乌镇 → 苏州 · Sparo 行程手册</title>");
    expect(html).toContain("4段城际");
    // 无出发地：没有「回 」假回程卡，也没有空箭头
    expect(html).not.toContain(">回<");
    expect(html).not.toContain(" → 杭州");
  });
});
