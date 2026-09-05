import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  flightHintFromText,
  hotelReason,
  markdownToHtml,
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
});
