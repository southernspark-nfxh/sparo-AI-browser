import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { isOneShotSkill, matchTrigger, normalizeUtterance, type Trigger } from "../src/main/triggers/gate.js";
import {
  deleteTrigger,
  loadTriggers,
  recordOutcome,
  toggleTrigger,
  upsertTrigger,
} from "../src/main/triggers/store.js";

const dirs: string[] = [];
function tmp() {
  const d = mkdtempSync(join(tmpdir(), "sparo-trigger-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function row(partial: Partial<Trigger> & Pick<Trigger, "text">): Trigger {
  return {
    id: partial.id || "abcd1234",
    skillId: partial.skillId || "qa-gate-demo",
    text: partial.text,
    addedAt: partial.addedAt || "2026-10-23T00:00:00.000Z",
    runs: partial.runs || 0,
    fails: partial.fails || 0,
    enabled: partial.enabled !== false,
    lastUsedAt: partial.lastUsedAt,
  };
}

describe("normalizeUtterance", () => {
  it("is idempotent, folds width and space, and strips trailing punctuation", () => {
    const raw = "  你好，Ｂｅｉｊｉｎｇ　１！  ";
    const once = normalizeUtterance(raw);
    expect(once).toBe("你好,Beijing 1");
    expect(normalizeUtterance(once)).toBe(once);
    expect(normalizeUtterance("今天北京天气怎么样。")).toBe("今天北京天气怎么样");
    expect(normalizeUtterance("真的吗？？")).toBe("真的吗");
    expect(normalizeUtterance("a   b\tc")).toBe("a b c");
    expect(normalizeUtterance("  。  ")).toBe("");
    expect(normalizeUtterance("")).toBe("");
  });
});

describe("matchTrigger", () => {
  it("matches the whole utterance only", () => {
    const triggers = [row({ text: "运行妙招 QA门岗演示" })];
    expect(matchTrigger(triggers, "运行妙招 QA门岗演示")?.skillId).toBe("qa-gate-demo");
    expect(matchTrigger(triggers, "  运行妙招 QA门岗演示。 ")).not.toBeNull();
    expect(matchTrigger(triggers, "运行妙招 QA门岗演示2")).toBeNull();
    expect(matchTrigger([{ ...triggers[0], enabled: false }], "运行妙招 QA门岗演示")).toBeNull();
    expect(matchTrigger([], "运行妙招 QA门岗演示")).toBeNull();
    expect(matchTrigger(triggers, "   。")).toBeNull();
  });
});

describe("isOneShotSkill", () => {
  it("accepts only short whitelist steps without slots or required params", () => {
    expect(
      isOneShotSkill({
        steps: [{ tool: "navigate", args: { url: "https://www.baidu.com" } }, { tool: "page_text" }],
      }),
    ).toBe(true);
    expect(isOneShotSkill({ steps: [{ action: "click" }] })).toBe(false);
    expect(isOneShotSkill({ steps: [{ tool: "fill" }, { tool: "page_text" }] })).toBe(false);
    expect(
      isOneShotSkill({
        steps: [
          { tool: "navigate" },
          { tool: "wait_for" },
          { tool: "page_text" },
          { tool: "page_text" },
        ],
      }),
    ).toBe(false);
    expect(
      isOneShotSkill({
        steps: [{ tool: "navigate", args: { url: "https://example.com/{{url}}" } }, { tool: "page_text" }],
      }),
    ).toBe(false);
    expect(
      isOneShotSkill({
        steps: [{ tool: "navigate" }, { tool: "page_text" }],
        params: { city: { required: true } },
      }),
    ).toBe(false);
    expect(isOneShotSkill({ steps: [] })).toBe(false);
  });
});

describe("trigger store", () => {
  it("persists upsert, dedupes text, toggles, and deletes", () => {
    const dir = tmp();
    const a = upsertTrigger(dir, { skillId: "qa-gate-demo", text: "  运行妙招 QA门岗演示。 " });
    const b = upsertTrigger(dir, { skillId: "other", text: "运行妙招 QA门岗演示" });
    expect(a?.id).toMatch(/^[0-9a-f]{8}$/);
    expect(b?.id).toBe(a?.id);
    expect(b?.skillId).toBe("other");
    expect(loadTriggers(dir)).toHaveLength(1);
    expect(upsertTrigger(dir, { skillId: "x", text: "  。 " })).toBeNull();
    expect(toggleTrigger(dir, a!.id, false)).toBe(true);
    expect(loadTriggers(dir)[0].enabled).toBe(false);
    recordOutcome(dir, a!.id, false);
    recordOutcome(dir, a!.id, false);
    expect(loadTriggers(dir)[0].fails).toBe(2);
    expect(toggleTrigger(dir, a!.id, true)).toBe(true);
    expect(loadTriggers(dir)[0]).toMatchObject({ enabled: true, fails: 0 });
    expect(deleteTrigger(dir, a!.id)).toBe(true);
    expect(loadTriggers(dir)).toHaveLength(0);
    expect(deleteTrigger(dir, a!.id)).toBe(false);
  });

  it("counts outcomes and disables after two failures", () => {
    const dir = tmp();
    const saved = upsertTrigger(dir, { skillId: "qa-gate-demo", text: "运行妙招 QA门岗演示" });
    expect(saved).not.toBeNull();
    const once = recordOutcome(dir, saved!.id, false);
    expect(once).toMatchObject({ fails: 1, enabled: true, runs: 0 });
    const twice = recordOutcome(dir, saved!.id, false);
    expect(twice).toMatchObject({ fails: 2, enabled: false });
    const again = upsertTrigger(dir, { skillId: "qa-gate-demo", text: "运行妙招 QA门岗演示" });
    expect(again?.id).toBe(saved?.id);
    toggleTrigger(dir, saved!.id, true);
    const ok = recordOutcome(dir, saved!.id, true);
    expect(ok).toMatchObject({ runs: 1, fails: 0, enabled: true });
    expect(ok?.lastUsedAt).toBeTruthy();
    expect(loadTriggers(dir)[0].runs).toBe(1);
  });

  it("returns empty when the file is not json", () => {
    const dir = tmp();
    writeFileSync(join(dir, "skill-triggers.json"), "{", "utf8");
    expect(loadTriggers(dir)).toEqual([]);
    const saved = upsertTrigger(dir, { skillId: "qa-gate-demo", text: "运行妙招 QA门岗演示" });
    expect(loadTriggers(dir)).toHaveLength(1);
    expect(saved?.text).toBe("运行妙招 QA门岗演示");
  });
});
