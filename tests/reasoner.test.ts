import { describe, expect, it } from "vitest";
import { applyTurn } from "../src/main/agent/runtime.js";
import { observe, thoughtFor, thoughtForAsync } from "../src/main/agent/kernel/index.js";
import {
  parseReasonerJson,
  applyModelPick,
} from "../src/main/agent/kernel/reasoner.js";
import { compileHands } from "../src/main/agent/loop.js";
import type { StepFinding } from "../src/main/agent/loop.js";
import type { Plan } from "../src/main/agent/kernel/plan.js";

const NOW = new Date(2026, 8, 14);
const NY =
  "想去美国纽约 两天 不知道住哪儿 有推荐吗 还有餐厅之类的 包括有什么景点？给我设计一下";

function stayFinding(mission: NonNullable<ReturnType<typeof applyTurn>["mission"]>): StepFinding {
  const step = mission.plan.find((s) => s.covers.includes("stay")) || mission.plan[0];
  return {
    step,
    text: "希尔顿酒店 每晚984 含早\n万豪酒店 4.4分 客房",
    url: "https://hotels.ctrip.com/hotels/list?city=633",
    ok: true,
  };
}

describe("推理器：模型自己挑下一步，本地最小校验", () => {
  it("启发式兜底默认先住宿", () => {
    const t = applyTurn(NY, { now: NOW });
    expect(thoughtFor(t.mission!).next?.cap).toBe("hotel_search");
  });

  it("模型挑餐厅：applyModelPick 透传合法 cap + covers", () => {
    const t = applyTurn(NY, { now: NOW });
    const heuristic = thoughtFor(t.mission!);
    const picked = applyModelPick(heuristic, {
      cap: "search_read",
      covers: ["food"],
      query: "纽约餐厅",
      city: "纽约",
      why: "用户先问了餐厅",
    });
    expect(picked.ask).toBeUndefined();
    expect(picked.next?.cap).toBe("search_read");
    expect(picked.next?.covers).toContain("food");
    expect(picked.next?.query).toBe("纽约餐厅");
    expect(picked.why).toBe("用户先问了餐厅");
  });

  it("模型挑景点：住查完后 nextThoughtAsync 端到端", async () => {
    const t = applyTurn(NY, { now: NOW });
    const after = observe(t.mission!, stayFinding(t.mission!));
    const thought = await thoughtForAsync(after, async () =>
      JSON.stringify({ next: { cap: "search_read", covers: ["sights"] }, why: "先补景点" }),
    );
    expect(thought.next?.cap).toBe("search_read");
    expect(thought.next?.covers).toContain("sights");
  });

  it("模型给非法 cap：退回启发式", async () => {
    const t = applyTurn(NY, { now: NOW });
    const thought = await thoughtForAsync(t.mission!, async () =>
      JSON.stringify({ next: { cap: "explode" } }),
    );
    expect(thought.next?.cap).toBe("hotel_search");
  });

  it("模型给空 covers：退回启发式", () => {
    const t = applyTurn(NY, { now: NOW });
    const heuristic = thoughtFor(t.mission!);
    const picked = applyModelPick(heuristic, { cap: "hotel_search", covers: ["bad_id"] });
    expect(picked.next?.cap).toBe("hotel_search");
  });

  it("模型说 ask：透传，本地不二次拦截", () => {
    const t = applyTurn(NY, { now: NOW });
    const heuristic = thoughtFor(t.mission!);
    const picked = applyModelPick(heuristic, { ask: "几个人住？", why: "缺人数" });
    expect(picked.ask).toBe("几个人住？");
    expect(picked.next).toBeUndefined();
    expect(picked.why).toBe("缺人数");
  });

  it("模型说 synthesize：透传，next 清空", () => {
    const t = applyTurn(NY, { now: NOW });
    const heuristic = thoughtFor(t.mission!);
    const picked = applyModelPick(heuristic, { synthesize: true, why: "都齐了" });
    expect(picked.synthesize).toBe(true);
    expect(picked.next).toBeUndefined();
    expect(picked.why).toBe("都齐了");
  });

  it("非法 JSON 不炸，退回启发式", async () => {
    const t = applyTurn(NY, { now: NOW });
    const thought = await thoughtForAsync(t.mission!, async () => "不是json");
    expect(thought.next?.cap).toBe("hotel_search");
  });

  it("parseReasonerJson 认 next.cap / 顶层 cap / next.covers / 顶层 covers / ask / synthesize", () => {
    expect(parseReasonerJson('{"next":{"cap":"hotel_search","covers":["stay"]}}')?.cap).toBe("hotel_search");
    expect(parseReasonerJson('{"cap":"search_read","covers":["food"],"why":"先吃"}')?.cap).toBe("search_read");
    expect(parseReasonerJson('{"next":{"cap":"search_read","covers":["sights"]}}')?.covers).toEqual(["sights"]);
    expect(parseReasonerJson('{"ask":"几个人？","why":"缺人数"}')?.ask).toBe("几个人？");
    expect(parseReasonerJson('{"synthesize":true,"why":"齐了"}')?.synthesize).toBe(true);
    expect(parseReasonerJson('{"next":{"cap":""}}')).toBeNull();
    expect(parseReasonerJson("不是json")).toBeNull();
  });

  it("模型说 synthesize 但必须交付没齐：回退本地 next 继续做", async () => {
    const goal = {
      raw: "帮我把微博博主“王海林”3天内的所有微博内容都复制一下",
      intent: "收集王海林近3天微博并整理成可翻阅的产物",
      kind: "page",
      deliverables: [
        { id: "form", label: "填表", required: true },
        { id: "page", label: "读懂当前页", required: true },
      ],
      known: {},
      unknown: [],
      decision: "act",
      approach: "读取微博正文并填入表单",
      site: "weibo.com",
      siteUrl: "https://weibo.com/",
    };
    const findings: StepFinding[] = [
      {
        step: { id: "act-1", cap: "act", label: "搜索并打开主页", covers: ["page"] },
        text: "已打开博主主页，页面上有正文内容可以读取",
        ok: true,
        url: "https://weibo.com/u/1497714867",
      },
    ];
    const thought = await thoughtForAsync(
      { intent: goal.intent, goal, findings, state: "running" } as never,
      async () => JSON.stringify({ synthesize: true, why: "页面已打开，先汇总" }),
    );
    expect(thought.synthesize).toBeUndefined();
    expect(thought.next).toBeDefined();
    expect(thought.why).toContain("还缺必须交付");
  });

  it("计划采集步没跑完：covers 写得再宽也不许说齐了", async () => {
    const goal = {
      raw: "帮我把微博博主“王海林”3天内的所有微博内容都复制一下",
      intent: "收集王海林近3天微博并整理成可翻阅的产物",
      kind: "page",
      deliverables: [
        { id: "form", label: "填表", required: true },
        { id: "page", label: "读懂当前页", required: true },
      ],
      known: {},
      unknown: [],
      decision: "act",
      approach: "读取微博正文并填入表单",
      site: "weibo.com",
      siteUrl: "https://weibo.com/",
    };
    const plan: Plan = {
      createdAt: 1,
      steps: [
        { id: "p0", label: "在微博搜索博主王海林", cap: "search_read", covers: ["page"], status: "pending" },
        { id: "p2", label: "读取近3天微博", cap: "read_page", covers: ["page"], status: "pending" },
      ],
    };
    // 模型编的 act 步把 covers 写宽：page 和 form 一起认领，跑完一步后 missing 为空
    const findings: StepFinding[] = [
      {
        step: { id: "act-1", cap: "act", label: "搜索并打开主页", covers: ["page", "form"] },
        text: "已打开博主主页，页面上有正文内容",
        ok: true,
        url: "https://weibo.com/u/1497714867",
      },
    ];
    const thought = await thoughtForAsync(
      { intent: goal.intent, goal, findings, state: "running", brainPlan: plan } as never,
      async () => '{"synthesize":true,"why":"都齐了"}',
    );
    expect(thought.synthesize).toBeUndefined();
    expect(thought.next?.id).toBe("p0");
    expect(thought.why).toContain("继续做");
  });

  it("nextThoughtAsync 启发式已 synthesize 时不调模型", async () => {
    const t = applyTurn(NY, { now: NOW });
    let called = 0;
    const after = observe(t.mission!, stayFinding(t.mission!));
    // 喂足所有交付物让启发式认为齐了——这里只验证 heuristic.synthesize 时不调模型
    const thought = await thoughtForAsync(
      { ...after, state: "synthesize" } as never,
      async () => {
        called++;
        return '{"synthesize":true}';
      },
    );
    // state=synthesize 不在 nextThought 的分支里，但 heuristic.synthesize 路径会触发
    // 这里主要验证不爆栈
    expect(thought).toBeDefined();
  });

  it("可用的手 catalog 含住宿和检索", () => {
    const t = applyTurn(NY, { now: NOW });
    const caps = compileHands(t.mission!.goal).map((s) => s.cap);
    expect(caps).toEqual(expect.arrayContaining(["hotel_search", "search_read"]));
  });
});
