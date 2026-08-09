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

type PageProbe = {
  url: string;
  title: string;
  titleValue?: string;
  priceFilled?: number;
  stockFilled?: number;
  selectedImages?: number;
  dimSamples?: string[];
  hasSubmit?: boolean;
};

export const QA_PROBE_SCRIPT = `(() => {
  const url = location.href;
  const title = document.title;
  // product title input heuristics
  const titleInput =
    document.querySelector('input[placeholder*="标题"]') ||
    document.querySelector('textarea[placeholder*="标题"]') ||
    Array.from(document.querySelectorAll('input,textarea')).find((el) => {
      const ph = (el.getAttribute('placeholder') || '') + (el.getAttribute('aria-label') || '');
      return /标题|Title/i.test(ph);
    });
  const titleValue = titleInput ? String(titleInput.value || titleInput.textContent || '').trim() : '';

  const priceInputs = Array.from(document.querySelectorAll('input')).filter((el) => {
    const ph = (el.getAttribute('placeholder') || '') + (el.getAttribute('name') || '');
    return /零售价|价格|price/i.test(ph) || /price/i.test(el.className || '');
  });
  const stockInputs = Array.from(document.querySelectorAll('input')).filter((el) => {
    const ph = (el.getAttribute('placeholder') || '') + (el.getAttribute('name') || '');
    return /库存|stock/i.test(ph);
  });
  const priceFilled = priceInputs.filter((i) => String(i.value || '').trim() !== '').length;
  const stockFilled = stockInputs.filter((i) => String(i.value || '').trim() !== '').length;

  const selectedImages = (document.body.innerText.match(/选用了\\s*(\\d+)\\s*张/) || [])[1];
  const dims = [...document.body.innerText.matchAll(/(\\d{2,4})\\s*[Xx×]\\s*(\\d{2,4})/g)]
    .map((m) => m[0].replace(/×/g, 'X').replace(/\\s+/g, ' '))
    .slice(0, 30);

  const hasSubmit = Array.from(document.querySelectorAll('button,a')).some((el) =>
    /提交|保存|发布/.test((el.innerText || '').trim()),
  );

  return {
    url,
    title,
    titleValue,
    priceFilled,
    stockFilled,
    priceTotal: priceInputs.length,
    stockTotal: stockInputs.length,
    selectedImages: selectedImages ? Number(selectedImages) : null,
    dimSamples: [...new Set(dims)].slice(0, 12),
    hasSubmit,
  };
})()`;

function looksEnglishHeavy(s: string): boolean {
  if (!s || s.length < 8) return false;
  const letters = (s.match(/[A-Za-z]/g) || []).length;
  const cjk = (s.match(/[\u4e00-\u9fff]/g) || []).length;
  return letters >= 10 && letters > cjk * 2;
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
  if (!onSmt) {
    items.push({
      id: "title",
      label: "产品标题已填且偏英文",
      status: "skip",
      detail: "非 SMT 编辑页，跳过",
    });
  } else if (!titleValue) {
    items.push({
      id: "title",
      label: "产品标题已填且偏英文",
      status: "fail",
      detail: "标题为空",
    });
  } else if (!looksEnglishHeavy(titleValue)) {
    items.push({
      id: "title",
      label: "产品标题已填且偏英文",
      status: "warn",
      detail: `标题可能仍含较多中文：${titleValue.slice(0, 60)}`,
    });
  } else {
    items.push({
      id: "title",
      label: "产品标题已填且偏英文",
      status: "pass",
      detail: titleValue.slice(0, 80),
    });
  }

  const priceFilled = Number(probe.priceFilled || 0);
  const stockFilled = Number(probe.stockFilled || 0);
  items.push({
    id: "sku_price",
    label: "SKU 零售价已填写",
    status: !onSmt ? "skip" : priceFilled > 0 ? "pass" : "fail",
    detail: `已填 ${priceFilled} 个价格框`,
  });
  items.push({
    id: "sku_stock",
    label: "SKU 库存已填写",
    status: !onSmt ? "skip" : stockFilled > 0 ? "pass" : "fail",
    detail: `已填 ${stockFilled} 个库存框`,
  });

  const selected = probe.selectedImages;
  if (!onSmt) {
    items.push({ id: "images_selected", label: "主图已选用", status: "skip" });
  } else if (selected == null) {
    items.push({
      id: "images_selected",
      label: "主图已选用（1–6 张）",
      status: "warn",
      detail: "未能解析选用张数",
    });
  } else if (selected >= 1 && selected <= 6) {
    items.push({
      id: "images_selected",
      label: "主图已选用（1–6 张）",
      status: "pass",
      detail: `选用了 ${selected} 张`,
    });
  } else {
    items.push({
      id: "images_selected",
      label: "主图已选用（1–6 张）",
      status: "fail",
      detail: `选用了 ${selected} 张`,
    });
  }

  const dims = (probe.dimSamples || []) as string[];
  if (!onSmt || dims.length === 0) {
    items.push({
      id: "image_size",
      label: "图片尺寸接近 800 边",
      status: onSmt ? "warn" : "skip",
      detail: dims.length ? dims.join(", ") : "无尺寸样本",
    });
  } else {
    const near800 = dims.filter((d) => {
      const m = d.match(/(\d+)\s*X\s*(\d+)/i);
      if (!m) return false;
      const w = Number(m[1]);
      const h = Number(m[2]);
      return Math.abs(w - 800) <= 5 || Math.abs(h - 800) <= 5;
    });
    const ratio = near800.length / dims.length;
    items.push({
      id: "image_size",
      label: "图片尺寸接近 800 边",
      status: ratio >= 0.6 ? "pass" : ratio >= 0.3 ? "warn" : "fail",
      detail: `${near800.length}/${dims.length} 样本近 800；样例 ${dims.slice(0, 5).join(", ")}`,
    });
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
