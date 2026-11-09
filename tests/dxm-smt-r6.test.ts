import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { dxmEnabled } from "../src/main/features.js";
import { WORKFLOWS } from "../src/main/workflows/dianxiaomi.js";
import { replayOrders } from "../src/main/workflows/dxm-smt-journal.js";
import { runDxmSmtWorkflow } from "../src/main/workflows/dxm-smt-listing.js";
import { createLiveDxmSmtPort } from "../src/main/workflows/dxm-smt-live.js";
import { probeFromHtml } from "../src/main/workflows/dxm-smt-page.js";
import { gateFreeSoulWorkflow } from "../src/main/workflows/dxm-smt-preview.js";
import { loadShopBaseline, parseShopTable, saveShopBaseline } from "../src/main/workflows/dxm-smt-shops.js";
import { basePort, tempDir } from "./dxm-smt-helpers.js";

const fixturePath = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "dxm-auth-shops.html");
const html = readFileSync(fixturePath, "utf8");
const crawlUrl = "https://www.dianxiaomi.com/web/productCrawl/edit?id=sample-record";
const authUrl = "https://www.dianxiaomi.com/web/system/authorization/platform";
const pending = "页面读不到店铺，店铺基线未就绪（先跑 dxm_smt_shops）";

function crawlProbe() {
  return probeFromHtml("<html><head><title>采集编辑</title></head><body>变种信息</body></html>", crawlUrl);
}

function threeShops() {
  return [
    { shopId: "9001", name: "示例店铺A", aliId: "cn100000000demoa", currency: "CNY", semiAuth: "已授权半托管", authTime: "2026-01-02 03:04:05" },
    { shopId: "9002", name: "示例店铺B", aliId: "cn100000000demob", currency: "CNY", semiAuth: "未授权", authTime: "2026-02-03 04:05:06" },
    { shopId: "9003", name: "示例店铺C", aliId: "cn100000000democ", currency: "USD", semiAuth: "已授权半托管", authTime: "2026-03-04 05:06:07" },
  ];
}

describe("R6 店铺来源基线", () => {
  it("授权页解析出 3 家编造店铺，空编号和非 cn 编号记入坏行", () => {
    expect(html).not.toMatch(/PetLifeGlobal|Charmify|zuhae|sibae|nicae/);
    const parsed = parseShopTable(html);
    expect(parsed.shops.map((shop) => shop.name)).toEqual(["示例店铺A", "示例店铺B", "示例店铺C"]);
    expect(parsed.shops[0]).toMatchObject({
      shopId: "9001",
      aliId: "cn100000000demoa",
      currency: "CNY",
      semiAuth: "已授权半托管",
      authTime: "2026-01-02 03:04:05",
    });
    expect(parsed.badRows).toBe(2);
    expect(parsed.reason).toBeUndefined();
  });

  it("表格没出来或一行都没有时返回空列表和原因", () => {
    const missing = parseShopTable("<html><body><p>加载中</p></body></html>");
    expect(missing.shops).toEqual([]);
    expect(missing.reason).toBe("授权页未加载出店铺表格");
    const empty = parseShopTable('<table class="vxe-table--body"><tbody></tbody></table>');
    expect(empty.shops).toEqual([]);
    expect(empty.reason).toBe("已授权店铺为 0");
  });

  it("刷新店铺基线会把列表和读取时间写进缓存", async () => {
    const dir = tempDir();
    expect(dxmEnabled()).toBe(false);
    expect(WORKFLOWS.map((item) => item.id)).not.toContain("dxm_smt_shops");
    expect(gateFreeSoulWorkflow("dxm_smt_shops", { SPARO_DXM_SMT_PREVIEW: "1" }).action).toBe("run");
    const result = await runDxmSmtWorkflow({
      id: "dxm_smt_shops",
      port: basePort(dir, { readShops: async () => ({ shops: threeShops(), badRows: 2 }) }),
    });
    const saved = loadShopBaseline(dir);
    expect(saved?.shops).toHaveLength(3);
    expect(Number.isNaN(Date.parse(saved?.fetchedAt || ""))).toBe(false);
    expect(result.ok).toBe(true);
    expect(String(result.message)).toContain("示例店铺A");
    const again = saveShopBaseline(dir, threeShops().slice(0, 1), new Date("2026-11-08T12:00:00.000Z"));
    expect(loadShopBaseline(dir)?.fetchedAt).toBe(again.fetchedAt);
  });

  it("编辑页没有缓存时，停等是一句人话", async () => {
    const dir = tempDir();
    const result = await runDxmSmtWorkflow({
      id: "dxm_smt_probe",
      port: basePort(dir, { readProbe: async () => crawlProbe() }),
    });
    expect(result.message).toBe(pending);
    expect(result.data).toMatchObject({ state: "waiting_human", pageKind: "crawl_edit" });
  });

  it("缓存有 3 家店且没有指定店名时，停等并列出店名，不建单", async () => {
    const dir = tempDir();
    saveShopBaseline(dir, threeShops());
    const result = await runDxmSmtWorkflow({
      id: "dxm_smt_prepare",
      port: basePort(dir, { readProbe: async () => crawlProbe() }),
    });
    expect(String(result.message)).toContain("请指定目标店铺");
    expect(String(result.message)).toContain("示例店铺A");
    expect(String(result.message)).toContain("示例店铺B");
    expect(String(result.message)).toContain("示例店铺C");
    expect(replayOrders(dir)).toHaveLength(0);
  });

  it("指定店名后身份完整并建单，认领和发布仍然停等", async () => {
    const dir = tempDir();
    saveShopBaseline(dir, threeShops());
    let claims = 0;
    let writes = 0;
    let publishes = 0;
    const result = await runDxmSmtWorkflow({
      id: "dxm_smt_prepare",
      params: { shopName: "示例店铺A", claimConsent: "认领" },
      port: basePort(dir, {
        readProbe: async () => crawlProbe(),
        lookupDraft: async () => ({ status: "absent" }),
        claim: async () => {
          claims += 1;
          return { ok: false, message: "认领入口没有已核对标记，已停等", blocker: "entry" };
        },
        writeField: async () => {
          writes += 1;
          return { ok: false, readback: "" };
        },
        clickPublish: async () => {
          publishes += 1;
          return { ok: false, message: "不会点击" };
        },
      }),
    });
    const orders = replayOrders(dir);
    expect(orders).toHaveLength(1);
    expect(orders[0]?.target.shopId).toBe("9001");
    expect(orders[0]?.target.shopNameSnapshot).toBe("示例店铺A");
    expect(orders[0]?.source.crawlRecordId).toBe("sample-record");
    expect(orders[0]?.claimedDraftId).toBeUndefined();
    expect(claims).toBe(1);
    expect(writes).toBe(0);
    expect(publishes).toBe(0);
    expect(String(result.message)).toMatch(/停等/);
  });

  it("当前标签是采集编辑页时，读店铺另开标签，不导航编辑页", async () => {
    const dir = tempDir();
    const navigated: string[] = [];
    const executed: string[] = [];
    const closed: string[] = [];
    const port = createLiveDxmSmtPort({
      tabId: "edit",
      isPaused: () => false,
      journalDir: dir,
      getUrl: (tabId) => (tabId === "shops-tab" ? authUrl : crawlUrl),
      listTabs: () => [],
      execute: async (_script, tabId) => {
        executed.push(tabId || "");
        return {
          ok: true,
          data: {
            result: {
              tableFound: true,
              rows: [{
                rowid: "9001",
                name: "示例店铺A",
                aliId: "cn100000000demoa",
                third: "店铺币种: CNY 半/全托管： 已授权半托管",
                authTime: "2026-01-02 03:04:05",
              }],
            },
          },
        };
      },
      navigate: async (url, tabId) => {
        navigated.push(`${tabId} ${url}`);
        return { ok: true };
      },
      openTab: async (url) => {
        expect(url).toBe(authUrl);
        return "shops-tab";
      },
      closeTab: async (tabId) => {
        closed.push(tabId);
      },
    });
    const read = await port.readShops?.();
    expect(navigated).toEqual([]);
    expect(executed).toEqual(["shops-tab"]);
    expect(closed).toEqual(["shops-tab"]);
    expect(read?.shops[0]?.name).toBe("示例店铺A");
    expect(read?.badRows).toBe(0);
  });

  it("非店小秘页面的探针先说明页面不对", async () => {
    const dir = tempDir();
    const result = await runDxmSmtWorkflow({
      id: "dxm_smt_probe",
      port: basePort(dir, {
        readProbe: async () => probeFromHtml("<html><head><title>外站</title></head><body>hello</body></html>", "https://www.baidu.com/"),
      }),
    });
    expect(result.message).toBe("不是店小秘页面，不进入速卖通 QA");
  });

  it("认领、保存、发布仍然拒绝", async () => {
    const port = createLiveDxmSmtPort({
      tabId: "edit",
      isPaused: () => false,
      journalDir: tempDir(),
      getUrl: () => crawlUrl,
      listTabs: () => [],
      execute: async () => ({ ok: true, data: { result: {} } }),
    });
    const claim = await port.claim({ tabId: "edit", recordId: "sample-record", shopId: "9001" });
    const save = await port.saveDraft("edit");
    const publish = await port.clickPublish("edit");
    expect(claim.ok).toBe(false);
    expect(save.ok).toBe(false);
    expect(publish.ok).toBe(false);
    expect(publish.message).toMatch(/停等|不会点击/);
  });
});
