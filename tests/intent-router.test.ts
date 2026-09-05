import { describe, expect, it } from "vitest";
import { parseLocalIntent } from "../src/main/agent/stub.js";
import {
  skillConflictsWithQuery,
  wantsPublish,
  agentCapabilityBrief,
  userReplyLang,
  readPageInstruction,
  leftoverAfterOpen,
  extractFirstHttpUrl,
} from "../src/main/agent/intent-router.js";
import { mutationsToSteps, shouldSkipRemember } from "../src/main/agent/remember.js";

describe("parseLocalIntent site routing", () => {
  it("发知乎 acts on Zhihu instead of Xiaohongshu skill", () => {
    const a = parseLocalIntent("帮我发知乎");
    expect(a.type).toBe("act");
    if (a.type === "act") {
      expect(a.url).toContain("zhihu.com");
      expect(a.text).toContain("知乎");
    }
  });

  it("发三条微博 acts instead of asking for a skill", () => {
    const a = parseLocalIntent("你现在是个科技微博博主 你发三条和ai相关的微博");
    expect(a.type).toBe("act");
    if (a.type === "act") {
      expect(a.url).toContain("weibo.com");
    }
  });

  it("你自己研究啊 goes to the model, not a skill lecture", () => {
    const a = parseLocalIntent("你自己研究啊");
    expect(a.type).toBe("llm");
  });

  it("Hello uses a canned intro without social networks", () => {
    const a = parseLocalIntent("Hello", "en");
    expect(a.type).toBe("reply");
    if (a.type === "reply") {
      expect(a.text).toMatch(/Hello/);
      expect(a.text).not.toMatch(/Xiaohongshu|小红书|Weibo|publish|social/i);
    }
  });

  it("你好 uses the Chinese canned intro", () => {
    const a = parseLocalIntent("你好", "zh");
    expect(a.type).toBe("reply");
    if (a.type === "reply") {
      expect(a.text).toMatch(/你好/);
      expect(a.text).not.toMatch(/小红书/);
    }
  });

  it("发小红书 still runs the XHS skill", () => {
    const a = parseLocalIntent("发小红书");
    expect(a).toMatchObject({
      type: "run_skill",
      id: "xhs-longform-publish",
    });
  });

  it("打开微博 goes to weibo", () => {
    const a = parseLocalIntent("打开微博");
    expect(a.type).toBe("navigate");
    if (a.type === "navigate") {
      expect(a.url).toContain("weibo.com");
    }
  });

  it("打开百度，搜天气 keeps the search half", () => {
    const a = parseLocalIntent("打开百度，搜今天北京天气");
    expect(a.type).toBe("act");
    if (a.type === "act") {
      expect(a.url).toContain("baidu.com");
      expect(a.text).toMatch(/天气/);
    }
  });

  it("打开淘宝，搜耳机 is not navigate-only", () => {
    const a = parseLocalIntent("打开淘宝，搜无线耳机");
    expect(a.type).toBe("act");
    if (a.type === "act") expect(a.url).toContain("taobao.com");
  });

  it("gov.cn plus 这是什么网站 is not the product intro", () => {
    const a = parseLocalIntent("打开 https://www.gov.cn 用中文告诉我这是什么网站");
    expect(a.type).not.toBe("reply");
    expect(a.type).toBe("act");
    if (a.type === "act") expect(a.url).toContain("gov.cn");
  });

  it("这是什么网站 alone summarizes the current page", () => {
    expect(parseLocalIntent("这是什么网站").type).toBe("summarize");
  });

  it("extracts http URL before Chinese instructions", () => {
    expect(
      extractFirstHttpUrl(
        "打开 https://news.ycombinator.com 用中文告诉我首页在聊什么",
      ),
    ).toBe("https://news.ycombinator.com");
    expect(leftoverAfterOpen("打开百度，搜今天北京天气")).toMatch(/天气/);
    expect(leftoverAfterOpen("打开 https://www.gov.cn")).toBeNull();
    expect(parseLocalIntent("打开 https://www.gov.cn").type).toBe("navigate");
  });

  it("打印走打印而不是闲聊", () => {
    expect(parseLocalIntent("把当前页打印出来").type).toBe("print");
  });

  it("查携程酒店走 travel_search 而不是空转 act", () => {
    const a = parseLocalIntent("帮我查查携程 找一些 9月15日 伊斯坦布尔的酒店");
    expect(a.type).toBe("travel_search");
    if (a.type === "travel_search" && a.kind === "hotel") {
      expect(a.city).toBe("伊斯坦布尔");
      expect(a.checkin).toBe("2026-09-15");
      expect(a.checkout).toBe("2026-09-16");
      expect(a.site).toBe("ctrip");
    }
  });

  it("途牛酒店不改道携程", () => {
    const a = parseLocalIntent("打开途牛，查9月15日伊斯坦布尔的酒店");
    expect(a.type).toBe("travel_search");
    if (a.type === "travel_search") expect(a.site).toBe("tuniu");
  });

  it("一键回复 does not publish", () => {
    const a = parseLocalIntent("帮我回一下评论");
    expect(a.type).toBe("one_click_reply");
  });

  it("总结当前页 is summarize", () => {
    expect(parseLocalIntent("总结当前页").type).toBe("summarize");
    expect(parseLocalIntent("总结当前页 列5件要对齐的事").type).toBe("summarize");
  });

  it("左侧英文啥意思 reads the page instead of guessing", () => {
    expect(parseLocalIntent("我问你左侧网页里面的英文啥意思").type).toBe(
      "summarize",
    );
    expect(parseLocalIntent("页面显示什么").type).toBe("summarize");
    expect(parseLocalIntent("商店状态的英文啥意思").type).toBe("summarize");
  });

  it("Chinese questions get a Chinese read-page brief", () => {
    expect(userReplyLang("商店状态的英文啥意思")).toBe("zh");
    expect(readPageInstruction("商店状态的英文啥意思")).toMatch(/必须用中文回答/);
    expect(readPageInstruction("商店状态的英文啥意思")).toMatch(/不要用英文写整页摘要/);
  });

  it("帮我填这张表 is fill_form", () => {
    expect(parseLocalIntent("帮我填这张表").type).toBe("fill_form");
  });

  it("开始录制不再进入录制，只说明这一版没有教一遍", () => {
    const a = parseLocalIntent("开始录制");
    expect(a.type).toBe("reply");
    if (a.type === "reply") expect(a.text).toMatch(/不提供/);
    expect(parseLocalIntent("结束录制并保存为测试").type).toBe("reply");
  });
});

describe("skillConflictsWithQuery", () => {
  it("blocks Xiaohongshu skill when user named Zhihu", () => {
    expect(
      skillConflictsWithQuery("发知乎", "xhs-longform-publish", "xiaohongshu-creator"),
    ).toBe(true);
  });

  it("allows Xiaohongshu skill when user named 小红书", () => {
    expect(
      skillConflictsWithQuery("发小红书", "xhs-longform-publish", "xiaohongshu-creator"),
    ).toBe(false);
  });
});

describe("wantsPublish", () => {
  it("detects 在知乎写篇文章", () => {
    expect(wantsPublish("我想在知乎写篇文章")).toBe(true);
  });

  it("detects 发三条微博", () => {
    expect(wantsPublish("你发三条和ai相关的微博")).toBe(true);
  });
});

describe("shouldSkipRemember", () => {
  it("does not save captcha or pause traces as skills", () => {
    expect(shouldSkipRemember("打开高德", "遇到滑块，已暂停等人")).toBe(true);
    expect(shouldSkipRemember("发微博", "发三条草稿已写好")).toBe(false);
  });
});

describe("mutationsToSteps", () => {
  it("templates long fill values so remembered skills stay reusable", () => {
    const steps = mutationsToSteps([
      { tool: "click", args: { selector: "#box" } },
      { tool: "fill", args: { selector: "textarea", value: "这是一条很长的微博正文用来测试模板" } },
    ]);
    expect(steps[1].value).toBe("{{body}}");
  });
});

describe("agentCapabilityBrief", () => {
  it("uses English when locale is en", () => {
    expect(agentCapabilityBrief("en")).toMatch(/You are Sparo/);
    expect(agentCapabilityBrief("en")).not.toMatch(/Xiaohongshu|小红书/);
    expect(agentCapabilityBrief("zh")).toMatch(/会动手的 AI 浏览器/);
    expect(agentCapabilityBrief("zh")).not.toMatch(/小红书/);
    expect(agentCapabilityBrief()).toMatch(/You are Sparo/);
  });
});
