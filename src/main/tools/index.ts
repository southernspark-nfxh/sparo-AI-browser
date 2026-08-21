import type { SparkBrowser } from "../browser.js";
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
    navigate: (url: string) => navigateTool(browser, url),
    snapshot: (selector?: string) => snapshotTool(browser, selector),
    click: (target: { ref?: string; selector?: string; caret?: boolean }) =>
      clickTool(browser, target),
    fill: (target: { ref?: string; selector?: string }, value: string) =>
      fillTool(browser, target, value),
    execute: (script: string, opts?: { frame?: number | string }) =>
      browser.execute(script, opts),
    select: (target: { ref?: string; selector?: string }, value: string) =>
      browser.select(target, value),
    upload: (target: { ref?: string; selector?: string }, files: string[]) =>
      browser.upload(target, files),
    click_text: (
      text: string,
      opts?: { exact?: boolean; withinPortal?: boolean; caret?: boolean },
    ) => browser.clickText(text, opts),
    menu_click: (trigger: string, item: string) =>
      browser.menuClick(trigger, item),
    dismiss_overlays: () => browser.dismissOverlays(),
    list_portals: () => browser.listPortals(),
    start_recording: (meta?: { platform?: string; task?: string }) =>
      browser.startRecording(meta),
    stop_recording: (title?: string) => browser.stopRecording(title),
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
  screenshot: (label?: string) => browser.screenshot(label),
  diagnose: (label?: string) => browser.diagnose(label),
  save_sessions: (siteIds?: string[]) => browser.saveSessions(siteIds),
  list_sessions: () => browser.listSessions(),
  analyze_page: () => browser.analyzePage(),
  execute_primitives: (input: {
    payload: Record<string, unknown>;
    url?: string;
    includeOptional?: boolean;
    maxAttempts?: number;
  }) => browser.executePrimitives(input),
  cs_scan: () => browser.csScan(),
  cs_draft_reply: (input?: {
    draft?: string;
    fill?: boolean;
    preferLlm?: boolean;
  }) => browser.csDraftReply(input),
  new_tab: (url?: string) => browser.newTab(url),
    close_tab: (id: string) => browser.closeTab(id),
    switch_tab: (id: string) => browser.switchTab(id),
    list_tabs: async () => ({
      ok: true,
      message: "tabs",
      data: browser.listTabs(),
    }),
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
    get_url: async () => ({
      ok: true,
      message: browser.getUrl(),
      data: { url: browser.getUrl() },
    }),
    get_title: async () => ({
      ok: true,
      message: browser.getTitle(),
      data: { title: browser.getTitle() },
    }),
    contains_text: (text: string) => browser.containsText(text),
    page_text: () => browser.pageText(),
    reload: () => browser.reload(),
    go_back: () => browser.goBack(),
    go_forward: () => browser.goForward(),
    pause: async () => {
      browser.setPaused(true);
      return { ok: true, message: "Agent paused" };
    },
    resume: async () => {
      browser.setPaused(false);
      return { ok: true, message: "Agent resumed" };
    },
    list_workflows: async () => ({
      ok: true,
      message: `workflows: ${listWorkflowSummaries().length}`,
      data: { workflows: listWorkflowSummaries() },
    }),
    run_workflow: (id: string) => runWorkflow(browser, id),
  };
}

export type ToolHandlers = ReturnType<typeof createToolHandlers>;
