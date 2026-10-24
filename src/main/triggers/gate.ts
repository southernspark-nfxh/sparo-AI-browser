/**
 * 门岗纯函数。不读文件、不碰浏览器。
 * one-shot 白名单是本地规则，过期 2027-01-23，P2 由大脑接管后删除。
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

/** 本地宽类型。不引用 skills/store.ts 的 Skill（没有 params，步骤字段是 action）。 */
export type SkillProbe = {
  steps?: Array<{ tool?: string; action?: string; args?: unknown }>;
  params?: Record<string, { required?: boolean } | undefined>;
};

const ONE_SHOT_TOOLS = new Set(["navigate", "wait_for", "page_text"]);

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

export function isOneShotSkill(skill: SkillProbe | null | undefined): boolean {
  const steps = skill?.steps;
  if (!Array.isArray(steps) || steps.length < 1 || steps.length > 3) return false;
  if (JSON.stringify(steps).includes("{{")) return false;
  for (const step of steps) {
    const tool = String(step?.tool || step?.action || "").toLowerCase();
    if (!ONE_SHOT_TOOLS.has(tool)) return false;
  }
  const params = skill?.params;
  if (params && typeof params === "object") {
    for (const def of Object.values(params)) {
      if (def && typeof def === "object" && def.required === true) return false;
    }
  }
  return true;
}
