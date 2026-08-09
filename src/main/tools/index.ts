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
    execute: (script: string) => browser.execute(script),
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
