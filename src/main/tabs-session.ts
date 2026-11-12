import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** 一张可恢复的标签。只留重启后重新打开网页所需的最少字段。 */
export type TabSessionItem = {
  url: string;
  title?: string;
  envId?: string;
  active?: boolean;
};

const CAP = 30;

function tabsPath(configDir: string): string {
  return join(configDir, "tabs.json");
}

export function loadTabs(configDir: string, cap = CAP): TabSessionItem[] {
  const p = tabsPath(configDir);
  if (!existsSync(p)) return [];
  try {
    // 手改或 PowerShell 写出的文件可能带 BOM，JSON.parse 会直接抛，不能据此当成空会话。
    const text = readFileSync(p, "utf8").replace(/^\uFEFF/, "");
    const raw = JSON.parse(text) as unknown;
    const list = Array.isArray(raw) ? raw : [];
    return list
      .filter(
        (t): t is TabSessionItem =>
          Boolean(t && typeof t === "object" && typeof (t as TabSessionItem).url === "string"),
      )
      .map((t) => ({
        url: String(t.url || "").trim(),
        title: typeof t.title === "string" ? t.title : "",
        envId: typeof t.envId === "string" && t.envId ? t.envId : undefined,
        active: t.active === true,
      }))
      .filter((t) => Boolean(t.url) && t.url !== "about:blank")
      .slice(0, cap);
  } catch {
    return [];
  }
}

export function saveTabs(configDir: string, items: TabSessionItem[], cap = CAP): void {
  mkdirSync(configDir, { recursive: true });
  writeFileSync(tabsPath(configDir), JSON.stringify(items.slice(0, cap), null, 2), "utf8");
}
