/**
 * Dianxiaomi SMT product-edit QA checklist.
 */
import type { ToolResult } from "../../shared/types.js";

export interface QaItem {
  id: string;
  label: string;
  status: "pass" | "fail" | "warn" | "skip";
  detail?: string;
}

export interface QaReport {
  ok: boolean;
  product: "dianxiaomi-smt";
  url: string;
  title: string;
  items: QaItem[];
  checkedAt: string;
  summary: string;
}

type ImageCard = {
  checked?: boolean;
  textW?: number;
  textH?: number;
  naturalWidth?: number;
};

type PageProbe = {
  url: string;
  title: string;
  titleValue?: string;
  titleCjk?: number;
  titleLetters?: number;
  categoryText?: string;
  attrCjk?: number;
  dutyChecked?: boolean;
  imageCards?: ImageCard[];
  checkedCount?: number;
  selectedImages?: number;
  errorTexts?: string[];
  errorCount?: number;
  priceFilled?: number;
  stockFilled?: number;
  emptyPrice?: number;
  emptyStock?: number;
  priceTotal?: number;
  stockTotal?: number;
  skuRows?: number;
  hasSubmit?: boolean;
};

export const QA_PROBE_SCRIPT = `(() => {
  const S = (el) => ((el && (el.innerText || el.textContent)) || "").replace(/\\s+/g, " ").trim();
  const fi = (kw) => Array.from(document.querySelectorAll(".ant-form-item")).find((f) => S(f.querySelector("label")).replace(/\\s+/g, "").indexOf(kw) >= 0);
  const val = (el) => (el ? String(el.value == null ? "" : el.value).trim() : "");
  const cjkCount = (s) => (String(s).match(/[\\u4e00-\\u9fff]/g) || []).length;
  const letterCount = (s) => (String(s).match(/[A-Za-z]/g) || []).length;
  const titleItem = fi("产品标题");
  const titleInput = titleItem ? titleItem.querySelector("input,textarea") : null;
  const titleValue = val(titleInput);
  const catItem = fi("产品分类");
  const attrItem = fi("自定义属性");
  const attrValues = attrItem ? Array.from(attrItem.querySelectorAll("input,textarea")).map(val).filter(Boolean) : [];
  const dutyItem = fi("报价是否含关税");
  const dutyChecked = dutyItem ? Array.from(dutyItem.querySelectorAll("input[type=radio]")).some((r) => r.checked) : false;
  const imgs = Array.from(document.querySelectorAll(".productMainImgModule .single-image"));
  const imageCards = imgs.map((el) => {
    const img = el.querySelector("img");
    const dim = S(el);
    const m = dim.match(/(\\d{2,4})\\s*[Xx×]\\s*(\\d{2,4})/);
    const box = el.querySelector("input.ant-checkbox-input");
    return {
      checked: !!(box && box.checked),
      textW: m ? Number(m[1]) : 0,
      textH: m ? Number(m[2]) : 0,
      naturalWidth: img && img.naturalWidth ? img.naturalWidth : 0,
    };
  });
  const errs = Array.from(document.querySelectorAll(".ant-form-item-explain-error")).map(S).filter(Boolean);
  const rows = Array.from(document.querySelectorAll(".smtSkuEditTable table tr")).slice(2);
  let priceFilled = 0, priceTotal = 0, stockFilled = 0, stockTotal = 0, emptyPrice = 0, emptyStock = 0;
  rows.forEach((tr) => {
    const td = Array.from(tr.querySelectorAll("td"));
    const price = td[2] && td[2].querySelector("input");
    const stock = td[6] && td[6].querySelector("input");
    if (price) { priceTotal += 1; if (val(price)) priceFilled += 1; else emptyPrice += 1; }
    if (stock) { stockTotal += 1; if (val(stock)) stockFilled += 1; else emptyStock += 1; }
  });
  const checkedCount = imageCards.filter((c) => c.checked).length;
  return {
    url: location.href,
    title: document.title,
    titleValue,
    titleCjk: cjkCount(titleValue),
    titleLetters: letterCount(titleValue),
    categoryText: catItem ? S(catItem) : "",
    attrCjk: attrValues.reduce((n, v) => n + cjkCount(v), 0),
    attrCount: attrValues.length,
    dutyChecked,
    imageCards,
    checkedCount,
    selectedImages: checkedCount,
    errorTexts: errs.slice(0, 12),
    errorCount: errs.length,
    priceFilled,
    stockFilled,
    priceTotal,
    stockTotal,
    emptyPrice,
    emptyStock,
    skuRows: rows.length,
    hasSubmit: Array.from(document.querySelectorAll("button,a")).some((el) => /提交|保存|发布/.test(S(el))),
  };
})()`;

function skip(id: string, label: string): QaItem {
  return { id, label, status: "skip", detail: "非 SMT 编辑页，跳过" };
}

export function buildSmtQaReport(probe: PageProbe & Record<string, unknown>): QaReport {
  const items: QaItem[] = [];
  const url = probe.url || "";
  const onSmt = /dianxiaomi\.com\/web\/smt\/edit/i.test(url);

  items.push({
    id: "page",
    label: "当前为速卖通产品编辑页",
    status: onSmt ? "pass" : "fail",
    detail: url,
  });

  const titleValue = String(probe.titleValue || "");
  const titleCjk = Number(probe.titleCjk || 0);
  const titleLetters = Number(probe.titleLetters || 0);
  if (!onSmt) {
    items.push(skip("title", "产品标题为英文"));
  } else if (!titleValue) {
    items.push({ id: "title", label: "产品标题为英文", status: "fail", detail: "标题为空" });
  } else if (titleCjk > 0 && titleCjk >= titleLetters) {
    items.push({
      id: "title",
      label: "产品标题为英文",
      status: "fail",
      detail: `标题仍含中文：${titleValue.slice(0, 60)}`,
    });
  } else {
    items.push({
      id: "title",
      label: "产品标题为英文",
      status: "pass",
      detail: titleValue.slice(0, 80),
    });
  }

  const cards = Array.isArray(probe.imageCards) ? probe.imageCards : [];
  const checked = cards.length
    ? cards.filter((card) => card.checked).length
    : Number(probe.checkedCount ?? probe.selectedImages ?? NaN);
  if (!onSmt) {
    items.push(skip("images_selected", "主图恰好 6 张"));
  } else if (!Number.isFinite(checked)) {
    items.push({ id: "images_selected", label: "主图恰好 6 张", status: "fail", detail: "没有读到勾选数" });
  } else if (checked === 6) {
    items.push({ id: "images_selected", label: "主图恰好 6 张", status: "pass", detail: "选用了 6 张" });
  } else {
    items.push({
      id: "images_selected",
      label: "主图恰好 6 张",
      status: "fail",
      detail: `选用了 ${checked} 张，需要恰好 6 张`,
    });
  }

  if (!onSmt) {
    items.push(skip("image_size", "商品图宽度都是 800"));
  } else if (!cards.length) {
    items.push({
      id: "image_size",
      label: "商品图宽度都是 800",
      status: "fail",
      detail: "没有读到 .productMainImgModule 里的商品图",
    });
  } else {
    const bad = cards.filter((card) => {
      const textOk = Number(card.textW) === 800;
      const natural = Number(card.naturalWidth || 0);
      const naturalOk = natural === 0 || natural === 800;
      return !(textOk && naturalOk);
    });
    items.push({
      id: "image_size",
      label: "商品图宽度都是 800",
      status: bad.length ? "fail" : "pass",
      detail: bad.length
        ? `${bad.length}/${cards.length} 张不是 800 宽`
        : `${cards.length} 张都是 800 宽`,
    });
  }

  const attrCjk = Number(probe.attrCjk || 0);
  if (!onSmt) {
    items.push(skip("attr_zh", "自定义属性无中文"));
  } else if (attrCjk > 0) {
    items.push({
      id: "attr_zh",
      label: "自定义属性无中文",
      status: "fail",
      detail: `属性值里有 ${attrCjk} 个汉字`,
    });
  } else {
    items.push({ id: "attr_zh", label: "自定义属性无中文", status: "pass", detail: "属性值没有汉字" });
  }

  const errorCount = Number(probe.errorCount || 0);
  const errorTexts = Array.isArray(probe.errorTexts) ? probe.errorTexts.map(String) : [];
  const dutyChecked = probe.dutyChecked === true;
  if (!onSmt) {
    items.push(skip("form_errors", "红字为 0 且关税已选"));
  } else if (errorCount > 0 || !dutyChecked) {
    const bits: string[] = [];
    if (errorCount > 0) bits.push(`红字 ${errorCount}：${errorTexts.slice(0, 2).join("；") || "有红字"}`);
    if (!dutyChecked) bits.push("报价是否含关税未选");
    items.push({
      id: "form_errors",
      label: "红字为 0 且关税已选",
      status: "fail",
      detail: bits.join("；"),
    });
  } else {
    items.push({ id: "form_errors", label: "红字为 0 且关税已选", status: "pass", detail: "无红字，关税已选" });
  }

  const emptyPrice = Number(probe.emptyPrice || 0);
  const emptyStock = Number(probe.emptyStock || 0);
  const priceTotal = Number(probe.priceTotal || 0);
  const stockTotal = Number(probe.stockTotal || 0);
  if (!onSmt) {
    items.push(skip("sku", "SKU 每行都有价格和库存"));
  } else if (priceTotal === 0 || stockTotal === 0 || emptyPrice > 0 || emptyStock > 0) {
    items.push({
      id: "sku",
      label: "SKU 每行都有价格和库存",
      status: "fail",
      detail: `空价格 ${emptyPrice}，空库存 ${emptyStock}，价格框 ${priceTotal}，库存框 ${stockTotal}`,
    });
  } else {
    items.push({
      id: "sku",
      label: "SKU 每行都有价格和库存",
      status: "pass",
      detail: `${priceTotal} 行价格和库存都有值`,
    });
  }

  const categoryBody = String(probe.categoryText || "").replace(/^产品分类/, "").trim();
  if (!onSmt) {
    items.push(skip("category", "类目已定"));
  } else if (categoryBody.length < 2) {
    items.push({ id: "category", label: "类目已定", status: "fail", detail: "产品分类为空" });
  } else {
    items.push({ id: "category", label: "类目已定", status: "pass", detail: categoryBody.slice(0, 80) });
  }

  const fails = items.filter((i) => i.status === "fail");
  const warns = items.filter((i) => i.status === "warn");
  const ok = fails.length === 0;
  return {
    ok,
    product: "dianxiaomi-smt",
    url,
    title: probe.title || "",
    items,
    checkedAt: new Date().toISOString(),
    summary: ok
      ? `QA PASS${warns.length ? `（${warns.length} 警告）` : ""}`
      : `QA FAIL：${fails.map((f) => f.label).join("；")}`,
  };
}

export function qaReportToToolResult(report: QaReport): ToolResult {
  return {
    ok: report.ok,
    message: report.summary,
    data: report,
  };
}

/** True if click/fill target looks like a submit/save action. */
export function looksLikeSubmitAction(text: string): boolean {
  return /提交|保存并提交|发布产品|立即发布|确认发布/.test(text || "");
}

/** 新核心的确认在模型层 request_confirm。执行中不再套店小秘闸门。 */
export function submitClickNeedsGate(freeSoulRunning: boolean, label: string): boolean {
  if (freeSoulRunning) return false;
  return looksLikeSubmitAction(label);
}
