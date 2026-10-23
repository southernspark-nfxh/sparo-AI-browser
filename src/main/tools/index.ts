import type { SparkBrowser } from "../browser.js";
import { ownerForTab } from "../agent/mcp-sessions.js";
import { navigateTool } from "./navigate.js";
import { snapshotTool } from "./snapshot.js";
import { clickTool } from "./click.js";
import { fillTool } from "./fill.js";
import {
  listWorkflowSummaries,
  runWorkflow,
} from "../workflows/dianxiaomi.js";

export function createToolHandlers(browser: SparkBrowser) {
  return {
    navigate: (url: string, tabId?: string) =>
      browser.watchPageTool(
        "navigate",
        tabId ? { url, tabId } : { url },
        () => navigateTool(browser, url, tabId),
        tabId,
      ),
    snapshot: (selector?: string, tabId?: string) => snapshotTool(browser, selector, tabId),
    click: (target: { ref?: string; selector?: string; caret?: boolean }, tabId?: string) =>
      browser.watchPageTool(
        "click",
        tabId ? { ...target, tabId } : (target as Record<string, unknown>),
        () => clickTool(browser, target, tabId),
        tabId,
      ),
    fill: (target: { ref?: string; selector?: string }, value: string, tabId?: string) =>
      browser.watchPageTool(
        "fill",
        tabId ? { ...target, value, tabId } : ({ ...target, value } as Record<string, unknown>),
        () => fillTool(browser, target, value, tabId),
        tabId,
      ),
    execute: (script: string, opts?: { frame?: number | string }) =>
      browser.execute(script, opts),
    select: (target: { ref?: string; selector?: string }, value: string) =>
      browser.select(target, value),
    upload: (target: { ref?: string; selector?: string }, files: string[]) =>
      browser.upload(target, files),
    click_text: (
      text: string,
      opts?: { exact?: boolean; withinPortal?: boolean; caret?: boolean },
    ) =>
      browser.watchPageTool("click_text", { text, ...opts }, () =>
        browser.clickText(text, opts),
      ),
    menu_click: (trigger: string, item: string) =>
      browser.menuClick(trigger, item),
    dismiss_overlays: () => browser.dismissOverlays(),
    list_portals: () => browser.listPortals(),
  list_skills: () => browser.listSkillsTool(),
  get_skill: (id: string) => browser.getSkillTool(id),
  match_skill: (query: string) => browser.matchSkillTool(query),
  run_skill: (input: {
    id?: string;
    query?: string;
    params?: Record<string, unknown>;
    dryRun?: boolean;
  }) => browser.runSkillTool(input),
  sparo_info: () => browser.sparoInfoTool(),
  xhs_scroll_bottom: () => browser.xhsScrollBottom(),
  xhs_add_topics: (topics: string[]) => browser.xhsAddTopics(topics),
  xhs_pick_cover: () => browser.xhsPickCover(),
  xhs_click_publish: () => browser.xhsClickPublish(),
  xhs_ensure_editor: () => browser.xhsEnsureEditor(),
  xhs_page_stage: () => browser.xhsPageStage(),
  xhs_inject_compose: (input: {
    title?: string;
    body?: string;
    force?: boolean;
  }) => browser.xhsInjectCompose(input),
  xhs_inject_publish: (input: { summary?: string; topics?: string[] }) =>
    browser.xhsInjectPublish(input),
  xhs_layout_next: (input?: { template?: string; timeoutMs?: number }) =>
    browser.xhsLayoutNext(input),
  screenshot: (input?: string | {
    label?: string;
    selector?: string;
    clip?: { x: number; y: number; width: number; height: number };
    fullPage?: boolean;
    format?: "png" | "jpeg";
    quality?: number;
    includeBase64?: boolean;
  }) => browser.screenshot(typeof input === "string" ? input : { ...input, includeBase64: true }),
  describe_page: (question?: string) => browser.describePage(question),
  diagnose: (label?: string) => browser.diagnose(label),
  save_sessions: (siteIds?: string[]) => browser.saveSessions(siteIds),
  list_sessions: () => browser.listSessions(),
  analyze_page: () => browser.analyzePage(),
  execute_primitives: (input: {
    payload: Record<string, unknown>;
    url?: string;
    includeOptional?: boolean;
    maxAttempts?: number;
    tabId?: string;
  }) => browser.executePrimitives(input),
  pick_calendar: (input: {
    triggerRef?: string;
    triggerText?: string;
    triggerLabel?: string;
    date?: string;
    hours?: string | number;
    minutes?: string | number;
    dismiss?: "outside" | "escape";
    value?: unknown;
    tabId?: string;
  }) => browser.pickCalendar(input),
  press: (key: string, tabId?: string) => browser.pressKey(key, tabId),
  fill_suggest: (value: string, target?: { ref?: string; selector?: string }, tabId?: string) =>
    browser.fillSuggest(value, target, tabId),
  cs_scan: () => browser.csScan(),
  cs_draft_reply: (input?: {
    draft?: string;
    fill?: boolean;
    preferLlm?: boolean;
  }) => browser.csDraftReply(input),
  cs_one_click_reply: () => browser.csOneClickReply(),
  feishu_page_stage: () => browser.feishuPageStage(),
  feishu_ensure_messenger: () => browser.feishuEnsureMessenger(),
  feishu_open_chat: (input: { to?: string }) => browser.feishuOpenChat(input),
  feishu_inject_chat: (input: { body?: string }) => browser.feishuInjectChat(input),
  feishu_inject_journal: (input: { title?: string; body?: string }) =>
    browser.feishuInjectJournal(input),
  feishu_work: (input?: {
    kind?: string;
    to?: string;
    title?: string;
    body?: string;
  }) => browser.feishuWork(input),
  new_tab: (url?: string) => browser.newTab(url),
  create_agent_tab: (url?: string) => browser.createAgentTab(url),
  tab_ids: () => browser.listTabs().tabs.map((tab) => tab.id),
  background_running: () => {
    const pool = (browser as unknown as { taskPool?: { runningBackground?: () => number } }).taskPool;
    try {
      return pool?.runningBackground?.() ?? 0;
    } catch {
      return 0;
    }
  },
    close_tab: (id: string) => browser.closeTab(id),
    switch_tab: (id: string) => browser.switchTab(id),
    list_tabs: async () => {
      const listed = browser.listTabs();
      return {
        ok: true,
        message: "tabs",
        data: {
          ...listed,
          tabs: listed.tabs.map((tab) => ({ ...tab, owner: ownerForTab(tab.id) })),
        },
      };
    },
    discard_inactive_tabs: () => browser.discardInactiveTabs(),
    request_approval: (action: string, reason: string, risk?: string) =>
      browser.requestApproval({ action, reason, risk }),
    wait_for: (input: {
      selector?: string;
      text?: string;
      ref?: string;
      timeoutMs?: number;
      all?: boolean;
    }) => browser.waitFor(input),
    qa_check: () => browser.qaCheck(),
    qa_gate: () => browser.qaGate(),
    sidebar_chat: (text: string, hands?: boolean) =>
      browser.sidebarChatTool(text, { hands }),
    get_url: async (tabId?: string) => ({
      ok: true,
      message: browser.getUrl(tabId),
      data: { url: browser.getUrl(tabId) },
    }),
    get_title: async (tabId?: string) => ({
      ok: true,
      message: browser.getTitle(tabId),
      data: { title: browser.getTitle(tabId) },
    }),
    contains_text: (text: string) => browser.containsText(text),
    page_text: (tabId?: string) => browser.pageText(tabId),
    reload: (tabId?: string) => browser.reload(tabId ? { tabId } : undefined),
    go_back: (tabId?: string) => browser.goBack(tabId ? { tabId } : undefined),
    go_forward: (tabId?: string) => browser.goForward(tabId ? { tabId } : undefined),
    pause: async () => {
      browser.setPaused(true);
      return { ok: true, message: "Agent paused" };
    },
    resume: async () => {
      browser.setPaused(false);
      return { ok: true, message: "Agent resumed" };
    },
    learning_skip: () => browser.skipLearning(),
    learning_answer: (text: string) => browser.answerLearning(text),
    list_workflows: async () => ({
      ok: true,
      message: `workflows: ${listWorkflowSummaries().length}`,
      data: { workflows: listWorkflowSummaries() },
    }),
    run_workflow: (id: string) => runWorkflow(browser, id),
  };
}

export type ToolHandlers = ReturnType<typeof createToolHandlers>;
