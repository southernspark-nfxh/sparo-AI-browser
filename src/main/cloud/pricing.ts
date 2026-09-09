export const CLOUD_PLAN_IDS = ["intro", "monthly", "quarterly", "yearly", "extra"] as const;

export type CloudPlanId = (typeof CLOUD_PLAN_IDS)[number];

export type CloudPlanKind = "timed" | "subscription" | "permanent" | "topup";

export type CloudPlanPublic = {
  id: CloudPlanId;
  money: string;
  points: number;
  kind: CloudPlanKind;
  days: number;
};

export function isCloudPlanId(id: string): id is CloudPlanId {
  return (CLOUD_PLAN_IDS as readonly string[]).includes(id);
}

function normalizeKind(raw: unknown): CloudPlanKind {
  const k = String(raw || "");
  if (k === "timed" || k === "subscription" || k === "permanent" || k === "topup") return k;
  return "subscription";
}

export function sanitizePlans(raw: unknown): CloudPlanPublic[] {
  if (!Array.isArray(raw)) return [];
  const out: CloudPlanPublic[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const id = String(rec.id || "");
    if (!isCloudPlanId(id)) continue;
    out.push({
      id,
      money: String(rec.money || ""),
      points: Number(rec.points) || 0,
      kind: normalizeKind(rec.kind),
      days: Number(rec.days ?? rec.months) || 0,
    });
  }
  return out;
}
