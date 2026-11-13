/**
 * 发布记录的只读投影。
 * 只读 JSONL，不写文件，也不把测试夹具放进生产加载路径。
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, sep } from "node:path";
import type { StudioError, SubmitState, UserTaskStage } from "../renderer/studio/types.js";
import { resolveStudioEnv } from "./studio-env.js";

export const FIXTURE_MARK = "sparo-studio-task-fixture";
export const HISTORY_LABEL = "历史记录";

const RESUMABLE = new Set(["openBlank", "fillTitle", "fillBody", "insertImages", "setCover", "setOptions"]);
const USER_STAGES = new Set<UserTaskStage>([
  "等待确认",
  "排队中",
  "打开发布页",
  "填写内容",
  "处理图片与封面",
  "设置平台选项",
  "提交中",
  "核验结果",
  "已发布",
  "发布失败",
  "需要人工",
  "结果待核验",
]);

const FAILURES: Record<string, { explanation: string; suggestion: string }> = {
  COVER_NOT_PICKED: {
    explanation: "封面没有被选中，发布停在封面这一步。",
    suggestion: "从封面续跑这一平台。",
  },
  COVER_STILL_MISSING: {
    explanation: "封面仍然没有被选中。",
    suggestion: "从封面续跑这一平台。",
  },
  BAD_FROM: {
    explanation: "续跑步骤不存在。",
    suggestion: "从头开始这一平台。",
  },
  RESUME_NOT_EDITOR: {
    explanation: "没有找到可续跑的编辑页。",
    suggestion: "从头打开发布页。",
  },
  RESUME_NO_TITLE: {
    explanation: "编辑页里没有这篇标题。",
    suggestion: "从头填写这一篇。",
  },
  RENDER_NOT_READY: {
    explanation: "发布页还没有排版完成。",
    suggestion: "等页面排版后再查看这一步。",
  },
  WINDOW_MINIMIZED: {
    explanation: "窗口最小化，页面没有排版。",
    suggestion: "恢复窗口后再查看这一步。",
  },
  LOGIN_MISSING: {
    explanation: "这个平台的登录态失效了。",
    suggestion: "打开这一平台的页面，由人重新登录。",
  },
  CAPTCHA: {
    explanation: "遇到验证码，自动发布已停下。",
    suggestion: "打开这一平台的页面，由人处理验证码。",
  },
  SUBMIT_UNKNOWN: {
    explanation: "提交之后没有读到回执。",
    suggestion: "先核验结果。",
  },
};

export type DraftRecord = {
  id: string;
  envId: string;
  revision: number;
  title: string;
  body: string;
  platforms: string[];
  updatedAt: string;
};

export type FailureDetail = {
  errorCode: string;
  explanation: string;
  step: string;
  suggestion: string;
};

export type NextAction = {
  kind: "view" | "receipt" | "verify" | "resume" | "manual";
  label: string;
  fromStep?: string;
};

export type AttemptRecord = {
  attemptId: string;
  envId: string;
  snapshotHash: string;
  fromStep: string;
  startedAt: string;
  endedAt: string;
  error: string;
};

export type ReceiptRecord = {
  jobId: string;
  runId: string;
  envId: string;
  platform: string;
  articleId: string;
  url: string;
  verifiedAt: string;
  summary: string;
};

export type JobRecord = {
  jobId: string;
  runId: string;
  draftId: string;
  envId: string;
  platform: string;
  title: string;
  stage: UserTaskStage;
  currentStep: string;
  submitState: SubmitState;
  updatedAt: string;
  attempts: AttemptRecord[];
  receipt?: ReceiptRecord;
  failure?: FailureDetail;
  actions: NextAction[];
};

export type RunRecord = {
  runId: string;
  draftId: string;
  draftRevision: number;
  snapshotHash: string;
  envId: string;
  precheckId: string;
  confirmationId: string;
  confirmedAt: string;
  title: string;
  jobs: JobRecord[];
};

export type HistoryRecord = {
  label: typeof HISTORY_LABEL;
  envId: "";
  runId: "";
  attemptId: "";
  title: string;
  platform: string;
  step: string;
  at: string;
  ok: boolean | null;
  reason: string;
  hint: string;
};

export type StoppedEvent = {
  eventId: string;
  reason: string;
};

export type TaskProjection = {
  envId: string;
  drafts: DraftRecord[];
  runs: RunRecord[];
  history: HistoryRecord[];
  stopped: StoppedEvent[];
};

export type TaskPageSnapshot = {
  envId: string;
  envName: string;
  surface: "page" | "drawer";
  capturedAt: string;
  status: "ready";
  runs: RunRecord[];
  history: HistoryRecord[];
  stopped: StoppedEvent[];
};

type Json = Record<string, unknown>;

type MutableJob = JobRecord & { errorCode: string; hint: string };

type MutableRun = Omit<RunRecord, "jobs"> & { jobs: MutableJob[] };

export function studioLedgerDir(root = process.cwd()): string {
  return join(root, "strategies", "skills", "social-media-publish", "ledger");
}

export function isFixturePath(file: string): boolean {
  const norm = file.replace(/\\/g, "/").toLowerCase();
  return norm.includes("/tests/fixtures/") || norm.endsWith("/tests/fixtures");
}

export function resumeLabel(step: string): string {
  if (step === "setCover") return "从封面续跑";
  if (step === "insertImages") return "从插图续跑";
  if (step === "openBlank") return "从头续跑";
  if (step === "fillTitle" || step === "fillBody") return "从正文续跑";
  if (step === "setOptions") return "从选项续跑";
  return "查看";
}

export function userStageFrom(input: {
  step?: string;
  submitState?: SubmitState;
  ok?: boolean;
  human?: boolean;
  confirmed?: boolean;
  settled?: boolean;
}): UserTaskStage {
  if (input.human) return "需要人工";
  if (input.submitState === "submitted_unknown") return "结果待核验";
  if (input.submitState === "submitting" && input.settled) return "结果待核验";
  if (input.submitState === "verified" || (input.ok === true && input.step === "verify")) return "已发布";
  if (input.submitState === "submitting" || input.step === "publishOrSchedule") return "提交中";
  if (input.step === "verify") return "核验结果";
  if (input.ok === false && input.step && RESUMABLE.has(input.step)) return "发布失败";
  if (input.step === "openBlank") return "打开发布页";
  if (input.step === "fillTitle" || input.step === "fillBody") return "填写内容";
  if (input.step === "insertImages" || input.step === "setCover") return "处理图片与封面";
  if (input.step === "setOptions") return "设置平台选项";
  if (input.confirmed) return "排队中";
  return "等待确认";
}

export function explainFailure(input: {
  errorCode: string;
  step: string;
  hint?: string;
  stage: UserTaskStage;
}): FailureDetail {
  const code = input.errorCode || (input.stage === "结果待核验" ? "SUBMIT_UNKNOWN" : "UNKNOWN");
  const known = FAILURES[code];
  const explanation = known?.explanation || input.hint || (code === "UNKNOWN" ? "发布没有完成。" : "发布没有完成（" + code + "）。");
  let suggestion = known?.suggestion || "";
  if (!suggestion) {
    if (input.stage === "结果待核验" || input.stage === "提交中") suggestion = "先核验结果。";
    else if (input.stage === "需要人工") suggestion = "打开这一平台的页面，由人处理。";
    else if (input.stage === "发布失败" && RESUMABLE.has(input.step)) suggestion = resumeLabel(input.step) + "这一平台。";
    else suggestion = "查看这一步的原始记录。";
  }
  return { errorCode: code, explanation, step: input.step || "", suggestion };
}

export function nextActions(job: { stage: UserTaskStage; submitState: SubmitState; currentStep: string }): NextAction[] {
  if (job.stage === "已发布" || job.submitState === "verified") return [{ kind: "receipt", label: "查看回执" }];
  if (job.stage === "结果待核验" || job.submitState === "submitted_unknown") return [{ kind: "verify", label: "核验结果" }];
  if (job.stage === "提交中" || job.submitState === "submitting") return [{ kind: "view", label: "查看" }];
  if (job.stage === "发布失败" && RESUMABLE.has(job.currentStep)) {
    return [{ kind: "resume", label: resumeLabel(job.currentStep), fromStep: job.currentStep }];
  }
  if (job.stage === "需要人工") return [{ kind: "manual", label: "去处理" }];
  if (job.stage === "等待确认") return [{ kind: "view", label: "返回编辑" }];
  return [{ kind: "view", label: "查看" }];
}

function isObject(value: unknown): value is Json {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asStage(value: unknown): UserTaskStage | null {
  return typeof value === "string" && USER_STAGES.has(value as UserTaskStage) ? value as UserTaskStage : null;
}

function asSubmit(value: unknown): SubmitState | null {
  if (value === "not_submitted" || value === "submitting" || value === "submitted_unknown" || value === "verified") return value;
  return null;
}

export function readJsonl(file: string): unknown[] {
  if (!file || !existsSync(file)) return [];
  const rows: unknown[] = [];
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      rows.push(JSON.parse(trimmed) as unknown);
    } catch {
      rows.push({ __unreadable: true });
    }
  }
  return rows;
}

export function readLedgerDir(dir: string): unknown[] {
  if (!dir || !existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".jsonl"))
    .sort()
    .flatMap((name) => readJsonl(join(dir, name)));
}

function legacyRows(row: Json): HistoryRecord[] {
  if (Array.isArray(row.entries)) {
    const at = text(row.time);
    return row.entries.filter(isObject).map((entry) => ({
      label: HISTORY_LABEL,
      envId: "",
      runId: "",
      attemptId: "",
      title: titleFromDir(text(entry.dir)) || text(entry.title),
      platform: text(entry.platform),
      step: text(entry.step),
      at,
      ok: typeof entry.ok === "boolean" ? entry.ok : null,
      reason: text(entry.reason),
      hint: text(entry.hint) || text(entry.tail),
    }));
  }
  return [{
    label: HISTORY_LABEL,
    envId: "",
    runId: "",
    attemptId: "",
    title: text(row.title),
    platform: text(row.platform),
    step: text(row.step),
    at: text(row.at) || text(row.time),
    ok: typeof row.ok === "boolean" ? row.ok : null,
    reason: text(row.reason),
    hint: text(row.hint),
  }];
}

function titleFromDir(dir: string): string {
  if (!dir) return "";
  const parts = dir.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || "";
}

function emptyJob(event: Json, run: MutableRun): MutableJob {
  return {
    jobId: text(event.jobId),
    runId: run.runId,
    draftId: text(event.draftId) || run.draftId,
    envId: run.envId,
    platform: text(event.platform),
    title: text(event.title) || run.title,
    stage: "等待确认",
    currentStep: "",
    submitState: "not_submitted",
    updatedAt: text(event.occurredAt),
    attempts: [],
    actions: [],
    errorCode: "",
    hint: "",
  };
}

function refreshJob(job: MutableJob): void {
  const latestError = [...job.attempts].reverse().find((item) => item.error)?.error || "";
  if (job.stage === "已发布" || job.submitState === "verified") {
    job.failure = undefined;
  } else if (job.stage === "发布失败" || job.stage === "需要人工" || job.stage === "结果待核验") {
    const code = latestError || job.errorCode || (job.stage === "结果待核验" ? "SUBMIT_UNKNOWN" : "");
    job.failure = explainFailure({ errorCode: code, step: job.currentStep, hint: job.hint, stage: job.stage });
  } else {
    job.failure = undefined;
  }
  job.actions = nextActions(job);
}

function materializeJob(job: MutableJob): JobRecord {
  refreshJob(job);
  const next: JobRecord = {
    jobId: job.jobId,
    runId: job.runId,
    draftId: job.draftId,
    envId: job.envId,
    platform: job.platform,
    title: job.title,
    stage: job.stage,
    currentStep: job.currentStep,
    submitState: job.submitState,
    updatedAt: job.updatedAt,
    attempts: job.attempts.map((item) => ({ ...item })),
    actions: job.actions.map((item) => ({ ...item })),
  };
  if (job.receipt) next.receipt = { ...job.receipt };
  if (job.failure) next.failure = { ...job.failure };
  return next;
}

export function projectTasks(
  envId: string,
  records: readonly unknown[],
  options?: { allowFixtures?: boolean },
): TaskProjection {
  const wanted = envId.trim();
  const allowFixtures = options?.allowFixtures === true;
  const runs = new Map<string, MutableRun>();
  const drafts = new Map<string, DraftRecord>();
  const history: HistoryRecord[] = [];
  const stopped: StoppedEvent[] = [];

  const stop = (eventId: string, reason: string) => {
    stopped.push({ eventId, reason });
  };

  const ensureRun = (event: Json, env: string): MutableRun | null => {
    const runId = text(event.runId);
    if (!runId) {
      stop(text(event.eventId), "工作台事件缺少批次，已停止。");
      return null;
    }
    let run = runs.get(runId);
    if (!run) {
      run = {
        runId,
        draftId: text(event.draftId),
        draftRevision: typeof event.draftRevision === "number" ? event.draftRevision : 0,
        snapshotHash: text(event.snapshotHash),
        envId: env,
        precheckId: text(event.precheckId),
        confirmationId: text(event.confirmationId),
        confirmedAt: text(event.confirmedAt),
        title: text(event.title),
        jobs: [],
      };
      runs.set(runId, run);
      return run;
    }
    if (run.envId !== env) {
      stop(text(event.eventId), "任务环境和批次环境不一致，已停止。");
      return null;
    }
    return run;
  };

  for (const record of records) {
    if (!isObject(record) || record.__unreadable === true) {
      stop("", "台账有一行读不了");
      continue;
    }
    const eventType = text(record.eventType);
    if (eventType.startsWith("studio.")) {
      if (record.fixture === FIXTURE_MARK && !allowFixtures) {
        stop(text(record.eventId), "测试夹具不能进入生产加载路径");
        continue;
      }
      const eventEnv = text(record.envId);
      if (!eventEnv) {
        stop(text(record.eventId), "缺少环境，已停止。不会改用默认登录。");
        continue;
      }
      if (record.fixture === FIXTURE_MARK && allowFixtures) {
        applyStudio(record, eventEnv);
      } else if (record.fixture === FIXTURE_MARK) {
        stop(text(record.eventId), "测试夹具不能进入生产加载路径");
      } else {
        applyStudio(record, eventEnv);
      }
      continue;
    }
    history.push(...legacyRows(record));
  }

  function applyStudio(event: Json, eventEnv: string): void {
    const eventId = text(event.eventId);
    const eventType = text(event.eventType);
    if (eventType === "studio.run.confirmed") {
      const runId = text(event.runId);
      if (!runId) {
        stop(eventId, "工作台事件缺少批次，已停止。");
        return;
      }
      const existing = runs.get(runId);
      if (existing && existing.envId !== eventEnv) {
        stop(eventId, "任务环境和批次环境不一致，已停止。");
        return;
      }
      if (!existing) {
        runs.set(runId, {
          runId,
          draftId: text(event.draftId),
          draftRevision: typeof event.draftRevision === "number" ? event.draftRevision : 0,
          snapshotHash: text(event.snapshotHash),
          envId: eventEnv,
          precheckId: text(event.precheckId),
          confirmationId: text(event.confirmationId),
          confirmedAt: text(event.confirmedAt) || text(event.occurredAt),
          title: text(event.title),
          jobs: [],
        });
      } else {
        if (!existing.draftId) existing.draftId = text(event.draftId);
        if (!existing.snapshotHash) existing.snapshotHash = text(event.snapshotHash);
        if (!existing.precheckId) existing.precheckId = text(event.precheckId);
        if (!existing.confirmationId) existing.confirmationId = text(event.confirmationId);
        if (!existing.confirmedAt) existing.confirmedAt = text(event.confirmedAt) || text(event.occurredAt);
        if (!existing.title) existing.title = text(event.title);
        if (!existing.draftRevision && typeof event.draftRevision === "number") existing.draftRevision = event.draftRevision;
      }
      const draftId = text(event.draftId);
      if (draftId) {
        const platforms = Array.isArray(event.platforms) ? event.platforms.filter((item): item is string => typeof item === "string") : [];
        drafts.set(draftId, {
          id: draftId,
          envId: eventEnv,
          revision: typeof event.draftRevision === "number" ? event.draftRevision : 0,
          title: text(event.title),
          body: text(event.body),
          platforms,
          updatedAt: text(event.occurredAt) || text(event.confirmedAt),
        });
      }
      return;
    }

    const run = ensureRun(event, eventEnv);
    if (!run) return;
    if (eventType === "studio.job.updated") {
      const stage = asStage(event.stage);
      const submitState = asSubmit(event.submitState);
      const jobId = text(event.jobId);
      if (!stage || !submitState || !jobId) {
        stop(eventId, "平台任务字段无法识别，已停止。");
        return;
      }
      let job = run.jobs.find((item) => item.jobId === jobId);
      if (!job) {
        job = emptyJob(event, run);
        run.jobs.push(job);
      }
      job.platform = text(event.platform) || job.platform;
      job.draftId = text(event.draftId) || job.draftId;
      job.title = text(event.title) || job.title || run.title;
      job.stage = stage;
      job.currentStep = text(event.currentStep);
      job.submitState = submitState;
      job.updatedAt = text(event.occurredAt) || job.updatedAt;
      if (text(event.errorCode)) job.errorCode = text(event.errorCode);
      if (text(event.hint)) job.hint = text(event.hint);
      if (text(event.error) && !job.errorCode) job.errorCode = text(event.error);
      refreshJob(job);
      return;
    }
    if (eventType === "studio.attempt.started" || eventType === "studio.attempt.finished") {
      const job = run.jobs.find((item) => item.jobId === text(event.jobId));
      if (!job) {
        stop(eventId, "尝试找不到平台任务，已停止。");
        return;
      }
      const attemptId = text(event.attemptId);
      if (!attemptId) {
        stop(eventId, "尝试缺少编号，已停止。");
        return;
      }
      let attempt = job.attempts.find((item) => item.attemptId === attemptId);
      if (!attempt) {
        attempt = {
          attemptId,
          envId: eventEnv,
          snapshotHash: text(event.snapshotHash),
          fromStep: text(event.fromStep),
          startedAt: text(event.startedAt),
          endedAt: "",
          error: "",
        };
        job.attempts.push(attempt);
      }
      if (text(event.snapshotHash)) attempt.snapshotHash = text(event.snapshotHash);
      if (text(event.fromStep)) attempt.fromStep = text(event.fromStep);
      if (text(event.startedAt) && !attempt.startedAt) attempt.startedAt = text(event.startedAt);
      if (text(event.endedAt)) attempt.endedAt = text(event.endedAt);
      if (text(event.error)) attempt.error = text(event.error);
      job.updatedAt = text(event.occurredAt) || job.updatedAt;
      refreshJob(job);
      return;
    }
    if (eventType === "studio.receipt.verified") {
      const job = run.jobs.find((item) => item.jobId === text(event.jobId));
      if (!job) {
        stop(eventId, "回执找不到平台任务，已停止。");
        return;
      }
      if (!job.receipt) {
        job.receipt = {
          jobId: job.jobId,
          runId: run.runId,
          envId: eventEnv,
          platform: text(event.platform) || job.platform,
          articleId: text(event.articleId),
          url: text(event.url),
          verifiedAt: text(event.verifiedAt),
          summary: text(event.summary),
        };
        job.stage = "已发布";
        job.submitState = "verified";
        job.updatedAt = text(event.occurredAt) || text(event.verifiedAt) || job.updatedAt;
      }
      refreshJob(job);
      return;
    }
    stop(eventId, "不认识的工作台事件");
  }

  const visible = [...runs.values()].filter((run) => run.envId === wanted);
  return {
    envId: wanted,
    drafts: [...drafts.values()].filter((draft) => draft.envId === wanted),
    runs: visible.map((run) => ({
      runId: run.runId,
      draftId: run.draftId,
      draftRevision: run.draftRevision,
      snapshotHash: run.snapshotHash,
      envId: run.envId,
      precheckId: run.precheckId,
      confirmationId: run.confirmationId,
      confirmedAt: run.confirmedAt,
      title: run.title,
      jobs: run.jobs.map((job) => materializeJob(job)),
    })),
    history,
    stopped,
  };
}

export function toPageModel(
  projection: TaskProjection,
  options?: { envName?: string; surface?: "page" | "drawer"; capturedAt?: string },
): TaskPageSnapshot {
  return {
    envId: projection.envId,
    envName: options?.envName || projection.envId,
    surface: options?.surface || "page",
    capturedAt: options?.capturedAt || "",
    status: "ready",
    runs: projection.runs,
    history: projection.history,
    stopped: projection.stopped,
  };
}

export function loadTasks(input: {
  envId: string;
  ledgerDir: string;
  configDir?: string;
}): TaskProjection | StudioError {
  if (input.configDir) {
    const env = resolveStudioEnv(input.configDir, input.envId);
    if (!env.ok) return env;
  } else if (!input.envId.trim()) {
    return {
      ok: false,
      code: "missing_env",
      message: "还没有选择账号环境，已停止。不会改用默认登录。",
      envId: "",
    };
  }
  const envId = input.envId.trim();
  if (isFixturePath(input.ledgerDir)) {
    return {
      ok: false,
      code: "fixture_blocked",
      message: "测试夹具不能进入生产加载路径。",
      envId,
    };
  }
  return projectTasks(envId, readLedgerDir(input.ledgerDir), { allowFixtures: false });
}

export function fixtureBlocked(dir: string): boolean {
  return isFixturePath(dir.split(sep).join("/"));
}
