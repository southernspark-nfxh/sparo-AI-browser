import { describe, expect, it } from "vitest";
import { openUrlForSite, parseCommandUtterance } from "../src/main/agent/command-room.js";

const batch: Array<[string, string[]]> = [
  ["多平台比价 iPhone 17", ["京东", "淘宝"]],
  ["京东淘宝 1688 都查一下 iPhone 17 价格", ["京东", "淘宝", "1688"]],
  ["同时打开京东和淘宝，比价 iPhone 17", ["京东", "淘宝"]],
  ["同时在京东做比价和在淘宝做比价", ["京东", "淘宝"]],
  ["同时改商品A和商品B", ["商品A", "商品B"]],
];

describe("指挥室批量句路由", () => {
  it.each(batch)("%s 走 dispatch-many", (text, titles) => {
    const action = parseCommandUtterance(text);
    expect(action?.type).toBe("dispatch-many");
    if (action && action.type === "dispatch-many") {
      expect(action.items.map((item) => item.title)).toEqual(titles);
    }
  });

  it("多平台比价 iPhone 17 的新页地址是京东和淘宝搜索", () => {
    const action = parseCommandUtterance("多平台比价 iPhone 17");
    expect(action?.type).toBe("dispatch-many");
    if (!action || action.type !== "dispatch-many") return;
    expect(action.items.map((item) => item.url)).toEqual([
      "https://search.jd.com/Search?keyword=iPhone%2017",
      "https://s.taobao.com/search?q=iPhone%2017",
    ]);
  });

  it("不同平台、各平台、多个网站都拆成默认两站", () => {
    for (const text of [
      "去不同的电商平台 帮我对比 huawei gt14笔记本的价格",
      "各平台比价 iPhone 17",
      "多个网站查一下 MateBook GT 14 价格",
      "不同平台对比一下 iPhone 17",
      "各平台比个价 iPhone 17",
    ]) {
      const action = parseCommandUtterance(text);
      expect(action?.type, text).toBe("dispatch-many");
      if (action && action.type === "dispatch-many") {
        expect(action.items.map((item) => item.title)).toEqual(["京东", "淘宝"]);
      }
    }
  });

  it("天猫没有搜索模板，批量句落首页", () => {
    expect(openUrlForSite("天猫", "手机")).toBe("https://www.tmall.com/");
    expect(openUrlForSite("天猫", "手机")).not.toContain("search_product");
  });

  it("在吗、天气、打开网址、看看这个页面不进批量分派", () => {
    expect(parseCommandUtterance("在吗")).toBeNull();
    expect(parseCommandUtterance("今天天气怎么样")).toBeNull();
    expect(parseCommandUtterance("帮我看看这个页面")).toBeNull();
    expect(parseCommandUtterance("打开 https://example.com")).toEqual({
      type: "open",
      url: "https://example.com",
    });
  });
});
