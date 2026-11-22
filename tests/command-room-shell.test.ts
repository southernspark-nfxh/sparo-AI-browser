import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

type Node = {
  tagName: string;
  className: string;
  hidden: boolean;
  draggable: boolean;
  dataset: Record<string, string>;
  style: { cssText?: string };
  textContent: string;
  title: string;
  type: string;
  value?: string;
  disabled?: boolean;
  children: Node[];
  firstChild: Node | null;
  appendChild: (child: Node) => Node;
  append: (...nodes: Node[]) => void;
  removeChild: (child: Node) => Node;
  addEventListener: () => void;
  querySelector: (selector: string) => Node | null;
  querySelectorAll: (selector: string) => Node[];
  replaceWith: () => void;
  onclick: ((event: { stopPropagation: () => void }) => void) | null;
};

function createEl(tag: string): Node {
  const children: Node[] = [];
  const el = {
    tagName: tag.toUpperCase(),
    className: "",
    hidden: false,
    draggable: false,
    dataset: {},
    style: {},
    textContent: "",
    title: "",
    type: "",
    children,
    firstChild: null as Node | null,
    onclick: null,
    classList: {
      add() {},
      remove() {},
      toggle() {},
    },
    appendChild(child: Node) {
      children.push(child);
      el.firstChild = children[0] || null;
      return child;
    },
    append(...nodes: Node[]) {
      for (const node of nodes) el.appendChild(node);
    },
    removeChild(child: Node) {
      const index = children.indexOf(child);
      if (index >= 0) children.splice(index, 1);
      el.firstChild = children[0] || null;
      return child;
    },
    addEventListener() {},
    querySelector(selector: string) {
      return el.querySelectorAll(selector)[0] || null;
    },
    querySelectorAll(selector: string) {
      const found: Node[] = [];
      const visit = (node: Node) => {
        if (selector === "img" && node.tagName === "IMG") found.push(node);
        if (selector === "button[data-tab]" && node.tagName === "BUTTON" && node.dataset.tab) found.push(node);
        for (const child of node.children) visit(child);
      };
      for (const child of children) visit(child);
      return found;
    },
    replaceWith() {},
  } as Node;
  return el;
}

function loadRenderChrome() {
  const html = readFileSync(join(process.cwd(), "src/renderer/shell.html"), "utf8");
  const start = html.indexOf("function agentStateLabel");
  const end = html.indexOf("function navigateFromBar");
  const src = html.slice(start, end);
  const room = createEl("div");
  const tabsEl = createEl("div");
  const urlEl = createEl("input");
  const document = {
    activeElement: null as Node | null,
    createElement: createEl,
    getElementById(id: string) {
      if (id === "commandRoom") return room;
      if (id === "btnMemory") return createEl("button");
      return null;
    },
  };
  const chromeState = {
    tabs: [] as Array<Record<string, unknown>>,
    activeId: "",
    overview: [] as Array<Record<string, unknown>>,
    url: "",
    canGoBack: false,
    canGoForward: false,
    isLoading: false,
    currentBookmarked: false,
    memoryBoard: "",
  };
  const renderChrome = new Function(
    "document",
    "window",
    "chromeState",
    "tabsEl",
    "urlEl",
    "backEl",
    "forwardEl",
    "reloadEl",
    "starEl",
    `function t(key) { return key; }
     function globeFallback() { return document.createElement("span"); }
     function renderAgentBanner() {}
     let draggingTabId = "";
     ${src}
     return renderChrome;`,
  )(document, { sparkShell: { switchTab() {}, closeTab() {}, newTab() {}, reorderTabs() {} } }, chromeState, tabsEl, urlEl, createEl("button"), createEl("button"), createEl("button"), createEl("button"));
  return { renderChrome: renderChrome as () => void, chromeState, tabsEl, room, urlEl };
}

describe("指挥室壳层真的执行渲染", () => {
  it("指挥室标签不会在关闭按钮创建前访问它，恶意标题也不会变成节点", () => {
    const { renderChrome, chromeState, tabsEl, room } = loadRenderChrome();
    chromeState.tabs = [
      { id: "command-main", kind: "command", title: "指挥室", url: "" },
      { id: "web", kind: "web", title: "普通页", url: "https://example.com", owner: "user" },
    ];
    chromeState.activeId = "command-main";
    chromeState.overview = [
      {
        tabId: "web",
        title: '<img src=x onerror=alert(1)>',
        agentName: '"><button data-tab="evil">',
        step: "<script>alert(1)</script>",
      },
    ];
    expect(() => renderChrome()).not.toThrow();
    expect(tabsEl.children.map((node) => node.dataset.id || node.className)).toContain("command-main");
    expect(tabsEl.children.map((node) => node.dataset.id || node.className)).toContain("web");
    const command = tabsEl.children.find((node) => node.dataset.id === "command-main");
    const closer = command?.children.find((node) => node.className === "x");
    expect(closer?.hidden).toBe(true);
    expect(room.querySelector("img")).toBeNull();
    expect(room.querySelectorAll("button[data-tab]")).toHaveLength(1);
    const button = room.querySelectorAll("button[data-tab]")[0];
    const text = (button?.children || []).map((node) => node.textContent).join("");
    expect(text).toContain("<img src=x onerror=alert(1)>");
    expect(text).toContain("<script>alert(1)</script>");
    expect(button?.dataset.tab).toBe("web");
    expect(button?.dataset.tone).toBe("gray");
    expect(button?.style.cssText || "").not.toContain("agentColor");
  });
});
