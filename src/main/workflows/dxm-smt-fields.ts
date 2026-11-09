/** 动态字段、SKU 对齐和译文风险。不猜测价格、资质和模板。 */

export type FieldProvenance = "source" | "user" | "approved_rule" | "readback" | "suggestion";

export type FieldDef = {
  key: string;
  group: string;
  required: boolean;
  value?: string;
  verified: boolean;
  provenance?: FieldProvenance;
  business?: boolean;
};

export type SkuRow = {
  specs: Record<string, string>;
  price?: string;
  /** 价格格原文，例如 `1.75 USD`。比较和入库用剥离后的 price。 */
  rawPrice?: string;
  stock?: string;
};

export type ImageGroupName = "main" | "variant" | "description";

export type ImageSlot = {
  src: string;
  status: "pending" | "started" | "verified" | "failed";
};

export type FieldSnapshot = {
  categoryId?: string;
  title?: string;
  currency?: string;
  fields: FieldDef[];
  skus: SkuRow[];
  images: Record<ImageGroupName, ImageSlot[]>;
  freightTemplate?: string;
  brand?: string;
  qualification?: string;
  weight?: string;
  size?: string;
  description?: string;
  /** 描述在 iframe 里，本轮不读，只留下这个标记。 */
  descriptionNote?: string;
  /** 变种区读不到行时的原因。空数组本身不代表成功读回。 */
  skuReadReason?: string;
};

/** `1.75 USD` → `1.75`。空或非数字返回空，不把原文留成价格。 */
export function parsePriceCell(text: string): string {
  const raw = String(text ?? "").replace(/\u00a0/g, " ").trim();
  if (!raw) return "";
  const match = raw.match(/^(-?\d+(?:\.\d+)?)(?:\s*[A-Za-z]{2,4})?$/);
  return match?.[1] || "";
}

const BUSINESS_KEYS = new Set([
  "price",
  "currency",
  "declaredValue",
  "stock",
  "weight",
  "size",
  "freightTemplate",
  "brand",
  "qualification",
]);

export function rescanRequired(fields: FieldDef[]): Array<{ field: string; reason: string; action: string }> {
  return fields
    .filter((field) => field.required && !String(field.value || "").trim())
    .map((field) => ({
      field: field.key,
      reason: "当前类目必填项还没有值",
      action: "补齐后再继续，不会猜测",
    }));
}

export function alignSkus(rows: SkuRow[]): { ok: true; rows: SkuRow[] } | { ok: false; reason: string } {
  const seen = new Set<string>();
  for (const row of rows) {
    const key = specKey(row.specs);
    if (seen.has(key)) return { ok: false, reason: "规格重复，无法确定价格和库存对应哪一行" };
    seen.add(key);
  }
  const sorted = [...rows].sort((a, b) => specKey(a.specs).localeCompare(specKey(b.specs), "zh"));
  return { ok: true, rows: sorted };
}

export function acceptBusinessValue(input: {
  key: string;
  value?: string;
  provenance?: string;
}): { accepted: boolean; reason?: string } {
  if (!BUSINESS_KEYS.has(input.key)) return { accepted: true };
  const value = String(input.value || "").trim();
  if (!value) return { accepted: false, reason: "业务值为空" };
  if (input.key === "brand" && value === "无品牌") {
    return { accepted: false, reason: "不能靠猜测品牌绕过资质" };
  }
  const allowed =
    input.provenance === "source" ||
    input.provenance === "user" ||
    input.provenance === "approved_rule" ||
    input.provenance === "readback";
  if (!allowed) return { accepted: false, reason: "业务值没有可靠来源" };
  return { accepted: true };
}

/** 残留中文只标记，不改写原文，也不把受保护品牌算进风险。 */
export function translationRisks(text: string, protectedTerms: string[]): { risks: string[]; text: string } {
  const terms = protectedTerms.filter(Boolean).sort((a, b) => b.length - a.length);
  let rest = text;
  for (const term of terms) rest = rest.split(term).join(" ");
  const risks = (rest.match(/[\u4e00-\u9fff]+/g) || []).map((chunk) => `可疑中文残留：${chunk}`);
  return { risks, text };
}

/** 空译文、超长和模板变量丢失进入缺项。普通中文残留仍由 translationRisks 只标风险。 */
export function textReadbackIssues(input: { title?: string; description?: string; skuTokens?: string[] }): string[] {
  const issues: string[] = [];
  const title = String(input.title || "");
  if (!title.trim()) issues.push("空译文");
  if (!String(input.description || "").trim()) issues.push("描述空译文");
  if (title.length > 128) issues.push("译文超长");
  const blob = `${title}\n${input.description || ""}`;
  for (const token of input.skuTokens || []) {
    if (!token) continue;
    if (!/^[{$]/.test(token)) continue;
    if (!blob.includes(token)) issues.push(`SKU 变量丢失：${token}`);
  }
  return issues;
}

/** 翻译前后的 SKU 行必须一致。改价格、改库存或多出一行都不能当成翻译成功。 */
export function skuContinuityIssues(before: SkuRow[], after: SkuRow[]): string[] {
  if (!before.length && !after.length) return [];
  if (!after.length) return ["SKU 读回为空"];
  const issues: string[] = [];
  const used = new Set<number>();
  for (const row of before) {
    const index = after.findIndex((candidate, at) => !used.has(at) && specKey(candidate.specs) === specKey(row.specs));
    if (index < 0) {
      issues.push("规格丢失");
      continue;
    }
    used.add(index);
    const next = after[index];
    if (!next) continue;
    if (parsePriceCell(String(row.price ?? "")) !== parsePriceCell(String(next.price ?? ""))) issues.push("价格变化");
    if (parsePriceCell(String(row.stock ?? "")) !== parsePriceCell(String(next.stock ?? ""))) issues.push("库存变化");
  }
  if (after.some((_row, index) => !used.has(index))) issues.push("新增 SKU 行");
  return issues;
}

function specKey(specs: Record<string, string>): string {
  return Object.keys(specs)
    .sort()
    .map((key) => `${key}=${specs[key] || ""}`)
    .join("|");
}
