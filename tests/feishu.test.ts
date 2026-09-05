import { describe, expect, it } from "vitest";
import { parseLocalIntent } from "../src/main/agent/stub.js";
import {
  FEISHU_MESSENGER_URL,
  FEISHU_REPORT_URL,
  alreadyOnFeishuTask,
  feishuUrl,
  parseFeishuTask,
} from "../src/main/agent/feishu.js";
import { routeUserGoal } from "../src/main/agent/intent-router.js";

describe("parseFeishuTask", () => {
  it("不含飞书则空", () => {
    expect(parseFeishuTask("给张三发：下午开会")).toBeNull();
  });

  it("打开飞书网页版走消息页而不是官网", () => {
    const t = parseFeishuTask("打开飞书网页版");
    expect(t).toEqual({ kind: "open" });
    expect(feishuUrl(t!)).toBe(FEISHU_MESSENGER_URL);
  });

  it("给张三发消息", () => {
    const t = parseFeishuTask("打开飞书，给张三发：下午三点开会");
    expect(t).toMatchObject({
      kind: "chat",
      to: "张三",
      body: "下午三点开会",
    });
  });

  it("写今日日报", () => {
    const t = parseFeishuTask("在飞书写今日日报：完成了官网素材搜集");
    expect(t).toMatchObject({
      kind: "journal",
      title: "今日日报",
      body: "完成了官网素材搜集",
    });
    expect(feishuUrl(t!)).toBe(FEISHU_REPORT_URL);
  });

  it("搜联系人当聊天", () => {
    const t = parseFeishuTask("打开飞书，搜李四");
    expect(t).toMatchObject({ kind: "chat", to: "李四" });
  });
});

describe("routeUserGoal feishu", () => {
  it("打开飞书网页版不走官网 act", () => {
    const a = routeUserGoal("打开飞书网页版");
    expect(a).toMatchObject({ type: "feishu", task: { kind: "open" } });
  });

  it("打开飞书给张三发不走 leftover act", () => {
    const a = routeUserGoal("打开飞书，给张三发：下午三点开会");
    expect(a?.type).toBe("feishu");
    if (a?.type === "feishu") {
      expect(a.task.to).toBe("张三");
      expect(a.task.body).toBe("下午三点开会");
    }
  });

  it("侧栏原句进 parseLocalIntent", () => {
    const a = parseLocalIntent("打开飞书网页版");
    expect(a.type).toBe("feishu");
    if (a.type === "feishu") expect(a.task.kind).toBe("open");
  });
});

describe("alreadyOnFeishuTask", () => {
  it("消息页算已打开", () => {
    expect(
      alreadyOnFeishuTask("https://www.feishu.cn/next/messenger", { kind: "open" }),
    ).toBe(true);
    expect(
      alreadyOnFeishuTask("https://accounts.feishu.cn/accounts/page/login", {
        kind: "open",
      }),
    ).toBe(false);
  });
});
