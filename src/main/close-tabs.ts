export type CloseTabPick = {
  id: string;
  url?: string;
  title?: string;
};

export type CloseTabChoice =
  | { ok: true; ids: string[] }
  | { ok: false; message: string };

/**
 * 选出要关的标签。
 * match 命中的全部关掉，包括当前页。
 * keepActive 只有显式为 true 才留着当前页（用户说「关掉其他的」）。
 * 批量关闭必须带 match 或 id，避免漏参数把除当前页以外的标签清掉。
 * 单关按 match 时只关第一个。批量时跳过工作台和阅读页。
 */
export function pickTabsToClose(input: {
  tabs: CloseTabPick[];
  activeId: string;
  studioId?: string | null;
  readerId?: string | null;
  id?: string;
  match?: string;
  batch: boolean;
  keepActive?: boolean;
}): CloseTabChoice {
  const id = String(input.id || "").trim();
  const match = String(input.match || "").trim().toLowerCase();
  const keepActive = input.keepActive === true;
  const hits = (tab: CloseTabPick) =>
    `${tab.url || ""}\n${tab.title || ""}`.toLowerCase().includes(match);

  if (input.batch && !id && !match) {
    return { ok: false, message: "批量关闭要带上 match，说明要关的站点或标题" };
  }

  let targets: CloseTabPick[] = [];
  if (id) {
    const found = input.tabs.find((tab) => tab.id === id);
    if (!found) return { ok: false, message: `没有这个标签页：${id}` };
    targets = [found];
  } else if (match) {
    targets = input.tabs.filter((tab) => hits(tab));
    if (keepActive) {
      const kept = targets.some((tab) => tab.id === input.activeId);
      targets = targets.filter((tab) => tab.id !== input.activeId);
      if (!targets.length) {
        return {
          ok: false,
          message: kept ? "当前页已保留，没有其他匹配的标签页" : `没有匹配「${match}」的标签页`,
        };
      }
    } else if (!targets.length) {
      return { ok: false, message: `没有匹配「${match}」的标签页` };
    }
    if (!input.batch) targets = targets.slice(0, 1);
  } else {
    return { ok: false, message: "没有可关闭的标签页" };
  }

  if (input.batch) {
    targets = targets.filter((tab) => tab.id !== input.studioId && tab.id !== input.readerId);
  }
  if (!targets.length) return { ok: false, message: "没有可关闭的标签页" };
  return { ok: true, ids: targets.map((tab) => tab.id) };
}
