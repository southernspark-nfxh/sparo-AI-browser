/** 发布记录页，以及 420px 任务抽屉要用的内容。动作只交给工作台，页面不发布。 */
import "./tasks.css";
import { clear, createPageSession, el, on } from "../dom.js";
import type { PageActions, SubmitState, UserTaskStage } from "../types.js";

export const TASK_DRAWER_WIDTH = 420;

const PLATFORM_NAME: Record<string, string> = {
  toutiao: "头条号",
  baijiahao: "百家号",
  dayu: "大鱼号",
  sohu: "搜狐号",
};

export type TaskActionModel = {
  kind: "view" | "receipt" | "verify" | "resume" | "manual";
  label: string;
  fromStep?: string;
};

export type TaskFailureModel = {
  errorCode: string;
  explanation: string;
  step: string;
  suggestion: string;
};

export type TaskAttemptView = {
  attemptId: string;
  error: string;
  fromStep?: string;
  startedAt?: string;
  endedAt?: string;
};

export type TaskReceiptView = {
  summary?: string;
  url?: string;
  articleId?: string;
  verifiedAt?: string;
};

export type TaskJobView = {
  jobId: string;
  runId: string;
  draftId: string;
  envId: string;
  platform: string;
  title?: string;
  stage: UserTaskStage;
  currentStep: string;
  submitState: SubmitState;
  updatedAt?: string;
  attempts?: TaskAttemptView[];
  receipt?: TaskReceiptView;
  failure?: TaskFailureModel;
  actions?: TaskActionModel[];
};

export type TaskRunView = {
  runId: string;
  draftId: string;
  draftRevision: number;
  snapshotHash: string;
  envId: string;
  precheckId: string;
  confirmationId: string;
  confirmedAt: string;
  title?: string;
  jobs: TaskJobView[];
};

export type TaskHistoryView = {
  label?: string;
  envId: string;
  runId: string;
  attemptId?: string;
  title: string;
  platform: string;
  step: string;
  at: string;
  ok: boolean | null;
  reason: string;
  hint: string;
};

export type TasksPageModel = {
  envId: string;
  envName?: string;
  surface?: "page" | "drawer";
  capturedAt?: string;
  status?: "ready" | "loading" | "empty" | "error" | "missing" | "unsupported" | "stale" | "login_missing";
  message?: string;
  reason?: string;
  runs?: TaskRunView[];
  history?: TaskHistoryView[];
  stopped?: Array<{ eventId: string; reason: string }>;
  previous?: TasksPageModel;
};

type ReadyWrap = { status: "ready"; value: TasksPageModel; capturedAt?: string };

type StatusOnly = {
  status: "loading" | "empty" | "error" | "missing" | "unsupported" | "stale" | "login_missing";
  message?: string;
  reason?: string;
  envId?: string;
  previous?: TasksPageModel;
};

export type TasksMountInput = TasksPageModel | ReadyWrap | StatusOnly;

const STATUS_TEXT: Record<Exclude<NonNullable<TasksPageModel["status"]>, "ready">, string> = {
  loading: "正在读取发布记录",
  empty: "这个环境还没有发布记录",
  error: "发布记录没有读出来",
  missing: "还没有选择账号环境，已停止。不会改用默认登录。",
  unsupported: "发布记录还没有接入",
  stale: "显示的是上次读到的发布记录",
  login_missing: "登录态缺失，发布记录未刷新",
};

export function formatWhen(iso: string): string {
  if (!iso.trim()) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (value: number) => String(value).padStart(2, "0");
  return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate()) + " " + pad(date.getHours()) + ":" + pad(date.getMinutes());
}

function isReadyWrap(input: TasksMountInput): input is ReadyWrap {
  return "value" in input && input.status === "ready" && !("runs" in input);
}

function isStatusOnly(input: TasksMountInput): input is StatusOnly {
  return "status" in input && input.status !== "ready" && !("runs" in input);
}

function unwrap(input: TasksMountInput): TasksPageModel {
  if (isReadyWrap(input)) return { ...input.value, capturedAt: input.value.capturedAt || input.capturedAt || "" };
  if (isStatusOnly(input)) {
    return {
      envId: input.envId || "",
      status: input.status,
      message: input.message,
      reason: input.reason,
      previous: input.previous,
      runs: [],
      history: [],
    };
  }
  return input;
}

function platformLabel(id: string, historical: boolean): string {
  if (!id.trim()) return historical ? "历史记录" : "—";
  return PLATFORM_NAME[id] || id;
}

function shown(value: string, historical: boolean): string {
  if (value.trim()) return value;
  return historical ? "历史记录" : "—";
}

function stageState(stage: UserTaskStage): string {
  if (stage === "已发布") return "ok";
  if (stage === "发布失败") return "error";
  if (stage === "需要人工") return "login_missing";
  if (stage === "结果待核验") return "unknown";
  if (stage === "等待确认" || stage === "排队中") return "stale";
  return "partial";
}

function viewState(model: TasksPageModel): Exclude<NonNullable<TasksPageModel["status"]>, "ready"> | "ready" {
  if (model.status === "loading") return "loading";
  if (!model.envId.trim()) return "missing";
  if (model.status && model.status !== "ready") return model.status;
  const runs = model.runs || [];
  const history = model.surface === "drawer" ? [] : model.history || [];
  if (runs.length === 0 && history.length === 0) return "empty";
  return "ready";
}

function statusCopy(state: Exclude<NonNullable<TasksPageModel["status"]>, "ready">, model: TasksPageModel): string {
  if (state === "empty" && model.surface === "drawer") return model.reason || "进行中的任务会显示在这里";
  if (state === "empty") return model.reason || model.message || STATUS_TEXT.empty;
  if (state === "missing") return STATUS_TEXT.missing;
  return model.message || model.reason || STATUS_TEXT[state];
}

function actionsOf(job: TaskJobView): TaskActionModel[] {
  if (Array.isArray(job.actions) && job.actions.length) return job.actions;
  return [{ kind: "view", label: "查看" }];
}

export function mount(container: HTMLElement, viewModel: TasksMountInput, actions: PageActions): { destroy: () => void } {
  const session = createPageSession();
  const model = unwrap(viewModel);
  const surface = model.surface === "drawer" ? "drawer" : "page";
  const state = viewState(model);
  clear(container);
  const root = el("div", surface === "drawer" ? "tasks-page tasks-drawer" : "tasks-page");
  root.setAttribute("data-surface", surface);
  root.setAttribute("data-state", state);
  root.setAttribute("data-screen", state);
  const note = el("p", "muted");
  note.setAttribute("data-role", "live-note");
  const head = el("div", "page-head");
  head.append(
    el("h1", "", surface === "drawer" ? "发布任务" : "发布记录"),
    el("p", "muted", surface === "drawer" ? "进行中和最近的任务。完整历史在发布记录页。" : "发稿页的发布记录。环境：" + shown(model.envName || model.envId, false)),
  );
  root.append(head, note);

  if (state !== "ready") {
    const banner = el("div", "tasks-banner");
    banner.setAttribute("data-state", state);
    banner.append(el("p", "", statusCopy(state, model)));
    root.append(banner);
    if (state === "error" && model.previous && model.previous.envId.trim()) {
      root.append(renderBody(model.previous, surface, note));
    }
  } else {
    root.append(renderBody(model, surface, note));
  }

  if (surface === "drawer") {
    const all = el("button", "btn ghost", "完整发布记录");
    all.type = "button";
    all.title = "完整发布记录";
    all.setAttribute("aria-label", "完整发布记录");
    all.setAttribute("data-action", "navigate-tasks");
    session.track(on(all, "click", () => {
      if (session.destroyed) return;
      actions.navigate("tasks");
    }));
    root.append(all);
  }

  container.append(root);
  session.later(() => {
    if (session.destroyed) return;
    root.setAttribute("data-tick", "1");
  }, 30);

  if (model.envId.trim() && typeof actions.onTasksChanged === "function") {
    session.track(actions.onTasksChanged(model.envId, (event) => {
      if (session.destroyed || event.envId !== model.envId) return;
      note.textContent = "记录有更新";
      note.setAttribute("data-event-id", event.eventId);
    }));
  }

  return {
    destroy() {
      session.destroy();
    },
  };

  function renderBody(source: TasksPageModel, mode: "page" | "drawer", live: HTMLElement): HTMLElement {
    const body = el("div", "tasks-list");
    const stopped = source.stopped || [];
    if (stopped.length) {
      body.append(el("p", "muted", stopped.length + " 条事件缺少环境或无法归入当前环境，已停止。"));
    }
    for (const run of source.runs || []) {
      body.append(renderRun(run, source, live));
    }
    if (mode === "page") body.append(renderHistory(source.history || []));
    return body;
  }

  function renderRun(run: TaskRunView, source: TasksPageModel, live: HTMLElement): HTMLElement {
    const section = el("section", "card tasks-run");
    section.setAttribute("data-run-id", run.runId);
    section.setAttribute("data-env", run.envId);
    const title = el("h2", "tasks-clip", shown(run.title || "", false));
    const env = el("p", "secondary", "环境：" + shown(source.envName || run.envId, false));
    const when = el("p", "muted", "确认时间：" + formatWhen(run.confirmedAt));
    when.setAttribute("data-confirmed", run.confirmedAt);
    section.append(title, env, when);
    for (const job of run.jobs) section.append(renderJob(job, live));
    return section;
  }

  function renderJob(job: TaskJobView, live: HTMLElement): HTMLElement {
    const node = el("article", "tasks-job");
    node.setAttribute("data-job-id", job.jobId);
    node.setAttribute("data-platform", job.platform);
    node.setAttribute("data-stage", job.stage);
    node.setAttribute("data-step", job.currentStep);
    node.setAttribute("data-env", job.envId);
    node.setAttribute("data-submit", job.submitState);
    const main = el("div", "tasks-main");
    main.append(el("strong", "tasks-clip", platformLabel(job.platform, false)));
    const stage = el("span", "tag tasks-stage", job.stage);
    stage.setAttribute("data-state", stageState(job.stage));
    main.append(stage);
    const meta = el("div", "tasks-meta");
    const step = el("p", "muted", "步骤 " + shown(job.currentStep, false));
    step.setAttribute("data-role", "step");
    const updated = el("p", "muted", "更新 " + formatWhen(job.updatedAt || ""));
    updated.setAttribute("data-updated", job.updatedAt || "");
    meta.append(step, updated);
    if (job.receipt) {
      const receipt = el("p", "tasks-clip", "回执：" + shown(job.receipt.summary || job.receipt.articleId || "", false));
      receipt.setAttribute("data-role", "receipt");
      if (job.receipt.url) receipt.setAttribute("data-url", job.receipt.url);
      meta.append(receipt);
    }
    if (job.failure) {
      const failure = el("div", "tasks-failure");
      failure.setAttribute("data-role", "failure");
      const code = el("p", "", job.failure.errorCode);
      code.setAttribute("data-role", "error-code");
      const explanation = el("p", "", job.failure.explanation);
      explanation.setAttribute("data-role", "error-text");
      const where = el("p", "", "发生步骤 " + shown(job.failure.step, false));
      where.setAttribute("data-role", "error-step");
      const suggestion = el("p", "", job.failure.suggestion);
      suggestion.setAttribute("data-role", "error-action");
      failure.append(code, explanation, where, suggestion);
      meta.append(failure);
    }
    const attempts = (job.attempts || []).filter((item) => item.error);
    if (attempts.length) {
      const list = el("div", "tasks-attempts");
      list.setAttribute("data-role", "attempts");
      attempts.forEach((item, index) => {
        const line = el("p", "muted", "第 " + (index + 1) + " 次 " + item.attemptId + " " + item.error);
        line.setAttribute("data-attempt-id", item.attemptId);
        list.append(line);
      });
      meta.append(list);
    }
    const bar = el("div", "tasks-actions");
    for (const action of actionsOf(job)) {
      const button = el("button", "btn ghost", action.label);
      button.type = "button";
      button.title = action.label;
      button.setAttribute("aria-label", action.label);
      button.setAttribute("data-action", action.kind);
      button.setAttribute("data-job-id", job.jobId);
      if (action.fromStep) button.setAttribute("data-from-step", action.fromStep);
      session.track(on(button, "click", () => {
        if (session.destroyed) return;
        void perform(job, action, button, live);
      }));
      bar.append(button);
    }
    node.append(main, meta, bar);
    return node;
  }

  function renderHistory(rows: TaskHistoryView[]): HTMLElement {
    const section = el("section", "card tasks-history");
    section.setAttribute("data-role", "history");
    section.append(el("h2", "", "历史记录"));
    if (!rows.length) {
      section.append(el("p", "muted", "没有更早的命令行记录"));
      return section;
    }
    for (const row of rows) {
      const item = el("article", "tasks-job");
      item.setAttribute("data-historical", "true");
      item.setAttribute("data-env", row.envId);
      item.setAttribute("data-run-id", row.runId);
      item.setAttribute("data-attempt-id", row.attemptId || "");
      const main = el("div", "tasks-main");
      main.append(el("strong", "tasks-clip", shown(row.title, true)));
      main.append(el("p", "secondary", "环境：" + shown(row.envId, true)));
      const meta = el("div", "tasks-meta");
      meta.append(el("p", "", "批次：" + shown(row.runId, true)));
      meta.append(el("p", "", "平台：" + platformLabel(row.platform, true)));
      meta.append(el("p", "muted", "步骤 " + shown(row.step, true)));
      meta.append(el("p", "muted", "更新 " + formatWhen(row.at)));
      const reason = row.reason || row.hint;
      if (reason) meta.append(el("p", "", reason));
      item.append(main, meta);
      section.append(item);
    }
    return section;
  }

  async function perform(job: TaskJobView, action: TaskActionModel, button: HTMLButtonElement, live: HTMLElement): Promise<void> {
    const envId = job.envId.trim() || model.envId.trim();
    if (!envId) {
      live.textContent = "缺少环境，已停止。不会改用默认登录。";
      return;
    }
    button.setAttribute("aria-busy", "true");
    try {
      const result = await callAction(envId, job, action);
      if (session.destroyed) return;
      live.textContent = result?.message || "请求已交给工作台。";
    } catch {
      if (session.destroyed) return;
      live.textContent = "这一步没有执行。";
    } finally {
      if (!session.destroyed) button.removeAttribute("aria-busy");
    }
  }

  function callAction(envId: string, job: TaskJobView, action: TaskActionModel): Promise<{ message?: string } | void> {
    if (action.kind === "resume" && action.fromStep) {
      if (typeof actions.resumeTask !== "function") return Promise.resolve({ message: "续跑还没有接入，不会发布。" });
      return actions.resumeTask({ envId, jobId: job.jobId, fromStep: action.fromStep });
    }
    if (action.kind === "verify") {
      if (typeof actions.verifyTask !== "function") return Promise.resolve({ message: "核验还没有接入，不会发布。" });
      return actions.verifyTask({ envId, jobId: job.jobId });
    }
    if (typeof actions.openTask !== "function") return Promise.resolve({ message: "打开任务还没有接入，不会发布。" });
    return actions.openTask({ envId, jobId: job.jobId });
  }
}
