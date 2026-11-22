import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

type El = {
  tagName: string;
  className: string;
  textContent: string;
  value: string;
  hidden: boolean;
  alt: string;
  placeholder: string;
  dataset: Record<string, string>;
  attrs: Record<string, string>;
  listeners: Record<string, Array<(event?: { key?: string; shiftKey?: boolean; preventDefault?: () => void }) => void>>;
  children: El[];
  click: () => void;
  firstChild: El | undefined;
  appendChild: (child: El) => El;
  removeChild: (child: El) => El;
  setAttribute: (name: string, value: string) => void;
  addEventListener: (type: string, fn: () => void) => void;
};

function createEl(tag: string): El {
  const children: El[] = [];
  const el = {
    tagName: tag.toUpperCase(),
    className: "",
    textContent: "",
    value: "",
    hidden: false,
    alt: "",
    placeholder: "",
    dataset: {},
    attrs: {},
    listeners: {} as El["listeners"],
    style: {} as Record<string, string>,
    children,
    click: () => undefined,
    get firstChild() {
      return children[0];
    },
    appendChild(child: El) {
      children.push(child);
      return child;
    },
    removeChild(child: El) {
      const at = children.indexOf(child);
      if (at >= 0) children.splice(at, 1);
      return child;
    },
    setAttribute(name: string, value: string) {
      el.attrs[name] = value;
    },
    addEventListener(type: string, fn: (event?: { key?: string; shiftKey?: boolean; preventDefault?: () => void }) => void) {
      if (type === "click") el.click = fn as () => void;
      if (!el.listeners[type]) el.listeners[type] = [];
      el.listeners[type].push(fn);
    },
  };
  return el;
}

function walk(nodes: El[]): El[] {
  const found: El[] = [];
  for (const node of nodes) {
    found.push(node);
    found.push(...walk(node.children || []));
  }
  return found;
}

function load(shell: Record<string, unknown>) {
  const html = readFileSync(join(process.cwd(), "src/renderer/shell.html"), "utf8");
  const start = html.indexOf("let workbenchChat");
  const end = html.indexOf("function renderChrome");
  const room = createEl("div");
  const head = createEl("head");
  const composer = createEl("div");
  composer.className = "composer";
  const document = {
    head,
    activeElement: null as El | null,
    createElement: createEl,
    querySelector(selector: string) {
      if (selector === ".composer") return composer;
      return null;
    },
    getElementById(id: string) {
      if (id === "commandRoom") return room;
      if (id === "workbenchStyle") return walk(head.children).find((node) => node.tagName === "STYLE") || null;
      return null;
    },
  };
  const chromeState = {
    tabs: [{ id: "command-main", kind: "command" }],
    activeId: "command-main",
    overview: [] as Array<Record<string, unknown>>,
    groups: [] as Array<Record<string, unknown>>,
  };
  const api = new Function(
    "document",
    "window",
    "chromeState",
    `${html.slice(start, end)}
     return { renderCommandRoom, closeWorkbenchGroup, setChat(turns) { workbenchChat = turns; } };`,
  )(document, { sparkShell: shell }, chromeState) as {
    renderCommandRoom: () => void;
    closeWorkbenchGroup: (group: { title?: string; children?: Array<{ taskId?: string; state?: string }> }) => Promise<void>;
    setChat: (turns: Array<Record<string, unknown>>) => void;
  };
  return {
    source: html.slice(start, end),
    render: api.renderCommandRoom,
    closeGroup: api.closeWorkbenchGroup,
    setChat: api.setChat,
    room,
    head,
    composer,
    chromeState,
    document,
  };
}

afterEach(() => {
  delete (globalThis as { askConfirm?: unknown }).askConfirm;
});

describe("工作台壳渲染真实数据", () => {
  it("卡片、组标和四色来自总览，源码里没有演示假数据", () => {
    const { source, render, room, head, chromeState } = load({});
    const withoutHint = source.replace("试试：多平台比价 iPhone 17", "");
    expect(source).not.toContain("小红书");
    expect(withoutHint).not.toContain("iPhone");
    expect(source).not.toContain("查询多平台手机价格");
    chromeState.overview = [
      { tabId: "jd", taskId: "t1", title: "京东商品", taskTitle: "查到手价", step: "对照优惠券", agentName: "甲", tone: "green", state: "running" },
      { tabId: "pdd", taskId: "t2", title: "拼多多商品", taskTitle: "查到手价", step: "停在确认优惠", agentName: "乙", tone: "yellow", state: "waiting_human" },
      { tabId: "weibo", taskId: "", title: "微博", taskTitle: "", step: "静止／无 Agent", agentName: "", tone: "gray", state: "idle" },
    ];
    chromeState.groups = [{ groupId: "g1", title: "比价", children: [{ tabId: "jd", taskId: "t1" }, { tabId: "pdd", taskId: "t2" }] }];
    render();
    const nodes = walk(room.children);
    const caps = nodes.filter((node) => node.className === "wb-cap").map((node) => node.textContent);
    expect(caps).toEqual(["比价", "比价"]);
    const cards = nodes.filter((node) => node.dataset.tab);
    expect(cards.map((node) => node.dataset.tone)).toEqual(["green", "yellow", "gray"]);
    expect(cards.map((node) => node.className)).toEqual(["wb-open run", "wb-open wait", "wb-open idle"]);
    expect(cards[0]?.children.map((node) => node.textContent)).toEqual(["京东商品", "查到手价", "对照优惠券", "甲"]);
    expect(cards[2]?.children.map((node) => node.textContent)).toEqual(["微博", "页面空闲", "静止／无 Agent", "无 Agent 使用"]);
    const style = walk(head.children).find((node) => node.tagName === "STYLE");
    expect(style?.textContent).toContain("@media (max-width:1080px)");
    expect(style?.textContent).toContain("grid-template-columns:1fr");
  });

  it("点卡片只切页，点对话里的结果才知悉并回到原任务", () => {
    const switched: string[] = [];
    const acked: string[] = [];
    const focused: string[] = [];
    const { render, room, chromeState } = load({
      switchTab(id: string) { switched.push(id); },
      ackTask(id: string) { acked.push(id); },
      focusTask(id: string) { focused.push(id); },
    });
    chromeState.overview = [
      { tabId: "page", taskId: "job", title: "商品", taskTitle: "已改完", step: "待验收", agentName: "甲", tone: "gray", state: "done", attention: true },
    ];
    render();
    const nodes = walk(room.children);
    nodes.find((node) => node.dataset.tab === "page")?.click();
    expect(switched).toEqual(["page"]);
    expect(acked).toEqual([]);
    nodes.find((node) => node.className === "wb-note")?.click();
    expect(acked).toEqual(["job"]);
    expect(focused).toEqual(["job"]);
    expect(nodes.some((node) => node.className === "wb-ack")).toBe(true);
  });

  it("连续渲染两次卡片不翻倍", () => {
    const { render, room, chromeState } = load({});
    chromeState.overview = [
      { tabId: "only", taskId: "t", title: "只此一张", taskTitle: "任务", step: "在做", agentName: "甲", tone: "green", state: "running" },
    ];
    render();
    render();
    const cards = walk(room.children).filter((node) => node.dataset.tab === "only");
    expect(cards).toHaveLength(1);
  });

  it("组标显示完成数，未全部完成时不写全部完成", () => {
    const { render, room, chromeState } = load({});
    const states = ["done", "done", "closed", "failed", "running"];
    chromeState.overview = states.map((state, index) => ({
      tabId: "p" + index,
      taskId: "k" + index,
      title: "页" + index,
      taskTitle: "任务",
      step: "",
      agentName: "甲",
      tone: "gray",
      state,
    }));
    chromeState.groups = [{
      groupId: "g",
      title: "比价",
      allDone: false,
      headline: "有页面异常或未完成",
      children: states.map((state, index) => ({ tabId: "p" + index, taskId: "k" + index, state })),
    }];
    render();
    const nodes = walk(room.children);
    const progress = nodes.find((node) => node.className === "wb-progress");
    expect(progress?.textContent).toBe("3/5 · 1 异常");
    expect(nodes.some((node) => String(node.textContent).includes("全部完成"))).toBe(false);
  });

  it("组进度：全部完成、部分失败、进行中三种", () => {
    const { render, room, chromeState } = load({});
    const paint = (states: string[]) => {
      chromeState.overview = states.map((state, index) => ({
        tabId: "p" + index,
        taskId: "k" + index,
        title: "页" + index,
        taskTitle: "任务",
        tone: "gray",
        state,
      }));
      chromeState.groups = [{
        title: "比价",
        children: states.map((state, index) => ({ tabId: "p" + index, taskId: "k" + index, state })),
      }];
      render();
      return walk(room.children).find((node) => node.className === "wb-progress")?.textContent;
    };
    expect(paint(["done", "done"])).toBe("2/2");
    expect(paint(["failed", "failed"])).toBe("0/2 · 2 异常");
    expect(paint(["running", "running"])).toBe("0/2");
  });

  it("指挥室只放总览，同一份对话不在中间再画一栏", () => {
    const { render, room, setChat, composer } = load({});
    setChat([
      { role: "user", text: "打开头条", images: ["data:image/png;base64,aaa"], quotes: [{ title: "商品页" }] },
      { role: "assistant", text: "请先在设置里配置模型。" },
    ]);
    render();
    const nodes = walk(room.children);
    expect(nodes.some((node) => node.className.startsWith("wb-bubble"))).toBe(false);
    expect(nodes.some((node) => node.tagName === "TEXTAREA")).toBe(false);
    expect(nodes.some((node) => node.tagName === "IMG")).toBe(false);
    expect(nodes.some((node) => node.textContent === "发送")).toBe(false);
    expect(nodes.some((node) => node.textContent.includes("请先在设置里配置模型"))).toBe(false);
    expect(composer.hidden).toBe(false);
  });

  it("关闭这一组先确认，进行中的先停再逐页关闭", async () => {
    const stopped: string[] = [];
    const closed: string[] = [];
    const asks: string[] = [];
    const { closeGroup } = load({
      stopTask(id: string) { stopped.push(id); return Promise.resolve({ ok: true }); },
      closeTask(id: string) { closed.push(id); return Promise.resolve({ ok: true }); },
    });
    const group = {
      title: "比价",
      children: [
        { taskId: "run", state: "running" },
        { taskId: "wait", state: "waiting_human" },
        { taskId: "done", state: "done" },
      ],
    };
    (globalThis as { askConfirm?: (message: string) => Promise<boolean> }).askConfirm = async (message) => {
      asks.push(message);
      return false;
    };
    await closeGroup(group);
    expect(asks[0]).toContain("比价");
    expect(stopped).toEqual([]);
    expect(closed).toEqual([]);
    (globalThis as { askConfirm?: (message: string) => Promise<boolean> }).askConfirm = async () => true;
    await closeGroup(group);
    expect(stopped).toEqual(["run", "wait"]);
    expect(closed).toEqual(["run", "wait", "done"]);
  });

  it("侧栏正在打字时总览照样更新，不碰侧栏输入框", () => {
    const { render, room, chromeState, document } = load({});
    const sidebar = {
      id: "chatInput",
      tagName: "TEXTAREA",
      value: "半句还没发",
      closest: (selector: string) => (selector === ".composer" ? sidebar : null),
    };
    document.activeElement = sidebar as unknown as typeof document.activeElement;
    chromeState.overview = [
      { tabId: "toutiao", taskId: "", title: "今日头条", taskTitle: "", step: "静止／无 Agent", agentName: "", tone: "gray", state: "idle" },
    ];
    render();
    const cards = walk(room.children).filter((node) => node.dataset.tab === "toutiao");
    expect(cards).toHaveLength(1);
    expect(document.activeElement).toBe(sidebar);
    expect(sidebar.value).toBe("半句还没发");
    expect(walk(room.children).some((node) => node.tagName === "TEXTAREA")).toBe(false);
  });
});

function loadTaskStrip() {
  const html = readFileSync(join(process.cwd(), "src/renderer/shell.html"), "utf8");
  const start = html.indexOf("function renderTaskStrip");
  const end = html.indexOf("function renderPlanStrip");
  const root = createEl("div");
  root.classList = { add() { return undefined; }, remove() { return undefined; } };
  Object.defineProperty(root, "innerHTML", {
    set(value: string) {
      if (value === "") root.children.splice(0, root.children.length);
    },
  });
  const head = createEl("head");
  const document = {
    head,
    createElement: createEl,
    getElementById(id: string) {
      if (id === "taskStrip") return root;
      if (id === "taskStripStyle") return walk(head.children).find((node) => node.tagName === "STYLE") || null;
      return null;
    },
  };
  const render = new Function(
    "document",
    "window",
    `function statusToneColor() { return "#888"; }
     ${html.slice(start, end)}
     return renderTaskStrip;`,
  )(document, { sparkShell: {} }) as (tasks: Array<Record<string, unknown>>) => void;
  return { render, root };
}

describe("侧栏任务列表", () => {
  it("对话上方不再挂任务状态卡", () => {
    const { render, root } = loadTaskStrip();
    render([
      { id: "job", title: "比价 iPhone 17", state: "running", step: "进行中", updatedAt: 1 },
      { id: "job", title: "比价 iPhone 17", state: "failed", step: "已失败", updatedAt: 2 },
      { id: "other", title: "另一件", state: "running", step: "正在查", updatedAt: 3 },
    ]);
    const cards = walk(root.children).filter((node) => node.className.startsWith("task-card"));
    expect(cards).toHaveLength(0);
  });
});
