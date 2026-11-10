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
  buildBoxListBody,
  collectBoxApiVerdict,
  parseBoxApiPage,
  type BoxApiQuery,
} from "../src/main/workflows/dxm-smt-api.js";

const secret = /PetLifeGlobal|Charmify|zuhae|sibae|nicae|挂腰风扇|167842582613033710|7107102/;
const wanted = "示例夹子风扇草稿";

function envelope(json: unknown, status = 200, ok = status === 200) {
  return { status, ok, json };
}

function titles(count: number, start = 0) {
  return Array.from({ length: count }, (_, index) => `示例草稿${start + index + 1}`);
}

function asRows(list: string[]) {
  return list.map((title) => ({ title, productId: "" }));
}

function realJson(total: number, list: string[], searchValue = "", pageNo = 1, pageSize = BOX_API_PAGE_SIZE) {
  return {
    code: 0,
    msg: "Successful",
    data: {
      page: {
        list: list.map((subject) => ({ subject, productId: null })),
        pageNo,
        totalPage: Math.max(1, Math.ceil(total / pageSize)),
        pageSize,
        totalSize: total,
      },
      productParam: { searchValue },
    },
  };
}

function pageTitles(total: number, page: number, pageSize: number) {
  const start = (page - 1) * pageSize;
  return titles(Math.min(pageSize, Math.max(0, total - start)), start);
}

describe("R11-A2 采集箱接口契约", () => {
  it("请求体按实测字段顺序拼装，标题先 trim", () => {
    const body = buildBoxListBody({ title: "  示例夹子风扇草稿  ", page: 2, pageSize: 50, shopId: "  9001  " });
    const params = new URLSearchParams(body);
    expect([...params.keys()]).toEqual([
      "pageNo",
      "pageSize",
      "total",
      "searchType",
      "searchValue",
      "shopId",
      "dxmState",
      "dxmOfflineState",
    ]);
    expect(params.get("pageNo")).toBe("2");
    expect(params.get("pageSize")).toBe("50");
    expect(params.get("total")).toBe("0");
    expect(params.get("searchType")).toBe("0");
    expect(params.get("searchValue")).toBe(wanted);
    expect(params.get("shopId")).toBe("9001");
    expect(params.get("dxmState")).toBe("draft");
    expect(params.get("dxmOfflineState")).toBe("");
    expect(body).not.toContain("searchType=1");
    expect(body).not.toContain("searchType=2");
    const defaults = new URLSearchParams(buildBoxListBody({}));
    expect(defaults.get("shopId")).toBe("-1");
    expect(defaults.get("pageNo")).toBe("1");
    expect(defaults.get("pageSize")).toBe("100");
    expect(defaults.get("searchValue")).toBe("");
  });

  it("解析真实页、空列表和未翻完的页，坏结构不抛", () => {
    const normal = parseBoxApiPage(envelope(realJson(2, [wanted, "示例另一草稿"], wanted)));
    expect(normal.shapeOk).toBe(true);
    expect(normal.httpOk).toBe(true);
    expect(normal.total).toBe(2);
    expect(normal.echoTitle).toBe(wanted);
    expect(normal.rows).toEqual(asRows([wanted, "示例另一草稿"]));
    expect(normal.rows[0]?.productId).toBe("");
    expect(JSON.stringify(normal)).not.toMatch(secret);

    const catalog = parseBoxApiPage(envelope(realJson(136, pageTitles(136, 1, 100), "")));
    expect(catalog.total).toBe(136);
    expect(catalog.rows).toHaveLength(100);
    expect(catalog.shapeOk).toBe(true);

    const empty = parseBoxApiPage(envelope(realJson(0, [], "")));
    expect(empty).toMatchObject({ total: 0, rows: [], httpOk: true, shapeOk: true, echoTitle: "" });

    const partial = parseBoxApiPage(envelope(realJson(250, pageTitles(250, 1, 100), "")));
    expect(partial.shapeOk).toBe(true);
    expect(partial.rows).toHaveLength(100);
    expect(partial.total).toBeGreaterThan(partial.rows.length);

    expect(parseBoxApiPage(envelope(realJson(1, ["   "]))).shapeOk).toBe(false);
    expect(parseBoxApiPage(envelope({
      code: 0,
      data: { page: { totalSize: 1, list: [{ productId: null }] } },
    })).shapeOk).toBe(false);
    expect(parseBoxApiPage(envelope({
      code: 0,
      data: { page: { totalSize: 1, list: { subject: wanted } } },
    })).shapeOk).toBe(false);
    expect(parseBoxApiPage(envelope({ ...realJson(0, []), code: 1 })).shapeOk).toBe(false);
    expect(parseBoxApiPage(null).shapeOk).toBe(false);
    expect(parseBoxApiPage(envelope(null)).shapeOk).toBe(false);
    expect(parseBoxApiPage(envelope({
      code: 0,
      data: { page: { totalSize: "136", list: [] } },
    })).shapeOk).toBe(false);
    expect(parseBoxApiPage(envelope({
      total: 1,
      list: [{ title: wanted, productId: "3000001" }],
      echoTitle: wanted,
    })).shapeOk).toBe(false);
  });

  it("回显只认 productParam.searchValue", () => {
    const echoed = parseBoxApiPage(envelope(realJson(1, [wanted], wanted)));
    expect(echoed.echoTitle).toBe(wanted);
    const misplaced = parseBoxApiPage(envelope({
      code: 0,
      echoTitle: wanted,
      data: { page: { totalSize: 0, list: [] }, echoTitle: wanted },
    }));
    expect(misplaced.shapeOk).toBe(true);
    expect(misplaced.echoTitle).toBe("");
  });

  it("非 200、结构不对、只读了 100/250 都不判 absent", () => {
    const denied = boxApiVerdict([parseBoxApiPage(envelope(realJson(0, []), 404, false))], { title: wanted });
    const broken = boxApiVerdict([parseBoxApiPage(envelope({
      code: 0,
      data: { page: { totalSize: 1, list: "不是数组" } },
    }))], { title: wanted });
    const short = boxApiVerdict([
      parseBoxApiPage(envelope(realJson(250, pageTitles(250, 1, 100), wanted))),
    ], { title: wanted });
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
      const page = query.page || 1;
      return envelope(realJson(250, pageTitles(250, page, 100), wanted, page));
    });
    expect(seen).toEqual([1, 2, 3]);
    expect(full.status).toBe("absent");

    const stopped: number[] = [];
    const missing = await collectBoxApiVerdict({ title: wanted, pageSize: 100 }, async (query) => {
      stopped.push(query.page || 0);
      if (query.page === 3) return envelope(null, 500, false);
      const page = query.page || 1;
      return envelope(realJson(250, pageTitles(250, page, 100), wanted, page));
    });
    expect(stopped).toEqual([1, 2, 3]);
    expect(missing.status).toBe("unknown");
    expect(missing.reason ?? "").not.toMatch(/absent|没有草稿/);
  });

  it("没有回显且 total 等于全量时不直接 absent，改读全量", async () => {
    const filtered = parseBoxApiPage(envelope(realJson(250, titles(250), "")));
    expect(boxApiFilterProven(filtered, wanted, 250)).toBe(false);
    const direct = boxApiVerdict([filtered], { title: wanted }, { catalogTotal: 250 });
    expect(direct.status).toBe("unknown");
    expect(direct.reason).toContain("没有回显");

    const calls: Array<{ title: string; page: number }> = [];
    const result = await collectBoxApiVerdict({ title: wanted, pageSize: 100 }, async (query) => {
      calls.push({ title: query.title || "", page: query.page || 0 });
      const page = query.title ? 1 : (query.page || 1);
      return envelope(realJson(250, pageTitles(250, page, 100), "", page));
    });
    expect(calls).toEqual([
      { title: wanted, page: 1 },
      { title: "", page: 1 },
      { title: "", page: 2 },
      { title: "", page: 3 },
    ]);
    expect(result).toEqual(decideBoxLookup({
      loaded: true,
      rows: asRows([...titles(100, 0), ...titles(100, 100), ...titles(50, 200)]),
      title: wanted,
    }));
    expect(result.status).toBe("absent");
  });

  it("空结果配合回显可以判 absent，没有回显不能", () => {
    const page = parseBoxApiPage(envelope(realJson(0, [], "")));
    expect(boxApiVerdict([page], {}).status).toBe("absent");
    const echoed = parseBoxApiPage(envelope(realJson(0, [], wanted)));
    expect(echoed.echoTitle).toBe(wanted);
    expect(boxApiVerdict([echoed], { title: wanted }).status).toBe("absent");
    const unproven = parseBoxApiPage(envelope(realJson(0, [], "")));
    expect(boxApiVerdict([unproven], { title: wanted }).status).toBe("unknown");
  });

  it("第二页 36 行和首页 total 一致，命中仍是 ambiguous", async () => {
    const page2 = [...titles(35, 100), wanted];
    const seen: number[] = [];
    const result = await collectBoxApiVerdict({ title: wanted, pageSize: 100 }, async (query) => {
      const page = query.page || 1;
      seen.push(page);
      const list = page === 1 ? pageTitles(136, 1, 100) : page2;
      return envelope(realJson(136, list, wanted, page));
    });
    expect(seen).toEqual([1, 2]);
    expect(result.status).toBe("ambiguous");
    expect(result.status).not.toBe("found");
    expect(result.reason).toContain("标题精确匹配 1 条");
    expect(result).toEqual(decideBoxLookup({
      loaded: true,
      rows: asRows([...pageTitles(136, 1, 100), ...page2]),
      title: wanted,
    }));
  });

  it("近似标题按 decideBoxLookup 精确比对，不放宽", () => {
    const near = ["示例夹子风扇  草稿", "示例夹子风扇草稿（备注）", "示例DraftA"];
    const missed = parseBoxApiPage(envelope(realJson(near.length, near, wanted)));
    const miss = boxApiVerdict([missed], { title: wanted });
    expect(miss).toEqual(decideBoxLookup({ loaded: true, rows: asRows(near), title: wanted }));
    expect(miss.status).toBe("absent");

    const hitTitles = [...near, wanted];
    const hit = boxApiVerdict([parseBoxApiPage(envelope(realJson(hitTitles.length, hitTitles, wanted)))], { title: wanted });
    expect(hit).toEqual(decideBoxLookup({ loaded: true, rows: asRows(hitTitles), title: wanted }));
    expect(hit.status).toBe("ambiguous");
    expect(hit.status).not.toBe("found");
    expect(hit.reason).toContain("标题精确匹配 1 条");
    expect(JSON.stringify(near)).not.toMatch(secret);
  });

  it("预算耗尽时说明没读完，不说成没有返回 200", async () => {
    vi.useFakeTimers();
    try {
      const start = Date.now();
      const result = await collectBoxApiVerdict({ title: wanted, pageSize: 100 }, async (query) => {
        vi.setSystemTime(start + BOX_API_BUDGET_MS + 1);
        const page = query.page || 1;
        return envelope(realJson(136, pageTitles(136, page, 100), wanted, page));
      });
      expect(result.status).toBe("unknown");
      expect(result.reason).toContain("预算内没读完");
      expect(result.reason ?? "").not.toContain("没有返回 200");
    } finally {
      vi.useRealTimers();
    }
  });

  it("页面脚本按实测 POST，测试里不发出真实请求", async () => {
    const query: BoxApiQuery = { title: `  ${wanted}  `, shopId: "9001", page: 2, pageSize: 50, draftsOnly: true };
    const body = buildBoxListBody(query);
    const script = boxApiScript(query);
    expect(BOX_API_ENDPOINT).toBe("/api/smtProduct/pageList.json");
    expect(script).toContain("POST");
    expect(script).toContain("application/x-www-form-urlencoded; charset=UTF-8");
    expect(script).toContain("AbortController");
    expect(script).toContain("if (!request.endpoint) return failed");
    expect(script).toContain(JSON.stringify(body));
    expect(new URLSearchParams(body).get("searchValue")).toBe(wanted);
    expect(script).not.toContain(`  ${wanted}  `);
    expect(script).not.toMatch(/absent|ambiguous|dianxiaomi|searchType=1|searchType=2/);
    expect(script).not.toMatch(secret);
    const fetchSpy = vi.fn(async () => ({
      status: 200,
      ok: true,
      json: async () => ({ code: 0, data: { page: { list: [], totalSize: 0 } } }),
    }));
    vi.stubGlobal("fetch", fetchSpy);
    try {
      const value = await new Function(`return ${script}`)() as { status: number; ok: boolean; json: unknown };
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(fetchSpy.mock.calls[0]?.[0]).toBe(BOX_API_ENDPOINT);
      expect(fetchSpy.mock.calls[0]?.[1]).toMatchObject({ method: "POST", credentials: "same-origin", body });
      expect(value.status).toBe(200);
      expect(value.ok).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
