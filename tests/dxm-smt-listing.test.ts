import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { dxmEnabled } from "../src/main/features.js";
import { WORKFLOWS } from "../src/main/workflows/dianxiaomi.js";
import {
  applyTransition,
  associateExisting,
  bindTabs,
  createWorkOrder,
  parkFailed,
  parkHuman,
  stateLabel,
} from "../src/main/workflows/dxm-smt-contract.js";
import {
  acceptBusinessValue,
  alignSkus,
  rescanRequired,
  translationRisks,
} from "../src/main/workflows/dxm-smt-fields.js";
import { fingerprintFromSnapshot } from "../src/main/workflows/dxm-smt-fingerprint.js";
import {
  decidePaidAction,
  dismissMayCancel,
  imageEvidenceStatus,
  imagesPass,
} from "../src/main/workflows/dxm-smt-images.js";
import {
  DXM_SMT_JOURNAL_FILE,
  appendJournalLine,
  journalFile,
  replayOrders,
  saveOrder,
} from "../src/main/workflows/dxm-smt-journal.js";
import { resetDxmSmtRuntime, runDxmSmtWorkflow } from "../src/main/workflows/dxm-smt-listing.js";
import {
  classifyPage,
  editTabWritable,
  entersSmtQa,
  probeFromHtml,
  resolveIdentity,
} from "../src/main/workflows/dxm-smt-page.js";
import { evaluateQa, prepareSummary, qaStillValid } from "../src/main/workflows/dxm-smt-qa.js";
import { gateDxmSmtSkill, gateFreeSoulWorkflow } from "../src/main/workflows/dxm-smt-preview.js";
import { runSkill } from "../src/main/skills/runner.js";
import type { SkillBrowser } from "../src/main/skills/runner.js";
import { basePort, editProbe, readyOrder, readySnapshot, tempDir } from "./dxm-smt-helpers.js";

const fixture = (name: string) => readFileSync(join(process.cwd(), "tests/fixtures/dxm-smt", name), "utf8");
const dirs: string[] = [];
afterEach(() => {
  resetDxmSmtRuntime();
});

function dataOf(result: { data?: unknown }): Record<string, unknown> {
  return (result.data || {}) as Record<string, unknown>;
}

describe("T1 状态机与数据合同", () => {
  it("草稿、待审、上线三种状态文案严格区分", () => {
    expect(stateLabel("saved_draft")).toContain("尚未发布");
    expect(stateLabel("submitted_pending_review")).toBe("已提交，平台处理中，尚未上线");
    expect(stateLabel("published_online")).toContain("已上线");
    expect(stateLabel("saved_draft")).not.toContain("已上线");
    expect(stateLabel("submitted_pending_review")).not.toContain("已上线");
  });

  it("无回执不能进入待审，无在线证据不能进入上线，准备完成不能直接上线", () => {
    const draft = createWorkOrder({
      state: "draft_ready",
      platformProductId: "P1",
      target: { platform: "aliexpress", shopId: "S1" },
    });
    const noReceipt = applyTransition(draft, "submitted_pending_review");
    expect(noReceipt.ok).toBe(false);
    expect(noReceipt.order.state).toBe("draft_ready");
    expect(draft.state).toBe("draft_ready");

    const pending = applyTransition(draft, "submitted_pending_review", {
      receipt: { kind: "submitted", text: "已提交", productId: "P1" },
    });
    expect(pending.ok).toBe(true);
    expect(pending.order.state).toBe("submitted_pending_review");

    const both = applyTransition(draft, "submitted_pending_review", {
      receipt: { kind: "submitted", text: "已提交", productId: "P1" },
      online: { productId: "P1", shopId: "S1", url: "https://www.aliexpress.com/item/1.html" },
    });
    expect(both.order.state).toBe("submitted_pending_review");

    const noOnline = applyTransition(pending.order, "published_online");
    expect(noOnline.ok).toBe(false);
    expect(noOnline.order.state).toBe("submitted_pending_review");

    const jump = applyTransition(draft, "published_online", {
      online: { productId: "P1", shopId: "S1", url: "https://www.aliexpress.com/item/1.html" },
    });
    expect(jump.ok).toBe(false);
    expect(jump.order.state).toBe("draft_ready");

    const observed = createWorkOrder({ state: "observed" });
    expect(applyTransition(observed, "published_online").ok).toBe(false);
    expect(applyTransition(observed, "submitted_pending_review").ok).toBe(false);
  });

  it("在线证据必须同时对上平台商品和店铺", () => {
    const pending = createWorkOrder({
      state: "submitted_pending_review",
      platformProductId: "P1",
      target: { platform: "aliexpress", shopId: "S1" },
    });
    const wrongShop = applyTransition(pending, "published_online", {
      online: { productId: "P1", shopId: "S2", url: "https://www.aliexpress.com/item/1.html" },
    });
    expect(wrongShop.ok).toBe(false);
    const urlOnly = applyTransition(pending, "published_online", {
      online: { productId: "", shopId: "S1", url: "https://www.aliexpress.com/item/999.html" },
    });
    expect(urlOnly.ok).toBe(false);
    const ok = applyTransition(pending, "published_online", {
      online: { productId: "P1", shopId: "S1", url: "https://www.aliexpress.com/item/1.html" },
    });
    expect(ok.ok).toBe(true);
    expect(ok.order.state).toBe("published_online");
    expect(ok.order.receipt?.kind).toBe("online");
  });

  it("waiting_human 和 failed 保留断点，不能当成成功终态", () => {
    const editing = createWorkOrder({
      state: "editing",
      claimedDraftId: "D1",
      source: { crawlRecordId: "R1" },
      target: { platform: "aliexpress", shopId: "S1" },
    });
    const parked = parkHuman(editing, "出现验证码", "用户处理后从原工作单续跑");
    expect(parked.state).toBe("waiting_human");
    expect(parked.checkpoint?.reliableState).toBe("editing");
    expect(parked.checkpoint?.reason).toContain("验证码");
    expect(parked.claimedDraftId).toBe("D1");
    expect(applyTransition(parked, "published_online").ok).toBe(false);
    expect(applyTransition(parked, "editing").ok).toBe(true);

    const failed = parkFailed(editing, "发布被拒", "修改资料后重新准备");
    expect(failed.state).toBe("failed");
    expect(failed.checkpoint?.reliableState).toBe("editing");
    expect(failed.claimedDraftId).toBe("D1");
    expect(stateLabel(failed.state)).not.toContain("已上线");
  });

  it("同一来源和店铺关联原单，不能只靠标题判重", () => {
    const existing = createWorkOrder({
      id: "wo-keep",
      state: "claimed",
      claimedDraftId: "D9",
      source: { crawlRecordId: "R1", titleSnapshot: "棉帽" },
      target: { platform: "aliexpress", shopId: "S1" },
    });
    expect(associateExisting([existing], "R1", "S1")?.id).toBe("wo-keep");
    expect(associateExisting([existing], undefined, "S1")).toBeNull();
    const titleOnly = createWorkOrder({
      id: "wo-title",
      source: { titleSnapshot: "棉帽" },
      target: { platform: "aliexpress", shopId: "S1" },
    });
    expect(associateExisting([titleOnly], "R1", "S1")).toBeNull();
  });
});

describe("T2 页面探针", () => {
  const pages: Array<{ file: string; url: string; kind: string }> = [
    { file: "crawl-list.html", url: "https://www.dianxiaomi.com/web/productCrawl/dataAcquisition", kind: "crawl_list" },
    { file: "crawl-edit.html", url: "https://www.dianxiaomi.com/web/productCrawl/edit?id=C1", kind: "crawl_edit" },
    { file: "smt-box.html", url: "https://www.dianxiaomi.com/web/smt/draft", kind: "smt_box" },
    { file: "smt-edit.html", url: "https://www.dianxiaomi.com/web/smt/edit?id=D1", kind: "smt_edit" },
    { file: "submit-record.html", url: "https://www.dianxiaomi.com/web/smt/publishRecord", kind: "submit_record" },
    { file: "failure-record.html", url: "https://www.dianxiaomi.com/web/smt/publishFail", kind: "failure_record" },
    { file: "online-list.html", url: "https://www.dianxiaomi.com/web/smt/online", kind: "online_list" },
  ];

  it("各类店小秘页面不会互相误判", () => {
    const kinds = pages.map((page) => classifyPage(probeFromHtml(fixture(page.file), page.url)).kind);
    expect(kinds).toEqual(pages.map((page) => page.kind));
    expect(new Set(kinds).size).toBe(kinds.length);
  });

  it("非店小秘页面不进入速卖通 QA", () => {
    const other = classifyPage(probeFromHtml(fixture("other-site.html"), "https://www.baidu.com"));
    expect(other.kind).toBe("not_dianxiaomi");
    expect(entersSmtQa(other)).toBe(false);
    const shop = classifyPage(probeFromHtml(fixture("other-site.html"), "https://www.aliexpress.com/item/1.html"));
    expect(entersSmtQa(shop)).toBe(false);
  });

  it("登录、验证码、无权限、未加载、入口变化和字段缺失彼此区分", () => {
    expect(classifyPage(probeFromHtml(fixture("login.html"), "https://www.dianxiaomi.com/login")).blocker).toBe("login");
    expect(classifyPage(probeFromHtml(fixture("captcha.html"), "https://www.dianxiaomi.com/web/home")).blocker).toBe("captcha");
    expect(classifyPage(probeFromHtml(fixture("forbidden.html"), "https://www.dianxiaomi.com/web/smt/edit?id=1")).blocker).toBe("forbidden");
    expect(classifyPage(probeFromHtml(fixture("not-loaded.html"), "https://www.dianxiaomi.com/web/smt/edit?id=1")).blocker).toBe("not_loaded");
    const changed = classifyPage(probeFromHtml("<title>改版</title><body>页面改版了</body>", "https://www.dianxiaomi.com/web/smt/unknown-entry-v9"));
    expect(changed.blocker).toBe("entry_changed");
    const missing = classifyPage(probeFromHtml(fixture("smt-edit.html"), "https://www.dianxiaomi.com/web/smt/edit?id=D1"));
    expect(missing.kind).toBe("smt_edit");
    expect(missing.blocker).toBe("fields_missing");
    expect(missing.blocker).not.toBe("login");
  });

  it("商品或店铺不唯一时停等，不默认第一条", () => {
    const list = probeFromHtml(fixture("crawl-list.html"), "https://www.dianxiaomi.com/web/productCrawl/dataAcquisition");
    const shops = resolveIdentity(list, {});
    expect(shops.ok).toBe(false);
    if (!shops.ok) expect(shops.reason).toMatch(/店铺/);
    const products = resolveIdentity(list, { shopId: "S1" });
    expect(products.ok).toBe(false);
    if (!products.ok) expect(products.reason).toMatch(/商品/);
    const one = probeFromHtml(fixture("smt-edit.html"), "https://www.dianxiaomi.com/web/smt/edit?id=D1");
    const picked = resolveIdentity(one, { shopId: "S1", sourceRecordId: "R1", useCurrentEditPage: true });
    expect(picked.ok).toBe(true);
  });

  it("探针工作流只读，不认领不发布", async () => {
    const dir = tempDir();
    dirs.push(dir);
    let claims = 0;
    const result = await runDxmSmtWorkflow({
      id: "dxm_smt_probe",
      params: {},
      port: basePort(dir, {
        readProbe: async () => probeFromHtml(fixture("smt-edit.html"), "https://www.dianxiaomi.com/web/smt/edit?id=D1"),
        claim: async () => {
          claims += 1;
          return { ok: true, draftId: "D9", message: "认领" };
        },
      }),
    });
    expect(claims).toBe(0);
    expect(result.ok).toBe(true);
    expect(dataOf(result).pageKind).toBe("smt_edit");
    expect(String(result.message)).not.toMatch(/发布完成|已上线/);
  });
});

describe("T3 日志、断点与标签", () => {
  it("重启回放后商品、店铺、草稿和状态一致，坏行不会拖垮恢复", () => {
    const dir = tempDir();
    const order = createWorkOrder({
      id: "wo-replay",
      state: "claimed",
      claimedDraftId: "D1",
      source: { crawlRecordId: "R1", productId: "R1" },
      target: { platform: "aliexpress", shopId: "S1", shopNameSnapshot: "店铺甲" },
    });
    saveOrder(dir, order);
    appendJournalLine(dir, "{这不是合法 JSON");
    appendJournalLine(dir, "{\"nope\":true}");
    const later = { ...order, state: "draft_ready" as const, claimedDraftId: "D1" };
    saveOrder(dir, later);
    const replayed = replayOrders(dir);
    expect(replayed).toHaveLength(1);
    expect(replayed[0]?.source.crawlRecordId).toBe("R1");
    expect(replayed[0]?.target.shopId).toBe("S1");
    expect(replayed[0]?.claimedDraftId).toBe("D1");
    expect(replayed[0]?.state).toBe("draft_ready");
    expect(journalFile(dir).endsWith(DXM_SMT_JOURNAL_FILE)).toBe(true);
    expect(journalFile(dir)).not.toContain("missions.jsonl");
  });

  it("日志去掉密码、Cookie 和 Token", () => {
    const dir = tempDir();
    const order = createWorkOrder({
      id: "wo-secret",
      evidence: [{ at: 1, action: "read", observed: { cookie: "secret", token: "t", title: "棉帽" } }],
    });
    saveOrder(dir, order);
    const observed = replayOrders(dir)[0]?.evidence[0]?.observed as Record<string, unknown>;
    expect(observed.cookie).toBeUndefined();
    expect(observed.token).toBeUndefined();
    expect(observed.title).toBe("棉帽");
  });

  it("已上线的关单不会被重复执行", async () => {
    const dir = tempDir();
    const done = readyOrder();
    done.state = "published_online";
    done.receipt = { kind: "online", productId: "P1", url: "https://www.aliexpress.com/item/1.html" };
    saveOrder(dir, done);
    let claims = 0;
    const result = await runDxmSmtWorkflow({
      id: "dxm_smt_prepare",
      params: { workOrderId: done.id, sourceRecordId: "R1", shopId: "S1" },
      port: basePort(dir, {
        claim: async () => {
          claims += 1;
          return { ok: true, draftId: "D2", message: "又认领" };
        },
      }),
    });
    expect(claims).toBe(0);
    expect(dataOf(result).state).toBe("published_online");
    expect(String(result.message)).toMatch(/不会重复执行/);
  });

  it("编辑标签关闭或 URL 改变时停止写操作，不刷新找回", () => {
    const order = createWorkOrder({
      state: "editing",
      claimedDraftId: "D1",
      tabs: { editTabId: "edit-1", sourceTabId: "source-1" },
    });
    const closed = editTabWritable(order, [{ id: "edit-1", url: "https://www.dianxiaomi.com/web/smt/edit?id=D1", closed: true }]);
    expect(closed.ok).toBe(false);
    if (!closed.ok) expect(closed.reason).toContain("不会刷新");
    const moved = editTabWritable(order, [{ id: "edit-1", url: "https://www.dianxiaomi.com/web/home" }]);
    expect(moved.ok).toBe(false);
    if (!moved.ok) expect(moved.reason).toContain("不会刷新");
    const kept = bindTabs(order, { sourceTabId: "source-9" });
    expect(kept.tabs.editTabId).toBe("edit-1");
    expect(kept.tabs.sourceTabId).toBe("source-9");
  });

  it("取消后不再执行后续副作用，并留下断点", async () => {
    const dir = tempDir();
    const ac = new AbortController();
    let saves = 0;
    const result = await runDxmSmtWorkflow({
      id: "dxm_smt_prepare",
      params: { sourceRecordId: "R1", shopId: "S1", shopName: "店铺甲", saveDraft: true },
      port: basePort(dir, {
        signal: ac.signal,
        readProbe: async () => ({ ...editProbe(), draftId: undefined, productIds: ["R1"], shops: [{ id: "S1", name: "店铺甲" }] }),
        lookupDraft: async () => ({ status: "absent" as const }),
        claim: async () => {
          ac.abort();
          return { ok: true, draftId: "D1", shopId: "S1", shopName: "店铺甲", message: "已认领" };
        },
        saveDraft: async () => {
          saves += 1;
          return { ok: true, message: "保存" };
        },
      }),
    });
    expect(saves).toBe(0);
    expect(dataOf(result).state).toBe("waiting_human");
    const saved = replayOrders(dir)[0];
    expect(saved?.checkpoint?.reliableState).toBeTruthy();
    expect(saved?.tabs.editTabId).not.toBe(saved?.tabs.sourceTabId);
  });
});

describe("T4 认领", () => {
  it("已有草稿时复用，不再次点击认领", async () => {
    const dir = tempDir();
    const existing = createWorkOrder({
      id: "wo-keep",
      state: "claimed",
      claimedDraftId: "D1",
      source: { crawlRecordId: "R1" },
      target: { platform: "aliexpress", shopId: "S1", shopNameSnapshot: "店铺甲" },
      tabs: { editTabId: "edit-1" },
    });
    saveOrder(dir, existing);
    let claims = 0;
    const result = await runDxmSmtWorkflow({
      id: "dxm_smt_prepare",
      params: { sourceRecordId: "R1", shopId: "S1" },
      port: basePort(dir, {
        claim: async () => {
          claims += 1;
          return { ok: true, draftId: "D2", message: "重复认领" };
        },
      }),
    });
    expect(claims).toBe(0);
    expect(dataOf(result).workOrderId).toBe("wo-keep");
  });

  it("认领成功但读回不到草稿时不得进入编辑完成", async () => {
    const dir = tempDir();
    const result = await runDxmSmtWorkflow({
      id: "dxm_smt_prepare",
      params: { sourceRecordId: "R1", shopId: "S1", shopName: "店铺甲", claimConsent: "认领" },
      port: basePort(dir, {
        readProbe: async () => ({
          ...editProbe(),
          url: "https://www.dianxiaomi.com/web/productCrawl/dataAcquisition",
          draftId: undefined,
          productIds: ["R1"],
          shops: [{ id: "S1", name: "店铺甲" }],
        }),
        lookupDraft: async () => ({ status: "absent" as const }),
        claim: async () => ({ ok: true, message: "按钮已点" }),
      }),
    });
    expect(["editing", "draft_ready", "saved_draft", "published_online"]).not.toContain(dataOf(result).state);
    expect(String(result.message)).toMatch(/读回不到草稿/);
  });

  it("授权失效、入口变化和超时都停等", async () => {
    for (const blocker of ["auth", "entry", "timeout"] as const) {
      const dir = tempDir();
      let writes = 0;
      const result = await runDxmSmtWorkflow({
        id: "dxm_smt_prepare",
        params: { sourceRecordId: "R1", shopId: "S1", shopName: "店铺甲" },
        port: basePort(dir, {
          readProbe: async () => ({
            ...editProbe(),
            url: "https://www.dianxiaomi.com/web/productCrawl/dataAcquisition",
            draftId: undefined,
          }),
          lookupDraft: async () => ({ status: "absent" as const }),
          claim: async () => ({ ok: false, message: blocker, blocker }),
          writeField: async () => {
            writes += 1;
            return { ok: true, readback: "x" };
          },
        }),
      });
      expect(dataOf(result).state).toBe("waiting_human");
      expect(writes).toBe(0);
    }
  });
});

describe("T5 动态字段", () => {
  it("分类变化后新的星号项进入缺项", () => {
    const before = [{ key: "title", group: "基本信息", required: true, value: "Hat", verified: true, provenance: "source" as const }];
    const after = [
      ...before,
      { key: "材质", group: "属性", required: true, value: "", verified: false },
    ];
    expect(rescanRequired(before).map((item) => item.field)).not.toContain("材质");
    expect(rescanRequired(after).map((item) => item.field)).toContain("材质");
  });

  it("SKU 按规格对齐，不串价格和库存", () => {
    const rows = [
      { specs: { 颜色: "红", 尺码: "M" }, price: "10", stock: "3" },
      { specs: { 颜色: "蓝", 尺码: "L" }, price: "12", stock: "4" },
    ];
    const aligned = alignSkus([...rows].reverse());
    expect(aligned.ok).toBe(true);
    if (aligned.ok) {
      const red = aligned.rows.find((row) => row.specs.颜色 === "红");
      expect(red?.price).toBe("10");
      expect(red?.stock).toBe("3");
    }
    expect(alignSkus([...rows, rows[0]!]).ok).toBe(false);
  });

  it("无来源的业务值和无品牌猜测不能通过", () => {
    expect(acceptBusinessValue({ key: "brand", value: "无品牌", provenance: "suggestion" }).accepted).toBe(false);
    expect(acceptBusinessValue({ key: "price", value: "9.9", provenance: "suggestion" }).accepted).toBe(false);
    expect(acceptBusinessValue({ key: "brand", value: "Nike", provenance: "source" }).accepted).toBe(true);
    expect(acceptBusinessValue({ key: "freightTemplate", value: "", provenance: "user" }).accepted).toBe(false);
  });

  it("合法英文品牌和受保护专名不会被语言启发式改写", () => {
    const brand = translationRisks("Nike Air Max", ["Nike"]);
    expect(brand.risks).toEqual([]);
    expect(brand.text).toBe("Nike Air Max");
    const name = translationRisks("李宁跑鞋", ["李宁"]);
    expect(name.text).toBe("李宁跑鞋");
    expect(name.risks.join("")).not.toContain("李宁");
    expect(name.risks.length).toBeGreaterThan(0);
    const residue = translationRisks("红色外套", ["Nike"]);
    expect(residue.risks.length).toBeGreaterThan(0);
    expect(residue.text).toBe("红色外套");
  });

  it("改值未读回不算成功", async () => {
    const dir = tempDir();
    const result = await runDxmSmtWorkflow({
      id: "dxm_smt_prepare",
      params: {
        sourceRecordId: "R1",
        shopId: "S1",
        writes: [{ key: "title", value: "Cotton Hat", provenance: "user" }],
      },
      port: basePort(dir, {
        writeField: async () => ({ ok: true, readback: "没写上" }),
      }),
    });
    const qa = dataOf(result).qa as { result?: string } | undefined;
    expect(qa?.result).toBe("pass");
    const saved = replayOrders(dir)[0];
    const write = saved?.evidence.find((item) => item.action === "write_field");
    expect(write?.verified).toBe(false);
    expect(saved?.fields.title?.verified).toBe(true);
    expect(saved?.fields.title?.value).toBe("Cotton Hat");
  });
});

describe("T6 图片与文字", () => {
  it("主图成功但变种图失败时，图片项整体不通过", () => {
    expect(imagesPass({
      main: [{ src: "m.jpg", status: "verified" }],
      variant: [{ src: "v.jpg", status: "failed" }],
      description: [{ src: "d.jpg", status: "verified" }],
    })).toBe(false);
  });

  it("文字翻译不能抵图片翻译，未读回只记已发起", () => {
    const qa = evaluateQa({
      identityOk: true,
      textTranslated: true,
      fields: [{ key: "title", group: "基本信息", required: true, value: "Hat", verified: true, provenance: "readback" }],
      images: {
        main: [{ src: "m.jpg", status: "failed" }],
        variant: [],
        description: [],
      },
      missing: [],
    });
    expect(qa.result).not.toBe("pass");
    expect(imageEvidenceStatus(false)).toBe("started");
    expect(imageEvidenceStatus(true)).toBe("verified");
  });

  it("付费未确认或被拒绝时不执行收费动作", async () => {
    expect(decidePaidAction({ feature: "图片翻译" }).execute).toBe(false);
    expect(decidePaidAction({ feature: "图片翻译", text: "不要" }).execute).toBe(false);
    expect(decidePaidAction({ feature: "图片白底", text: "同意这次图片白底" }).execute).toBe(false);
    const dir = tempDir();
    let paid = 0;
    const refused = await runDxmSmtWorkflow({
      id: "dxm_smt_prepare",
      params: {
        sourceRecordId: "R1",
        shopId: "S1",
        paidConsent: { feature: "图片翻译", scope: "主图", text: "不要扣费" },
      },
      port: basePort(dir, {
        translateImages: async () => {
          paid += 1;
          return { ok: true, verified: true };
        },
      }),
    });
    expect(paid).toBe(0);
    expect(String(refused.message)).toMatch(/拒绝|未完成/);
    const agreedDir = tempDir();
    let agreed = 0;
    await runDxmSmtWorkflow({
      id: "dxm_smt_prepare",
      params: {
        sourceRecordId: "R1",
        shopId: "S1",
        paidConsent: { feature: "图片翻译", scope: "主图", text: "同意翻译主图" },
      },
      port: basePort(agreedDir, {
        translateImages: async () => {
          agreed += 1;
          return { ok: true, verified: false };
        },
      }),
    });
    expect(agreed).toBe(0);
  });

  it("图片处理中不点取消", () => {
    expect(dismissMayCancel(true)).toBe(false);
    expect(dismissMayCancel(false)).toBe(true);
  });
});

describe("T7 发布前 QA 与指纹", () => {
  it("缺星号、未读回或人工待办时 QA 不通过，通过也不等于上线", () => {
    const snapshot = readySnapshot();
    const missing = evaluateQa({
      identityOk: true,
      fields: snapshot.fields.map((field) => field.key === "brand" ? { ...field, value: "", verified: false } : field),
      images: snapshot.images,
      missing: [{ field: "brand", reason: "无品牌资质", action: "请到资质中心处理，不会填写无品牌" }],
    });
    expect(missing.result).not.toBe("pass");
    expect(["pass", "waiting_human", "fail"]).toContain(missing.result);
    const unverified = evaluateQa({
      identityOk: true,
      fields: snapshot.fields.map((field) => field.key === "title" ? { ...field, verified: false } : field),
      images: snapshot.images,
      missing: [],
    });
    expect(unverified.result).not.toBe("pass");
    const passed = evaluateQa({ identityOk: true, fields: snapshot.fields, images: snapshot.images, missing: [] });
    expect(passed.result).toBe("pass");
    expect(passed.result).not.toBe("published_online");
  });

  it("价格、店铺、SKU 或模板变化后指纹变化，旧 QA 失效", () => {
    const snapshot = readySnapshot();
    const base = {
      shopId: "S1",
      shopName: "店铺甲",
      title: snapshot.title,
      categoryId: snapshot.categoryId,
      draftId: "D1",
      recordId: "R1",
      pageUrl: "https://www.dianxiaomi.com/web/smt/edit?id=D1",
      snapshot,
    };
    const first = fingerprintFromSnapshot(base);
    expect(fingerprintFromSnapshot(base)).toBe(first);
    const spaced = fingerprintFromSnapshot({ ...base, title: "Cotton   Hat" });
    expect(spaced).toBe(fingerprintFromSnapshot({ ...base, title: "Cotton Hat" }));
    const price = structuredClone(snapshot);
    price.skus = [{ specs: { 颜色: "红" }, price: "10.00", stock: "5" }];
    expect(fingerprintFromSnapshot({ ...base, snapshot: price })).toBe(first);
    price.skus = [{ specs: { 颜色: "红" }, price: "11", stock: "5" }];
    const nextPrice = fingerprintFromSnapshot({ ...base, snapshot: price });
    expect(nextPrice).not.toBe(first);
    expect(fingerprintFromSnapshot({ ...base, shopId: "S2" })).not.toBe(first);
    const reordered = structuredClone(snapshot);
    reordered.images = {
      main: [{ src: "m1.jpg", status: "verified" }],
      variant: [{ src: "v1.jpg", status: "verified" }],
      description: [{ src: "d1.jpg", status: "verified" }],
    };
    expect(fingerprintFromSnapshot({ ...base, snapshot: reordered })).toBe(first);
    const template = structuredClone(snapshot);
    template.freightTemplate = "另一模板";
    expect(fingerprintFromSnapshot({ ...base, snapshot: template })).not.toBe(first);
    const order = readyOrder(snapshot);
    expect(qaStillValid(order, first)).toBe(true);
    expect(qaStillValid(order, nextPrice)).toBe(false);
  });

  it("准备结果不含发布完成或已上线，且不会调用发布", async () => {
    const dir = tempDir();
    let publishes = 0;
    const snapshot = readySnapshot();
    const result = await runDxmSmtWorkflow({
      id: "dxm_smt_prepare",
      params: { sourceRecordId: "R1", shopId: "S1", shopName: "店铺甲", saveDraft: true },
      port: basePort(dir, {
        readFields: async () => snapshot,
        clickPublish: async () => {
          publishes += 1;
          return { ok: true, message: "发布", receipt: { kind: "submitted", text: "已提交" } };
        },
      }),
    });
    expect(publishes).toBe(0);
    expect(result.ok).toBe(true);
    expect(String(result.message)).toMatch(/店铺/);
    expect(String(result.message)).toMatch(/标题/);
    expect(String(result.message)).not.toMatch(/发布完成|已上线/);
    expect(["draft_ready", "saved_draft"]).toContain(dataOf(result).state);
    expect(prepareSummary({
      shop: "店铺甲",
      title: "Cotton Hat",
      category: "cat-hat",
      priceRange: "10",
      stockTotal: "5",
      images: "已验证",
      translation: "未发起",
      risks: "无",
    })).not.toMatch(/发布完成|已上线/);
  });

  it("无运费模板或无资质时给出处理说明，QA 不通过", async () => {
    const dir = tempDir();
    const snapshot = readySnapshot();
    snapshot.freightTemplate = undefined;
    snapshot.brand = undefined;
    snapshot.fields = snapshot.fields.map((field) =>
      field.key === "freightTemplate" || field.key === "brand" ? { ...field, value: "", verified: false } : field,
    );
    const result = await runDxmSmtWorkflow({
      id: "dxm_smt_prepare",
      params: { sourceRecordId: "R1", shopId: "S1" },
      port: basePort(dir, { readFields: async () => snapshot }),
    });
    expect(dataOf(result).state).not.toBe("published_online");
    const qa = dataOf(result).qa as { result?: string };
    expect(qa.result).not.toBe("pass");
    expect(String(result.message)).toMatch(/运费模板/);
    expect(String(result.message)).not.toMatch(/自动创建|无品牌/);
  });
});

describe("T9 接线与预览开关", () => {
  it("决策点 35 到 39 已登记", () => {
    const doc = readFileSync(join(process.cwd(), "docs/DECISION-POINTS.md"), "utf8");
    for (const id of ["35", "36", "37", "38", "39", "40", "41"]) {
      expect(doc).toContain(`| ${id} |`);
    }
  });

  it("新工作流不进入旧清单，旧开关保持关闭", () => {
    expect(dxmEnabled()).toBe(false);
    const ids = WORKFLOWS.map((item) => item.id);
    expect(ids).not.toContain("dxm_smt_probe");
    expect(ids).not.toContain("dxm_smt_prepare");
    expect(ids).not.toContain("dxm_smt_status");
    expect(ids).not.toContain("dxm_smt_publish");
    const listing = readFileSync(join(process.cwd(), "src/main/workflows/dxm-smt-listing.ts"), "utf8");
    expect(listing).not.toContain("runFullListing");
    expect(listing).not.toContain("dxmEnabled");
  });

  it("Free Soul 通道只放行四个新 ID，关闭预览时不执行", () => {
    expect(gateFreeSoulWorkflow("dxm_full_listing", {}).action).toBe("reject");
    expect(gateFreeSoulWorkflow("dxm_smt_probe", {}).action).toBe("closed");
    expect(gateFreeSoulWorkflow("dxm_smt_probe", {}).message).toBe("该能力尚未开放");
    expect(gateFreeSoulWorkflow("dxm_smt_publish", { SPARO_DXM_SMT_PREVIEW: "1" }).action).toBe("run");
    expect(gateDxmSmtSkill("dxm-crawl-prep", {})).toBeNull();
    expect(gateDxmSmtSkill("dxm-smt-listing", {})?.message).toBe("该能力尚未开放");
    expect(gateDxmSmtSkill("dxm-smt-listing", { SPARO_DXM_SMT_PREVIEW: "1" })).toBeNull();
  });

  it("关闭预览时 run_skill 不返回可执行路线", async () => {
    const dir = tempDir();
    const { mkdirSync, writeFileSync } = await import("node:fs");
    mkdirSync(join(dir, "skills"), { recursive: true });
    writeFileSync(
      join(dir, "skills", "dxm-smt-listing.json"),
      JSON.stringify({
        id: "dxm-smt-listing",
        title: "店小秘到速卖通发布",
        intent: "认领并发布",
        source: "seeded",
        createdAt: "2026-11-07T00:00:00.000Z",
        updatedAt: "2026-11-07T00:00:00.000Z",
        steps: [],
        stepCount: 0,
        stats: { success: 0, fail: 0 },
        enabled: true,
        distilled: true,
        route: [{ kind: "open", goal: "SECRET_ROUTE_SHOULD_NOT_LEAK run_workflow dxm_smt_publish" }],
      }),
    );
    const previous = process.env.SPARO_DXM_SMT_PREVIEW;
    delete process.env.SPARO_DXM_SMT_PREVIEW;
    try {
      const result = await runSkill({} as SkillBrowser, dir, { id: "dxm-smt-listing" });
      expect(result.message).toBe("该能力尚未开放");
      expect(JSON.stringify(result)).not.toContain("SECRET_ROUTE_SHOULD_NOT_LEAK");
    } finally {
      if (previous === undefined) delete process.env.SPARO_DXM_SMT_PREVIEW;
      else process.env.SPARO_DXM_SMT_PREVIEW = previous;
    }
  });

  it("技能只引导四个白名单工作流，旧采集箱合同仍禁止保存并认领", () => {
    const skill = JSON.parse(readFileSync(join(process.cwd(), "strategies/skills/dxm-smt-listing.json"), "utf8")) as {
      id: string;
      declared_domains: string[];
      declared_actions: string[];
      human_gates: string[];
      knownGaps: string[];
      route: Array<{ kind: string; goal?: string; tool?: string }>;
    };
    expect(skill.id).toBe("dxm-smt-listing");
    expect(skill.declared_domains).toContain("www.dianxiaomi.com");
    expect(skill.declared_actions).toEqual(["run_workflow"]);
    expect(skill.human_gates).toEqual(expect.arrayContaining(["login", "captcha", "pay", "publish"]));
    expect(skill.knownGaps.length).toBeGreaterThan(0);
    const goals = skill.route.map((step) => step.goal || step.tool || "").join("\n");
    for (const id of ["dxm_smt_probe", "dxm_smt_prepare", "dxm_smt_status", "dxm_smt_publish"]) {
      expect(goals).toContain(id);
    }
    expect(goals).toContain("request_confirm");
    expect(skill.route.every((step) => step.kind === "open")).toBe(true);
    const oldSkill = JSON.parse(readFileSync(join(process.cwd(), "strategies/skills/dxm-crawl-prep.json"), "utf8")) as {
      contract: { doNotClick: string[] };
    };
    expect(oldSkill.contract.doNotClick).toContain("保存并认领");
    const browser = readFileSync(join(process.cwd(), "src/main/browser.ts"), "utf8");
    const coreStart = browser.indexOf("private async runCoreTool");
    const coreEnd = browser.indexOf("private saveSkillTool");
    const core = browser.slice(coreStart, coreEnd);
    expect(core).toContain("gateFreeSoulWorkflow");
    expect(core).toContain("runDxmSmtWorkflow");
    expect(core).not.toContain("runWorkflow");
    const soul = readFileSync(join(process.cwd(), "src/main/agent/free-soul.ts"), "utf8");
    expect(soul).toContain('"run_workflow"');
    const runner = readFileSync(join(process.cwd(), "src/main/skills/runner.ts"), "utf8");
    expect(runner).toContain("gateDxmSmtSkill");
    const qa = readFileSync(join(process.cwd(), "docs/QA-GOLDEN-SCENARIOS.md"), "utf8");
    for (const id of ["E1", "E2", "E3", "E4", "E5", "E6", "E7", "E8", "E9", "E10", "E11", "E12"]) {
      expect(qa).toContain(`## ${id}`);
    }
    expect(qa).toContain("未跑");
  });
});
