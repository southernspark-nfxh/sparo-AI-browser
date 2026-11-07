/** 草稿指纹。相同规范化业务内容得到相同指纹。决策点 #38。 */
import { createHash } from "node:crypto";
import type { FieldSnapshot } from "./dxm-smt-fields.js";

export type FingerprintSource = {
  shopId?: string;
  shopName?: string;
  title?: string;
  categoryId?: string;
  draftId?: string;
  recordId?: string;
  pageUrl?: string;
  snapshot: FieldSnapshot;
};

export function fingerprintFromSnapshot(input: FingerprintSource): string {
  const snapshot = input.snapshot;
  const payload = {
    brand: clean(snapshot.brand),
    categoryId: clean(input.categoryId),
    currency: clean(snapshot.currency),
    description: clean(snapshot.description),
    draftId: clean(input.draftId),
    fields: [...(snapshot.fields || [])]
      .map((field) => ({ key: clean(field.key), value: numeric(field.value) }))
      .sort((a, b) => a.key.localeCompare(b.key)),
    freightTemplate: clean(snapshot.freightTemplate),
    images: (["description", "main", "variant"] as const)
      .flatMap((group) =>
        (snapshot.images[group] || []).map((item) => ({ group, src: clean(item.src), status: item.status })),
      )
      .sort((a, b) => `${a.group}:${a.src}:${a.status}`.localeCompare(`${b.group}:${b.src}:${b.status}`)),
    pageUrl: clean(input.pageUrl),
    qualification: clean(snapshot.qualification),
    recordId: clean(input.recordId),
    shopId: clean(input.shopId),
    shopName: clean(input.shopName),
    size: clean(snapshot.size),
    skus: [...(snapshot.skus || [])]
      .map((row) => ({
        price: numeric(row.price),
        specs: sortedSpecs(row.specs),
        stock: numeric(row.stock),
      }))
      .sort((a, b) => JSON.stringify(a.specs).localeCompare(JSON.stringify(b.specs))),
    title: clean(input.title),
    weight: numeric(snapshot.weight),
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function clean(value: string | undefined): string {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function numeric(value: string | undefined): string {
  const text = clean(value).replace(/,/g, "");
  if (!text) return "";
  if (!/^-?\d+(\.\d+)?$/.test(text)) return text;
  const number = Number(text);
  return Number.isFinite(number) ? String(number) : text;
}

function sortedSpecs(specs: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(specs).sort()) out[key] = clean(specs[key]);
  return out;
}
