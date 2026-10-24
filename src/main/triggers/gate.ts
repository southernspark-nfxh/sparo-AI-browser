/**
 * 门岗纯函数。不读文件、不碰浏览器。one-shot 判定 P2 起归大脑（agent/distill.ts），本地不再留白名单。
 */

export type Trigger = {
  id: string;
  skillId: string;
  text: string;
  addedAt: string;
  runs: number;
  fails: number;
  enabled: boolean;
  lastUsedAt?: string;
};

/** trim → 连续空白并成单空格 → 全角字母数字标点转半角 → 去掉句末标点。 */
export function normalizeUtterance(text: string): string {
  let s = String(text || "").trim().replace(/\s+/g, " ");
  s = s.replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
  s = s.replace(/[。！？!?.]+$/g, "");
  return s.trim();
}

export function matchTrigger(triggers: Trigger[], text: string): Trigger | null {
  const key = normalizeUtterance(text);
  if (!key) return null;
  for (const row of triggers || []) {
    if (!row || row.enabled === false) continue;
    if (normalizeUtterance(row.text) === key) return row;
  }
  return null;
}
