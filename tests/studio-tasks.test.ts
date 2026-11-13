import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createEnv } from "../src/main/envs/store.js";
import {
  FIXTURE_MARK,
  explainFailure,
  isFixturePath,
  loadTasks,
  nextActions,
  projectTasks,
  readJsonl,
  studioLedgerDir,
  toPageModel,
  userStageFrom,
} from "../src/main/studio-tasks.js";
import type { TaskChangedEvent } from "../src/renderer/studio/types.js";
import type { PageActions } from "../src/renderer/studio/types.js";
import {
  FIXTURE_MARK as LEDGER_FIXTURE,
  appendLegacyLedger,
  appendStudioEvent,
  defaultLedgerPath,
  readLedgerLines,
} from "../strategies/skills/social-media-publish/scripts/ledger.mjs";
import { planSteps } from "../strategies/skills/social-media-publish/scripts/engine.mjs";

const fakeDom = vi.hoisted(() => {
  type Listener = (event: { type: string; target: FakeNode }) => void;
  class FakeNode {
    tag: string;
    className = "";
    children: FakeNode[] = [];
    parentElement: FakeNode | null = null;
    attrs = new Map<string, string>();
    listeners = new Map<string, Set<Listener>>();
    hidden = false;
    disabled = false;
    value = "";
    title = "";
    type = "";
    id = "";
    private text = "";

    constructor(tag: string) {
      this.tag = tag;
    }

    get textContent(): string {
      if (this.children.length) return this.children.map((child) => child.textContent).join("");
      return this.text;
    }

    set textContent(value: string) {
      this.text = value == null ? "" : String(value);
      for (const child of this.children) child.parentElement = null;
      this.children = [];
    }

    setAttribute(name: string, value: string): void {
      this.attrs.set(name, String(value));
    }

    getAttribute(name: string): string | null {
      return this.attrs.has(name) ? this.attrs.get(name) || "" : null;
    }

    removeAttribute(name: string): void {
      this.attrs.delete(name);
    }

    append(...nodes: FakeNode[]): void {
      for (const node of nodes) {
        node.parentElement = this;
        this.children.push(node);
      }
    }

    replaceChildren(...nodes: FakeNode[]): void {
      for (const child of this.children) child.parentElement = null;
      this.children = [];
      if (nodes.length) this.append(...nodes);
    }

    addEventListener(type: string, fn: Listener): void {
      const set = this.listeners.get(type) || new Set<Listener>();
      set.add(fn);
      this.listeners.set(type, set);
    }

    removeEventListener(type: string, fn: Listener): void {
      this.listeners.get(type)?.delete(fn);
    }

    listenerCount(type: string): number {
      return this.listeners.get(type)?.size || 0;
    }

    matches(selector: string): boolean {
      const sel = selector.trim();
      if (sel.startsWith(".")) return this.className.split(/\s+/).includes(sel.slice(1));
      if (sel.startsWith("[") && sel.endsWith("]")) {
        const body = sel.slice(1, -1);
        const eq = body.indexOf("=");
        if (eq < 0) return this.attrs.has(body);
        const name = body.slice(0, eq);
        const expected = body.slice(eq + 1).replace(/^["']|["']$/g, "");
        return this.getAttribute(name) === expected;
      }
      return this.tag === sel;
    }

    querySelectorAll(selector: string): FakeNode[] {
      const found: FakeNode[] = [];
      const walk = (node: FakeNode) => {
        for (const child of node.children) {
          if (child.matches(selector)) found.push(child);
          walk(child);
        }
      };
      walk(this);
      return found;
    }

    querySelector(selector: string): FakeNode | null {
      return this.querySelectorAll(selector)[0] || null;
    }

    click(): void {
      const event = { type: "click", target: this };
      const set = this.listeners.get("click");
      if (set) for (const fn of [...set]) fn(event);
    }
  }

  function fakeEl(tag: string, className?: string, text?: string): FakeNode {
    const node = new FakeNode(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  return { FakeNode, fakeEl };
});

vi.mock("../src/renderer/studio/dom.ts", async () => {
  const actual = await vi.importActual<typeof import("../src/renderer/studio/dom.ts")>("../src/renderer/studio/dom.ts");
  return { ...actual, el: fakeDom.fakeEl };
});

const { formatWhen, mount } = await import("../src/renderer/studio/pages/tasks.ts");

let configDir = "";
let envA = "";
let envB = "";

beforeAll(() => {
  configDir = mkdtempSync(join(tmpdir(), "studio-task-env-"));
  envA = createEnv(configDir, { account: { type: "other", name: "第二环境" } }).id;
  envB = createEnv(configDir, { account: { type: "other", name: "另一个" } }).id;
});

afterAll(() => {
  rmSync(configDir, { recursive: true, force: true });
});

afterEach(() => {
  vi.useRealTimers();
});

function tempFile(): string {
  const dir = mkdtempSync(join(tmpdir(), "studio-task-ledger-"));
  return join(dir, "tasks.jsonl");
}

function studio(partial: Record<string, unknown>): Record<string, unknown> {
  return { fixture: FIXTURE_MARK, occurredAt: "2026-11-12T02:30:00.000Z", ...partial };
}

function confirm(envId: string, runId: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return studio({
    eventId: "evt-" + runId,
    eventType: "studio.run.confirmed",
    envId,
    runId,
    draftId: "draft-1",
    draftRevision: 1,
    snapshotHash: "hash-" + runId,
    precheckId: "pre-" + runId,
    confirmationId: "cfm-" + runId,
    confirmedAt: "2026-11-12T02:30:00.000Z",
    title: "标题 A",
    body: "正文",
    platforms: ["toutiao", "baijiahao", "sohu"],
    ...extra,
  });
}

function job(envId: string, runId: string, jobId: string, platform: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return studio({
    eventId: "evt-" + jobId,
    eventType: "studio.job.updated",
    envId,
    runId,
    jobId,
    draftId: "draft-1",
    platform,
    stage: "发布失败",
    currentStep: "setCover",
    submitState: "not_submitted",
    ...extra,
  });
}

async function writeEvents(file: string, events: Record<string, unknown>[]): Promise<void> {
  for (const event of events) {
    const saved = await appendStudioEvent(file, event);
    expect(saved.ok, JSON.stringify(saved)).toBe(true);
  }
}

function actions(partial: Partial<PageActions> = {}): PageActions {
  return {
    navigate: () => undefined,
    reload: async () => undefined,
    saveDraft: async () => ({ ok: false, code: "unsupported", message: "", envId: "" }),
    precheck: async () => ({ ok: false, code: "unsupported", message: "", envId: "" }),
    confirm: async () => ({ ok: false, code: "unsupported", message: "", envId: "" }),
    pickImages: async () => ({ ok: false, code: "unsupported", message: "", envId: "" }),
    checkAccounts: async () => ({ ok: false, code: "unsupported", message: "", envId: "" }),
    openAccount: async () => ({ ok: false, code: "unsupported", message: "", envId: "" }),
    refreshMetrics: async () => ({ ok: false, code: "unsupported", message: "", envId: "" }),
    openTask: async () => ({ ok: false, code: "unsupported", message: "打开任务还没有接入，不会发布。", envId: "" }),
    verifyTask: async () => ({ ok: false, code: "unsupported", message: "核验还没有接入，不会发布。", envId: "" }),
    resumeTask: async () => ({ ok: false, code: "unsupported", message: "续跑还没有接入，不会发布。", envId: "" }),
    fillReply: async () => ({ ok: false, code: "unsupported", message: "", envId: "" }),
    onTasksChanged: () => () => undefined,
    ...partial,
  };
}

function scenario(): Record<string, unknown>[] {
  return [
    confirm(envA, "run-1"),
    confirm(envA, "run-2", {
      draftRevision: 2,
      snapshotHash: "hash-2",
      confirmedAt: "2026-11-12T03:00:00.000Z",
      occurredAt: "2026-11-12T03:00:00.000Z",
    }),
    job(envA, "run-1", "job-bj", "baijiahao", { stage: "已发布", currentStep: "verify", submitState: "verified" }),
    studio({
      eventId: "evt-receipt-bj",
      eventType: "studio.receipt.verified",
      envId: envA,
      runId: "run-1",
      jobId: "job-bj",
      platform: "baijiahao",
      verifiedAt: "2026-11-12T02:40:00.000Z",
      occurredAt: "2026-11-12T02:40:00.000Z",
      articleId: "art-bj",
      url: "https://baijia.example/a",
      summary: "已核验回执",
    }),
    job(envA, "run-1", "job-tt", "toutiao", { errorCode: "COVER_NOT_PICKED", hint: "封面没有选上" }),
    studio({
      eventId: "evt-att-1-start",
      eventType: "studio.attempt.started",
      envId: envA,
      runId: "run-1",
      jobId: "job-tt",
      attemptId: "att-1",
      snapshotHash: "hash-run-1",
      fromStep: "setCover",
      startedAt: "2026-11-12T02:31:00.000Z",
      occurredAt: "2026-11-12T02:31:00.000Z",
    }),
    studio({
      eventId: "evt-att-1-end",
      eventType: "studio.attempt.finished",
      envId: envA,
      runId: "run-1",
      jobId: "job-tt",
      attemptId: "att-1",
      endedAt: "2026-11-12T02:32:00.000Z",
      occurredAt: "2026-11-12T02:32:00.000Z",
      error: "COVER_NOT_PICKED",
    }),
    studio({
      eventId: "evt-att-2-start",
      eventType: "studio.attempt.started",
      envId: envA,
      runId: "run-1",
      jobId: "job-tt",
      attemptId: "att-2",
      snapshotHash: "hash-run-1",
      fromStep: "setCover",
      startedAt: "2026-11-12T02:33:00.000Z",
      occurredAt: "2026-11-12T02:33:00.000Z",
    }),
    studio({
      eventId: "evt-att-2-end",
      eventType: "studio.attempt.finished",
      envId: envA,
      runId: "run-1",
      jobId: "job-tt",
      attemptId: "att-2",
      endedAt: "2026-11-12T02:34:00.000Z",
      occurredAt: "2026-11-12T02:34:00.000Z",
      error: "COVER_STILL_MISSING",
    }),
    job(envA, "run-1", "job-sohu", "sohu", {
      stage: "结果待核验",
      currentStep: "publishOrSchedule",
      submitState: "submitted_unknown",
    }),
    confirm(envB, "run-b", { title: "环境乙的稿", draftId: "draft-b", body: "乙的正文", platforms: ["dayu"] }),
  ];
}

describe("发布事件写入口", () => {
  it("相同 eventId 重放不重复追加，并返回已记录的那一行", async () => {
    const file = tempFile();
    const event = confirm(envA, "run-d");
    const first = await appendStudioEvent(file, event);
    const second = await appendStudioEvent(file, { ...event, title: "被改掉的标题" });
    expect(first.appended).toBe(true);
    expect(second.ok).toBe(true);
    expect(second.appended).toBe(false);
    expect(second.code).toBe("duplicate");
    expect(second.row).toEqual(first.row);
    expect(second.row.title).toBe("标题 A");
    expect(readLedgerLines(file)).toHaveLength(1);
  });

  it("同一文件的事件按调用顺序串行追加", async () => {
    const file = tempFile();
    const [first, second] = await Promise.all([
      appendStudioEvent(file, confirm(envA, "run-p1")),
      appendStudioEvent(file, confirm(envA, "run-p2", { draftId: "draft-p", title: "第二批" })),
    ]);
    expect(first.appended).toBe(true);
    expect(second.appended).toBe(true);
    expect(readLedgerLines(file).map((row: { eventId: string }) => row.eventId)).toEqual(["evt-run-p1", "evt-run-p2"]);
    const replay = tempFile();
    const event = confirm(envA, "run-same");
    const pair = await Promise.all([
      appendStudioEvent(replay, event),
      appendStudioEvent(replay, { ...event, title: "另一标题" }),
    ]);
    expect(pair.filter((item: { appended: boolean }) => item.appended)).toHaveLength(1);
    expect(readLedgerLines(replay)).toHaveLength(1);
  });

  it("旧 CLI 只能写兼容行，不能借这条路径创建批次或补环境", () => {
    const file = tempFile();
    const saved = appendLegacyLedger(file, {
      at: "2026-11-01T00:00:00.000Z",
      platform: "baijiahao",
      title: "旧稿标题",
      tabId: "tab-1",
      ok: false,
      step: "setCover",
      reason: "COVER_NOT_PICKED",
      hint: "封面",
      from: "setCover",
    });
    expect(saved.ok).toBe(true);
    expect(saved.row.envId).toBeUndefined();
    expect(saved.row.runId).toBeUndefined();
    expect(saved.row.attemptId).toBeUndefined();
    const forged = appendLegacyLedger(file, { title: "伪造批次", envId: envA, runId: "run-forged" });
    expect(forged.ok).toBe(false);
    expect(forged.code).toBe("legacy_cannot_create_run");
    expect(forged.appended).toBe(false);
    const batch = appendLegacyLedger(file, {
      time: "2026-11-01T01:00:00.000Z",
      entries: [
        { idx: 1, dir: "D:/articles/第一篇", ok: true, step: "verify", reason: "" },
        { idx: 2, dir: "D:/articles/第二篇", ok: false, step: "setCover", reason: "COVER_NOT_PICKED" },
      ],
    });
    expect(batch.ok).toBe(true);
    expect(readLedgerLines(file)).toHaveLength(2);
    const viewed = projectTasks(envA, readJsonl(file));
    expect(viewed.runs).toEqual([]);
    expect(viewed.history.map((item) => item.title)).toEqual(["旧稿标题", "第一篇", "第二篇"]);
    expect(viewed.history.every((item) => item.envId === "" && item.runId === "" && item.attemptId === "" && item.label === "历史记录")).toBe(true);
    expect(JSON.stringify(viewed.history)).not.toContain(envA);
    expect(JSON.stringify(viewed.runs)).not.toContain("run-forged");
  });

  it("没有夹具标记或没有环境时不写入，生产台账不接收新批次", async () => {
    expect(FIXTURE_MARK).toBe(LEDGER_FIXTURE);
    const file = tempFile();
    const unmarked = confirm(envA, "run-live");
    delete unmarked.fixture;
    const blocked = await appendStudioEvent(file, unmarked);
    expect(blocked.ok).toBe(false);
    expect(blocked.code).toBe("fixture_required");
    expect(blocked.appended).toBe(false);
    expect(existsSync(file)).toBe(false);
    const missingEnv = await appendStudioEvent(file, confirm(envA, "run-none", { envId: " " }));
    expect(missingEnv.ok).toBe(false);
    expect(missingEnv.code).toBe("missing_env");
    expect(missingEnv.message).toContain("不会改用默认登录");
    expect(existsSync(file)).toBe(false);
    const target = defaultLedgerPath();
    const before = existsSync(target) ? statSync(target).size : null;
    const denied = await appendStudioEvent(target, confirm(envA, "run-prod"));
    expect(denied.ok).toBe(false);
    expect(denied.code).toBe("production_blocked");
    expect(denied.appended).toBe(false);
    expect(existsSync(target) ? statSync(target).size : null).toBe(before);
  });

  it("engine.mjs 和 batch_publish.mjs 不再自己追加发布 JSONL", () => {
    const root = join(process.cwd(), "strategies", "skills", "social-media-publish", "scripts");
    const hits: string[] = [];
    for (const name of readdirSync(root)) {
      if (!name.endsWith(".mjs")) continue;
      const text = readFileSync(join(root, name), "utf8");
      if (/appendFile(Sync)?\(/.test(text)) hits.push(name);
    }
    expect(hits).toEqual(["ledger.mjs"]);
    const engine = readFileSync(join(root, "engine.mjs"), "utf8");
    const batch = readFileSync(join(root, "batch_publish.mjs"), "utf8");
    expect(engine).toContain('from "./ledger.mjs"');
    expect(engine).toContain("appendLegacyLedger");
    expect(engine).not.toContain("appendFile");
    expect(engine).toContain("from: ctx.from");
    expect(batch).toContain("appendLegacyLedger");
    expect(batch).not.toContain("appendFile");
    expect(readFileSync(join(process.cwd(), "src", "main", "studio-tasks.ts"), "utf8")).not.toContain("appendFile");
    expect(readFileSync(join(process.cwd(), "src", "renderer", "studio", "pages", "tasks.ts"), "utf8")).not.toMatch(/appendFile|writeFile|WebSocket/);
  });
});

describe("任务投影", () => {
  it("同一稿件两次确认是两个批次，各平台任务互相独立", async () => {
    const file = tempFile();
    const events = scenario();
    await writeEvents(file, events);
    const beforeFail = projectTasks(envA, events.slice(0, 4), { allowFixtures: true });
    const bjBefore = beforeFail.runs[0].jobs.find((item) => item.jobId === "job-bj")?.receipt;
    const projected = projectTasks(envA, readJsonl(file), { allowFixtures: true });
    expect(projected.envId).toBe(envA);
    expect(projected.runs.map((item) => item.runId)).toEqual(["run-1", "run-2"]);
    expect(new Set(projected.runs.map((item) => item.runId)).size).toBe(2);
    expect(projected.runs.every((item) => item.draftId === "draft-1" && item.envId === envA)).toBe(true);
    expect(projected.runs[0].draftRevision).toBe(1);
    expect(projected.runs[1].draftRevision).toBe(2);
    expect(projected.runs[0].snapshotHash).not.toBe(projected.runs[1].snapshotHash);
    expect(projected.runs[0].jobs.map((item) => item.jobId)).toEqual(["job-bj", "job-tt", "job-sohu"]);
    expect(projected.runs[1].jobs).toEqual([]);
    expect(projected.drafts).toEqual([
      expect.objectContaining({ id: "draft-1", envId: envA, revision: 2, title: "标题 A", body: "正文" }),
    ]);
    const bj = projected.runs[0].jobs[0];
    const tt = projected.runs[0].jobs[1];
    expect(bj.receipt).toEqual(bjBefore);
    expect(bj.receipt).toMatchObject({ articleId: "art-bj", url: "https://baijia.example/a", summary: "已核验回执", envId: envA });
    expect(tt.stage).toBe("发布失败");
    expect(tt.failure?.errorCode).toBe("COVER_STILL_MISSING");
    expect(JSON.stringify(bj)).not.toContain("COVER_STILL_MISSING");
  });

  it("重试沿用 jobId 并保留上一次错误，成功和未知提交的动作不同", async () => {
    const file = tempFile();
    await writeEvents(file, scenario());
    const projected = projectTasks(envA, readJsonl(file), { allowFixtures: true });
    const jobs = projected.runs[0].jobs;
    const bj = jobs[0];
    const tt = jobs[1];
    const sohu = jobs[2];
    expect(tt.jobId).toBe("job-tt");
    expect(tt.attempts.map((item) => item.attemptId)).toEqual(["att-1", "att-2"]);
    expect(tt.attempts[0].error).toBe("COVER_NOT_PICKED");
    expect(tt.attempts[1].error).toBe("COVER_STILL_MISSING");
    expect(tt.actions).toEqual([{ kind: "resume", label: "从封面续跑", fromStep: "setCover" }]);
    expect(bj.actions.some((item) => item.kind === "resume" || item.label.includes("重试"))).toBe(false);
    expect(bj.actions).toEqual([{ kind: "receipt", label: "查看回执" }]);
    expect(sohu.submitState).toBe("submitted_unknown");
    expect(sohu.stage).toBe("结果待核验");
    expect(sohu.actions).toEqual([{ kind: "verify", label: "核验结果" }]);
    expect(sohu.actions.some((item) => item.kind === "resume")).toBe(false);
    expect(explainFailure({ errorCode: "COVER_NOT_PICKED", step: "setCover", stage: "发布失败" })).toMatchObject({
      errorCode: "COVER_NOT_PICKED",
      step: "setCover",
    });
    expect(explainFailure({ errorCode: "COVER_NOT_PICKED", step: "setCover", stage: "发布失败" }).explanation).toContain("封面");
    expect(explainFailure({ errorCode: "COVER_NOT_PICKED", step: "setCover", stage: "发布失败" }).suggestion).toContain("封面");
  });

  it("服务重读后投影一致，读取本身不改文件", async () => {
    const file = tempFile();
    await writeEvents(file, scenario());
    appendLegacyLedger(file, {
      at: "2026-11-01T00:00:00.000Z",
      platform: "toutiao",
      title: "旧稿标题",
      ok: true,
      step: "verify",
      reason: "",
      hint: "",
    });
    const bytes = readFileSync(file, "utf8");
    const first = projectTasks(envA, readJsonl(file), { allowFixtures: true });
    const second = projectTasks(envA, readJsonl(file), { allowFixtures: true });
    expect(second).toEqual(first);
    expect(readFileSync(file, "utf8")).toBe(bytes);
    expect(first.runs.map((item) => item.runId)).toEqual(["run-1", "run-2"]);
    expect(first.history[0]).toMatchObject({ title: "旧稿标题", envId: "", runId: "", attemptId: "", label: "历史记录" });
  });

  it("新任务按 envId 过滤，缺环境的新事件不进入任何环境", async () => {
    const file = tempFile();
    await writeEvents(file, scenario());
    const mine = projectTasks(envA, readJsonl(file), { allowFixtures: true });
    const other = projectTasks(envB, readJsonl(file), { allowFixtures: true });
    expect(mine.runs.every((item) => item.envId === envA)).toBe(true);
    expect(JSON.stringify(mine.runs)).not.toContain("环境乙的稿");
    expect(JSON.stringify(mine.runs)).not.toContain(envB);
    expect(other.runs.map((item) => item.runId)).toEqual(["run-b"]);
    expect(JSON.stringify(other.runs)).not.toContain("标题 A");
    const loaded = loadTasks({ envId: envA, ledgerDir: join(file, ".."), configDir });
    if ("ok" in loaded) throw new Error("应该读到投影");
    expect(loaded.runs).toEqual([]);
    expect(loaded.stopped.some((item) => item.reason.includes("测试夹具"))).toBe(true);
    const bad = tempFile();
    writeFileSync(bad, JSON.stringify(studio({
      eventId: "evt-no-env",
      eventType: "studio.job.updated",
      envId: "",
      runId: "run-missing",
      jobId: "job-missing",
      draftId: "draft-missing",
      platform: "toutiao",
      stage: "排队中",
      currentStep: "",
      submitState: "not_submitted",
      title: "不该进入环境",
    })) + "\n", "utf8");
    const left = projectTasks(envA, readJsonl(bad), { allowFixtures: true });
    const right = projectTasks(envB, readJsonl(bad), { allowFixtures: true });
    expect(left.runs).toEqual([]);
    expect(right.runs).toEqual([]);
    expect(left.history).toEqual([]);
    expect(right.history).toEqual([]);
    expect(left.stopped[0].reason).toContain("不会改用默认登录");
    expect(JSON.stringify(left.runs)).not.toContain("不该进入环境");
    expect(JSON.stringify(right.runs)).not.toContain("default");
    const missing = loadTasks({ envId: "", ledgerDir: join(bad, ".."), configDir });
    const unknown = loadTasks({ envId: "default", ledgerDir: join(bad, ".."), configDir });
    expect(missing).toMatchObject({ ok: false, code: "missing_env", envId: "" });
    expect(unknown).toMatchObject({ ok: false, code: "unknown_env", envId: "default" });
    expect(JSON.stringify(missing)).not.toContain("不该进入环境");
    expect(JSON.stringify(unknown)).not.toContain(envA);
  });

  it("生产加载不读测试夹具，确认记录也不会变成只排队的任务", () => {
    expect(isFixturePath(join(process.cwd(), "tests", "fixtures", "studio"))).toBe(true);
    expect(studioLedgerDir()).not.toContain("tests" + sep + "fixtures");
    const fixtureDir = join(process.cwd(), "tests", "fixtures", "studio");
    const blocked = loadTasks({ envId: envA, ledgerDir: fixtureDir, configDir });
    expect(blocked).toMatchObject({ ok: false, code: "fixture_blocked", envId: envA });
    const rows = readJsonl(join(fixtureDir, "t4-publish-events.fixture.jsonl"));
    expect(JSON.stringify(rows)).toContain("T4 测试夹具");
    expect(projectTasks("fixture-env", rows, { allowFixtures: true }).runs).toHaveLength(1);
    expect(projectTasks(envA, rows, { allowFixtures: true }).runs).toEqual([]);
    expect(projectTasks("fixture-env", rows).runs).toEqual([]);
    const dir = mkdtempSync(join(tmpdir(), "studio-task-prod-"));
    writeFileSync(join(dir, "confirmed.json"), JSON.stringify({
      confirmationId: "cfm-live",
      envId: envA,
      wroteToPlatform: false,
    }));
    appendLegacyLedger(join(dir, "2026-11.jsonl"), {
      at: "2026-11-01T00:00:00.000Z",
      platform: "toutiao",
      title: "旧稿标题",
      ok: false,
      step: "setCover",
      reason: "COVER_NOT_PICKED",
    });
    const live = loadTasks({ envId: envA, ledgerDir: dir, configDir });
    if ("ok" in live) throw new Error("旧台账应该能读");
    expect(live.runs).toEqual([]);
    expect(JSON.stringify(live)).not.toContain("排队中");
    expect(live.history[0]).toMatchObject({ title: "旧稿标题", envId: "", runId: "", label: "历史记录" });
    const confirmedOnly = projectTasks(envA, [confirm(envA, "run-q")], { allowFixtures: true });
    expect(confirmedOnly.runs[0].jobs).toEqual([]);
    expect(JSON.stringify(confirmedOnly.runs)).not.toContain("排队中");
    const browser = readFileSync(join(process.cwd(), "src", "main", "browser.ts"), "utf8");
    const start = browser.indexOf('handle("studio:confirm"');
    const end = browser.indexOf('handle("studio:pick-images"');
    const confirmHandler = browser.slice(start, end);
    expect(confirmHandler).toContain("wroteToPlatform: false");
    expect(confirmHandler).toContain("不向平台写稿");
    expect(confirmHandler).not.toContain("appendLedger");
    expect(confirmHandler).not.toContain("appendStudioEvent");
    expect(confirmHandler).not.toContain("排队中");
  });

  it("八步用户状态有固定映射，提交中途结束只能核验", () => {
    expect(userStageFrom({})).toBe("等待确认");
    expect(userStageFrom({ confirmed: true })).toBe("排队中");
    expect(userStageFrom({ step: "openBlank" })).toBe("打开发布页");
    expect(userStageFrom({ step: "fillTitle" })).toBe("填写内容");
    expect(userStageFrom({ step: "fillBody" })).toBe("填写内容");
    expect(userStageFrom({ step: "insertImages" })).toBe("处理图片与封面");
    expect(userStageFrom({ step: "setCover" })).toBe("处理图片与封面");
    expect(userStageFrom({ step: "setOptions" })).toBe("设置平台选项");
    expect(userStageFrom({ step: "publishOrSchedule", submitState: "submitting" })).toBe("提交中");
    expect(userStageFrom({ step: "verify" })).toBe("核验结果");
    expect(userStageFrom({ step: "verify", submitState: "verified", ok: true })).toBe("已发布");
    expect(userStageFrom({ step: "setCover", ok: false, submitState: "not_submitted" })).toBe("发布失败");
    expect(userStageFrom({ human: true, step: "setCover" })).toBe("需要人工");
    expect(userStageFrom({ submitState: "submitted_unknown", step: "publishOrSchedule" })).toBe("结果待核验");
    expect(userStageFrom({ submitState: "submitting", step: "publishOrSchedule", settled: true })).toBe("结果待核验");
    expect(nextActions({ stage: "已发布", submitState: "verified", currentStep: "verify" }).some((item) => item.kind === "resume")).toBe(false);
    expect(nextActions({ stage: "结果待核验", submitState: "submitted_unknown", currentStep: "publishOrSchedule" })).toEqual([
      { kind: "verify", label: "核验结果" },
    ]);
  });
});

describe("发布记录页面", () => {
  it("发布记录和抽屉展示阶段、回执、失败和下一步，卸载后不再响应", async () => {
    const file = tempFile();
    await writeEvents(file, scenario());
    appendLegacyLedger(file, {
      at: "2026-11-01T00:00:00.000Z",
      platform: "toutiao",
      title: "旧稿标题",
      ok: false,
      step: "setCover",
      reason: "COVER_NOT_PICKED",
      hint: "封面",
    });
    const projected = projectTasks(envA, readJsonl(file), { allowFixtures: true });
    const model = toPageModel(projected, { envName: "第二环境", surface: "page", capturedAt: "2026-11-12T03:10:00.000Z" });
    const resume = vi.fn(async () => ({ ok: false as const, code: "unsupported", message: "续跑还没有接入，不会发布。", envId: envA }));
    const verify = vi.fn(async () => ({ ok: false as const, code: "unsupported", message: "核验还没有接入，不会发布。", envId: envA }));
    const open = vi.fn(async () => ({ ok: false as const, code: "unsupported", message: "打开任务还没有接入，不会发布。", envId: envA }));
    let listener: ((event: TaskChangedEvent) => void) | null = null;
    const host = fakeDom.fakeEl("div");
    const page = mount(host as unknown as HTMLElement, model, actions({
      resumeTask: resume,
      verifyTask: verify,
      openTask: open,
      onTasksChanged: (envId, fn) => {
        expect(envId).toBe(envA);
        listener = fn;
        return () => {
          listener = null;
        };
      },
    }));
    expect(host.textContent).toContain("标题 A");
    expect(host.textContent).toContain("第二环境");
    expect(host.textContent).toContain(formatWhen("2026-11-12T02:30:00.000Z"));
    expect(host.textContent).toContain("头条号");
    expect(host.textContent).toContain("百家号");
    expect(host.textContent).toContain("已发布");
    expect(host.textContent).toContain("发布失败");
    expect(host.textContent).toContain("结果待核验");
    expect(host.textContent).toContain("步骤 setCover");
    expect(host.textContent).toContain("已核验回执");
    const tt = host.querySelector("[data-job-id=job-tt]");
    const bj = host.querySelector("[data-job-id=job-bj]");
    const sohu = host.querySelector("[data-job-id=job-sohu]");
    expect(tt?.querySelector("[data-role=error-code]")?.textContent).toBe("COVER_STILL_MISSING");
    expect(tt?.querySelector("[data-role=error-text]")?.textContent).toContain("封面");
    expect(tt?.querySelector("[data-role=error-step]")?.textContent).toContain("setCover");
    expect(tt?.querySelector("[data-role=error-action]")?.textContent).toContain("封面");
    expect(tt?.textContent).toContain("COVER_NOT_PICKED");
    expect(tt?.textContent).toContain("COVER_STILL_MISSING");
    expect(bj?.querySelector("[data-action=resume]")).toBeNull();
    expect(bj?.textContent).not.toContain("续跑");
    expect(sohu?.querySelector("[data-action=verify]")?.textContent).toBe("核验结果");
    expect(sohu?.querySelector("[data-action=resume]")).toBeNull();
    const history = host.querySelector("[data-role=history]");
    expect(history?.textContent).toContain("旧稿标题");
    expect(history?.textContent).toContain("历史记录");
    expect(history?.querySelector("[data-historical=true]")?.getAttribute("data-env")).toBe("");
    expect(history?.querySelector("[data-historical=true]")?.getAttribute("data-run-id")).toBe("");
    const saved = listener;
    saved?.({ eventId: "evt-live", eventType: "studio.job.updated", occurredAt: "2026-11-12T03:11:00.000Z", envId: envA });
    expect(host.querySelector("[data-role=live-note]")?.getAttribute("data-event-id")).toBe("evt-live");
    saved?.({ eventId: "evt-other", eventType: "studio.job.updated", occurredAt: "2026-11-12T03:12:00.000Z", envId: envB });
    expect(host.querySelector("[data-role=live-note]")?.getAttribute("data-event-id")).toBe("evt-live");
    tt?.querySelector("[data-action=resume]")?.click();
    await vi.waitFor(() => expect(resume).toHaveBeenCalledWith({ envId: envA, jobId: "job-tt", fromStep: "setCover" }));
    expect(resume.mock.calls.some((call) => call[0]?.jobId === "job-bj")).toBe(false);
    sohu?.querySelector("[data-action=verify]")?.click();
    await vi.waitFor(() => expect(verify).toHaveBeenCalledWith({ envId: envA, jobId: "job-sohu" }));
    bj?.querySelector("[data-action=receipt]")?.click();
    await vi.waitFor(() => expect(open).toHaveBeenCalledWith({ envId: envA, jobId: "job-bj" }));
    expect(host.querySelector("[data-role=live-note]")?.textContent).toContain("不会发布");
    const resumeButton = tt?.querySelector("[data-action=resume]");
    expect(resumeButton?.listenerCount("click")).toBe(1);
    page.destroy();
    page.destroy();
    expect(listener).toBeNull();
    expect(resumeButton?.listenerCount("click")).toBe(0);
    resumeButton?.click();
    expect(resume).toHaveBeenCalledTimes(1);
    saved?.({ eventId: "evt-late", eventType: "studio.job.updated", occurredAt: "2026-11-12T03:13:00.000Z", envId: envA });
    expect(host.querySelector("[data-role=live-note]")?.getAttribute("data-event-id")).toBe("evt-live");
    const again = projectTasks(envA, readJsonl(file), { allowFixtures: true });
    expect(again.runs.map((item) => item.runId)).toEqual(["run-1", "run-2"]);
    const redraw = fakeDom.fakeEl("div");
    const drawer = mount(redraw as unknown as HTMLElement, toPageModel(again, { envName: "第二环境", surface: "drawer" }), actions());
    expect(redraw.querySelector(".tasks-drawer")).toBeTruthy();
    expect(readFileSync(join(process.cwd(), "src", "renderer", "studio", "pages", "tasks.css"), "utf8")).toContain("420px");
    expect(redraw.textContent).toContain("标题 A");
    expect(redraw.textContent).toContain("已发布");
    expect(redraw.querySelector("[data-role=history]")).toBeNull();
    expect(redraw.textContent).not.toContain("旧稿标题");
    const navigate = vi.fn();
    drawer.destroy();
    const linked = mount(redraw as unknown as HTMLElement, toPageModel(again, { envName: "第二环境", surface: "drawer" }), actions({ navigate }));
    redraw.querySelector("[data-action=navigate-tasks]")?.click();
    expect(navigate).toHaveBeenCalledWith("tasks");
    linked.destroy();
  });

  it("定时器不会改阶段，卸载后定时器和订阅都停", async () => {
    vi.useFakeTimers();
    const host = fakeDom.fakeEl("div");
    let listener: ((event: TaskChangedEvent) => void) | null = null;
    const model = toPageModel(projectTasks(envA, [confirm(envA, "run-1"), job(envA, "run-1", "job-bj", "baijiahao", {
      stage: "已发布",
      currentStep: "verify",
      submitState: "verified",
    })], { allowFixtures: true }), { envName: "第二环境" });
    const page = mount(host as unknown as HTMLElement, model, actions({
      onTasksChanged: (_envId, fn) => {
        listener = fn;
        return () => {
          listener = null;
        };
      },
    }));
    expect(host.querySelector("[data-stage=已发布]")?.textContent).toContain("已发布");
    await vi.advanceTimersByTimeAsync(30);
    expect(host.querySelector(".tasks-page")?.getAttribute("data-tick")).toBe("1");
    expect(host.querySelector("[data-stage=已发布]")?.textContent).toContain("已发布");
    page.destroy();
    expect(listener).toBeNull();
    host.querySelector(".tasks-page")?.setAttribute("data-tick", "");
    await vi.advanceTimersByTimeAsync(1000);
    expect(host.querySelector(".tasks-page")?.getAttribute("data-tick")).toBe("");
  });

  it("加载、空、错误和缺环境各有各的样子", () => {
    const samples: Array<{ model: Parameters<typeof mount>[1]; text: string; state: string }> = [
      { model: { status: "loading" }, text: "正在读取发布记录", state: "loading" },
      { model: { status: "empty", reason: "这个环境还没有发布记录", envId: envA }, text: "这个环境还没有发布记录", state: "empty" },
      { model: { status: "error", message: "台账有一行读不了", envId: envA }, text: "台账有一行读不了", state: "error" },
      { model: { envId: "", runs: [{ runId: "run-x", draftId: "d", draftRevision: 1, snapshotHash: "h", envId: envA, precheckId: "p", confirmationId: "c", confirmedAt: "", title: "不该出现", jobs: [] }] }, text: "不会改用默认登录", state: "missing" },
    ];
    for (const sample of samples) {
      const host = fakeDom.fakeEl("div");
      const page = mount(host as unknown as HTMLElement, sample.model, actions());
      expect(host.querySelector("[data-screen]")?.getAttribute("data-state")).toBe(sample.state);
      expect(host.textContent).toContain(sample.text);
      if (sample.state === "missing") expect(host.textContent).not.toContain("不该出现");
      page.destroy();
    }
  });
});

describe("续跑步骤", () => {
  it("--from setCover 仍从封面开始，不重写标题和正文", () => {
    const resumed = planSteps("setCover", false);
    expect(resumed?.[0]).toBe("setCover");
    expect(resumed).not.toContain("fillTitle");
    expect(resumed).not.toContain("fillBody");
    expect(resumed).toContain("publishOrSchedule");
    expect(resumed).toContain("verify");
    const ran = spawnSync(process.execPath, ["strategies/skills/social-media-publish/scripts/publish.mjs", "--self-check"], {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 60_000,
    });
    expect(ran.status, ran.stdout + "\n" + ran.stderr).toBe(0);
    expect(ran.stdout).toContain("SELF_CHECK_OK");
  });
});
