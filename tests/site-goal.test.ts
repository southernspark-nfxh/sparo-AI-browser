import { describe, expect, it } from "vitest";
import { legalSiteTarget, understandPrompt } from "../src/main/agent/brain/understand.js";
import { analyzeGoal, type StepFinding } from "../src/main/agent/loop.js";
import { loginRedirectNote, mismatchWrap, parseSiteLanding, reasonerPromptV2 } from "../src/main/agent/kernel/reasoner.js";
import { thoughtForAsync } from "../src/main/agent/kernel/index.js";
import { applyTurn, classifyIngest, type ActiveMission } from "../src/main/agent/runtime.js";

const NOW = new Date(2026, 9, 22);
const BAIDU = "https://www.baidu.com/s?wd=北京小汽车摇号";
const EXCUSE = "当前这个网页不是微博登录页，不能在这个页面登录微博";

function modelLoginWeibo(): string {
  return JSON.stringify({
    heard: "登录微博",
    ingest: "new",
    site: "weibo.com",
    clauses: [{ text: "登陆微博", purpose: "登录微博", deliverables: ["answer"] }],
    deliverables: ["answer"],
    plan: [
      {
        cap: "navigate",
        covers: ["answer"],
        query: "https://weibo.com/login.php",
        label: "打开微博登录页",
      },
    ],
  });
}

describe("目标站点：错页先打开，说明文不能当完成", () => {
  it("「登陆微博」解析出 goal.site，错页第一步 navigate，模型说汇总也不许", async () => {
    expect(legalSiteTarget("微博")).toBeNull();
    expect(legalSiteTarget("weibo.com")?.host).toBe("weibo.com");
    expect(understandPrompt("登陆微博")).toContain("weibo.com");

    const goal = await analyzeGoal("登陆微博", { now: NOW, page: { url: BAIDU, title: "百度" } }, async () =>
      modelLoginWeibo(),
    );
    expect(goal.site).toBe("weibo.com");
    expect(goal.siteUrl).toMatch(/weibo\.com\/login\.php/);

    const mission: ActiveMission = {
      id: "m-weibo",
      raw: "登陆微博",
      goal,
      plan: goal.handbook || [],
      findings: [],
      state: "running",
    };
    let called = 0;
    const thought = await thoughtForAsync(
      mission,
      async () => {
        called += 1;
        return JSON.stringify({ synthesize: true, why: EXCUSE });
      },
      undefined,
      BAIDU,
    );
    expect(called).toBe(0);
    expect(thought.synthesize).toBeFalsy();
    expect(thought.next?.cap).toBe("navigate");
    expect(thought.next?.query).toMatch(/weibo\.com/);
    expect(reasonerPromptV2(goal, [], BAIDU)).toContain("第一步");
    expect(reasonerPromptV2(goal, [], BAIDU)).toContain(BAIDU);
  });

  it("错配场景不把说明文收成 done", () => {
    const goal = {
      raw: "登陆微博",
      intent: "登录微博",
      kind: "chat" as const,
      deliverables: [{ id: "answer" as const, label: "直接回答", required: true }],
      known: {},
      unknown: [],
      decision: "act" as const,
      approach: "打开微博登录页",
      site: "weibo.com",
      siteUrl: "https://weibo.com/login.php",
    };
    const excuse: StepFinding = {
      step: {
        id: "act-explain",
        cap: "act",
        label: "说明",
        covers: ["answer"],
        query: "登陆微博",
      },
      text: EXCUSE,
      url: BAIDU,
      ok: true,
    };
    const wrapped = mismatchWrap({
      goal,
      pageUrl: BAIDU,
      findings: [excuse],
      explanation: EXCUSE,
    });
    expect(wrapped.state).not.toBe("done");
    expect(wrapped.text).not.toContain("不是微博");
    expect(wrapped.navigateTo).toMatch(/weibo\.com/);

    const tried: StepFinding = {
      step: {
        id: "navigate-site-weibo.com",
        cap: "navigate",
        label: "打开 weibo.com",
        covers: ["answer"],
        query: "https://weibo.com/login.php",
      },
      text: "没有打开",
      url: BAIDU,
      ok: false,
    };
    const asked = mismatchWrap({
      goal,
      pageUrl: BAIDU,
      findings: [excuse, tried],
      explanation: EXCUSE,
    });
    expect(asked.state).toBe("waiting_human");
    expect(asked.text).toMatch(/打开/);
    expect(asked.text).not.toContain("不是微博");
  });

  it("非登录墙的挂起单下「登陆微博」归 new", () => {
    const first = applyTurn("北京小汽车哪里摇号 帮我找到网站", { now: NOW });
    expect(first.mission).toBeTruthy();
    const parked: ActiveMission = {
      ...first.mission!,
      state: "waiting_human",
      waitReason: "help",
      ask: "这一步点不动，换个入口还是先跳过？",
    };
    expect(classifyIngest("登陆微博", parked).kind).toBe("new");
    const again = applyTurn("登陆微博", { active: parked, now: NOW });
    expect(again.ingest).toBe("new");
    expect(again.mission?.raw).toBe("登陆微博");
    expect(again.mission?.id).not.toBe(parked.id);

    const wall: ActiveMission = {
      ...first.mission!,
      state: "waiting_human",
      waitReason: "login_wall",
      ask: "这一步卡在登录页（weibo.com）。你在窗口里登录后说「继续」，我接着做。",
    };
    expect(classifyIngest("我登录好了", wall).kind).toBe("continue");
  });

  it("停在微博首页时，模型给的登录页必须同站，外站 URL 丢掉", () => {
    const goal = {
      raw: "登陆微博",
      intent: "登录微博",
      kind: "chat" as const,
      deliverables: [{ id: "answer" as const, label: "直接回答", required: true }],
      known: {},
      unknown: [],
      decision: "act" as const,
      approach: "打开微博登录页",
      site: "weibo.com",
      siteUrl: "https://weibo.com/",
    };
    const home = "https://weibo.com/";
    const hit = parseSiteLanding('{"navigate":"https://weibo.com/login.php"}', goal, home);
    expect(hit && "navigate" in hit ? hit.navigate : "").toMatch(/weibo\.com\/login\.php/);
    expect(parseSiteLanding('{"navigate":"https://www.baidu.com/s?wd=微博"}', goal, home)).toBeNull();
    expect(parseSiteLanding('{"navigate":"https://weibo.com/"}', goal, home)).toBeNull();
    expect(parseSiteLanding('{"done":true}', goal, home)).toEqual({ done: true });
    const note = loginRedirectNote(goal, [
      {
        step: {
          id: "navigate-site-weibo.com",
          cap: "navigate",
          label: "打开 weibo.com",
          covers: ["answer"],
          query: "https://weibo.com/login.php",
        },
        text: "首页",
        url: "https://weibo.com/",
        ok: true,
      },
    ]);
    expect(note).toMatch(/没有停在登录墙/);
    expect(note).toMatch(/跳回/);
    expect(note).not.toMatch(/继续/);
  });
});
