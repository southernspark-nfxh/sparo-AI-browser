/** 发布前 QA。没有 best_effort。通过也不等于上线。决策点 #38。 */
import type { DxmListingWorkOrder } from "./dxm-smt-contract.js";
import type { FieldDef, ImageGroupName, ImageSlot } from "./dxm-smt-fields.js";
import { imagesPass } from "./dxm-smt-images.js";

export type QaEvaluation = {
  result: "pass" | "waiting_human" | "fail";
  missing: Array<{ field: string; reason: string; action: string }>;
};

export function evaluateQa(input: {
  identityOk: boolean;
  textTranslated?: boolean;
  fields: FieldDef[];
  images: Record<ImageGroupName, ImageSlot[]>;
  missing: Array<{ field: string; reason: string; action: string }>;
}): QaEvaluation {
  if (!input.identityOk) {
    return { result: "fail", missing: input.missing };
  }
  if (input.missing.length) return { result: "waiting_human", missing: input.missing };
  const requiredOpen = input.fields.some((field) => field.required && (!String(field.value || "").trim() || !field.verified));
  if (requiredOpen) return { result: "fail", missing: input.missing };
  if (!imagesPass(input.images)) return { result: "fail", missing: input.missing };
  return { result: "pass", missing: [] };
}

export function prepareSummary(input: {
  shop: string;
  title: string;
  category: string;
  priceRange: string;
  stockTotal: string;
  images: string;
  translation: string;
  risks: string;
}): string {
  return [
    `店铺：${input.shop || "未知"}`,
    `标题：${input.title || "未知"}`,
    `类目：${input.category || "未知"}`,
    `价格区间：${input.priceRange || "未知"}`,
    `库存合计：${input.stockTotal || "未知"}`,
    `图片：${input.images || "未知"}`,
    `翻译：${input.translation || "未知"}`,
    `风险：${input.risks || "无"}`,
  ].join("\n");
}

export function qaStillValid(order: DxmListingWorkOrder, fingerprint: string): boolean {
  return Boolean(
    order.qa?.result === "pass" &&
      order.qa.draftFingerprint === fingerprint &&
      order.draftFingerprint === fingerprint,
  );
}
