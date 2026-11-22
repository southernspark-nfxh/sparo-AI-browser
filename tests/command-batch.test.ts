import { describe, expect, it } from "vitest";
import { batchQuery, openUrlForSite, parseCommandUtterance } from "../src/main/agent/command-room.js";

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

  it("打开四个号看数据时，每页拿到完整句子，不把站名抠成残句", () => {
    const action = parseCommandUtterance("帮我打开我的微博号、知乎号，还有头条号和百家号，查看数据");
    expect(action?.type).toBe("dispatch-many");
    if (!action || action.type !== "dispatch-many") return;
    expect(action.items.map((item) => item.title)).toEqual(["微博", "知乎", "头条", "百家号"]);
    const raw = "帮我打开我的微博号、知乎号，还有头条号和百家号，查看数据";
    for (const item of action.items) {
      expect(item.text).toContain(`这一页是「${item.title}」`);
      expect(item.text).toContain(`用户原话：${raw}`);
      expect(item.text).not.toContain("只查看粉丝");
      expect(item.text).toContain("不要说用户的原话被截断");
    }
  });

  it("比价和专名不被改写成查粉丝，也不从词中间删掉和与", () => {
    const price = parseCommandUtterance("在京东和淘宝看看 iPhone 17 多少钱");
    expect(price?.type).toBe("dispatch-many");
    if (price?.type === "dispatch-many") {
      for (const item of price.items) {
        expect(item.text).toContain("用户原话：在京东和淘宝看看 iPhone 17 多少钱");
        expect(item.text).not.toContain("粉丝");
      }
      expect(price.items.map((item) => item.url)).toEqual([
        "https://search.jd.com/Search?keyword=iPhone%2017%20%E5%A4%9A%E5%B0%91%E9%92%B1",
        "https://s.taobao.com/search?q=iPhone%2017%20%E5%A4%9A%E5%B0%91%E9%92%B1",
      ]);
    }
    expect(batchQuery("查一下和田玉手镯")).toBe("和田玉手镯");
    expect(batchQuery("搜索与辉同行")).toBe("与辉同行");
    expect(batchQuery("比价 和平精英手柄")).toBe("和平精英手柄");
  });

  it("打开微博、知乎、头条和百家号只各给一张首页，不派任务", () => {
    const action = parseCommandUtterance("打开微博、知乎、头条和百家号");
    expect(action?.type).toBe("open-many");
    if (!action || action.type !== "open-many") return;
    expect(action.items).toEqual([
      { title: "微博", url: "https://weibo.com/" },
      { title: "知乎", url: "https://www.zhihu.com/" },
      { title: "头条", url: "https://www.toutiao.com/" },
      { title: "百家号", url: "https://baijiahao.baidu.com/" },
    ]);
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
