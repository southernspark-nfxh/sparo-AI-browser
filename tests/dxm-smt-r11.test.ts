import { describe, expect, it, vi } from "vitest";
import { decideBoxLookup } from "../src/main/workflows/dxm-smt-box.js";
import {
  BOX_API_BUDGET_MS,
  BOX_API_ENDPOINT,
  BOX_API_PAGE_SIZE,
  boxApiFilterProven,
  boxApiPageCount,
  boxApiScript,
  boxApiVerdict,
  collectBoxApiVerdict,
  parseBoxApiPage,
  type BoxApiQuery,
} from "../src/main/workflows/dxm-smt-api.js";

const secret = /PetLifeGlobal|Charmify|zuhae|sibae|nicae|挂腰风扇|167842582613033710|7107102/;
const wanted = "示例夹子风扇草稿";

function envelope(json: unknown, status = 200, ok = status === 200) {
  return { status, ok, json };
}

function rows(count: number, start = 0) {
  return Array.from({ length: count }, (_, index) => ({
    title: `示例草稿${start + index + 1}`,
    productId: String(3_000_000 + start + index),
  }));
}

function pageBody(total: number, page: number, pageSize: number, echoTitle = "") {
  const start = (page - 1) * pageSize;
  const count = Math.min(pageSize, Math.max(0, total - start));
  return { total, list: rows(count, start), echoTitle };
}

describe("R11 Part A 采集箱接口契约", () => {
  it("解析正常页、空列表和未翻完的页，坏结构不抛", () => {
    const normal = parseBoxApiPage(envelope({
      total: 2,
      list: [
        { title: wanted, productId: "3000001" },
        { title: "示例另一草稿", productId: "3000002" },
      ],
      echoTitle: wanted,
    }));
    expect(normal.shapeOk).toBe(true);
    expect(normal.httpOk).toBe(true);
    expect(normal.total).toBe(2);
    expect(normal.rows.map((row) => row.title)).toEqual([wanted, "示例另一草稿"]);
    expect(JSON.stringify(normal)).not.toMatch(secret);

    const empty = parseBoxApiPage(envelope({ total: 0, list: [], echoTitle: "" }));
    expect(empty).toMatchObject({ total: 0, rows: [], httpOk: true, shapeOk: true });

    const partial = parseBoxApiPage(envelope({ total: 250, list: rows(100), echoTitle: "" }));
    expect(partial.shapeOk).toBe(true);
    expect(partial.rows).toHaveLength(100);
    expect(partial.total).toBeGreaterThan(partial.rows.length);

    expect(parseBoxApiPage(envelope({ total: 1, list: [{ productId: "3000001" }] })).shapeOk).toBe(false);
    expect(parseBoxApiPage(envelope({ total: 1, list: { title: wanted } })).shapeOk).toBe(false);
    expect(parseBoxApiPage(null).shapeOk).toBe(false);
    expect(parseBoxApiPage(envelope(null)).shapeOk).toBe(false);
    expect(parseBoxApiPage(envelope({ total: "250", list: [] })).shapeOk).toBe(false);
    expect(parseBoxApiPage(envelope({ total: 1, rows: [{ title: wanted }] })).shapeOk).toBe(false);
  });

  it("非 200、结构不对、只读了 100/250 都不判 absent", () => {
    const denied = boxApiVerdict([parseBoxApiPage(envelope({ total: 0, list: [] }, 404, false))], { title: wanted });
    const broken = boxApiVerdict([parseBoxApiPage(envelope({ total: 1, list: "不是数组" }))], { title: wanted });
    const short = boxApiVerdict([parseBoxApiPage(envelope(pageBody(250, 1, 100, wanted)))], { title: wanted });
    for (const result of [denied, broken, short]) {
      expect(result.status).toBe("unknown");
      expect(result.status).not.toBe("absent");
      expect(result.reason ?? "").not.toMatch(/absent|没有草稿/);
    }
    expect(short.reason).toContain("没有翻完");
  });

  it("total 250 每页 100 要请求 3 页，少一页就停 unknown", async () => {
    expect(BOX_API_PAGE_SIZE).toBe(100);
    expect(BOX_API_BUDGET_MS).toBe(20_000);
    expect(boxApiPageCount(250, 100)).toBe(3);
    const seen: number[] = [];
    const full = await collectBoxApiVerdict({ title: wanted, pageSize: 100 }, async (query) => {
      seen.push(query.page || 0);
      return envelope(pageBody(250, query.page || 1, 100, wanted));
    });
    expect(seen).toEqual([1, 2, 3]);
    expect(full.status).toBe("absent");

    const stopped: number[] = [];
    const missing = await collectBoxApiVerdict({ title: wanted, pageSize: 100 }, async (query) => {
      stopped.push(query.page || 0);
      if (query.page === 3) return envelope(null, 500, false);
      return envelope(pageBody(250, query.page || 1, 100, wanted));
    });
    expect(stopped).toEqual([1, 2, 3]);
    expect(missing.status).toBe("unknown");
    expect(missing.reason ?? "").not.toMatch(/absent|没有草稿/);
  });

  it("没有回显且 total 等于全量时不直接 absent，改读全量", async () => {
    const filtered = parseBoxApiPage(envelope({ total: 250, list: rows(250), echoTitle: "" }));
    expect(boxApiFilterProven(filtered, wanted, 250)).toBe(false);
    const direct = boxApiVerdict([filtered], { title: wanted }, { catalogTotal: 250 });
    expect(direct.status).toBe("unknown");
    expect(direct.reason).toContain("没有回显");

    const calls: Array<{ title: string; page: number }> = [];
    const result = await collectBoxApiVerdict({ title: wanted, pageSize: 100 }, async (query) => {
      calls.push({ title: query.title || "", page: query.page || 0 });
      if (query.title) return envelope(pageBody(250, 1, 100, ""));
      return envelope(pageBody(250, query.page || 1, 100, ""));
    });
    expect(calls).toEqual([
      { title: wanted, page: 1 },
      { title: "", page: 1 },
      { title: "", page: 2 },
      { title: "", page: 3 },
    ]);
    expect(result).toEqual(decideBoxLookup({
      loaded: true,
      rows: [...rows(100, 0), ...rows(100, 100), ...rows(50, 200)],
      title: wanted,
    }));
    expect(result.status).toBe("absent");
  });

  it("空箱 200 且结构正确时判 absent", () => {
    const page = parseBoxApiPage(envelope({ total: 0, list: [], echoTitle: "" }));
    expect(boxApiVerdict([page], {}).status).toBe("absent");
    const echoed = parseBoxApiPage(envelope({ total: 0, list: [], echoTitle: wanted }));
    expect(boxApiVerdict([echoed], { title: wanted }).status).toBe("absent");
    const unproven = parseBoxApiPage(envelope({ total: 0, list: [], echoTitle: "" }));
    expect(boxApiVerdict([unproven], { title: wanted }).status).toBe("unknown");
  });

  it("近似标题按 decideBoxLookup 精确比对，不放宽", () => {
    const near = [
      { title: "示例夹子风扇  草稿", productId: "3000001" },
      { title: "示例夹子风扇草稿（备注）", productId: "3000002" },
      { title: "示例DraftA", productId: "3000003" },
    ];
    const missed = parseBoxApiPage(envelope({ total: near.length, list: near, echoTitle: wanted }));
    const miss = boxApiVerdict([missed], { title: wanted });
    expect(miss).toEqual(decideBoxLookup({ loaded: true, rows: near, title: wanted }));
    expect(miss.status).toBe("absent");

    const hitRows = [...near, { title: wanted, productId: "3000004" }];
    const hit = boxApiVerdict(
      [parseBoxApiPage(envelope({ total: hitRows.length, list: hitRows, echoTitle: wanted }))],
      { title: wanted },
    );
    expect(hit).toEqual(decideBoxLookup({ loaded: true, rows: hitRows, title: wanted }));
    expect(hit.status).toBe("ambiguous");
    expect(hit.status).not.toBe("found");
    expect(hit.reason).toContain("标题精确匹配 1 条");
    expect(JSON.stringify(near)).not.toMatch(secret);
  });

  it("页面脚本只交 status、ok、json，端点未采样时不发请求", () => {
    const query: BoxApiQuery = { title: wanted, shopId: "9001", page: 2, draftsOnly: true };
    const script = boxApiScript(query);
    expect(BOX_API_ENDPOINT).toBe("");
    expect(script).toContain("fetch");
    expect(script).toContain("status");
    expect(script).toContain("ok");
    expect(script).toContain("json");
    expect(script).not.toMatch(/absent|ambiguous|dianxiaomi|smtProductList|searchParams/);
    expect(script).not.toMatch(secret);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const value = new Function(`return ${script}`)() as { status: number; ok: boolean; json: unknown };
    expect(value).toEqual({ status: 0, ok: false, json: null });
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
