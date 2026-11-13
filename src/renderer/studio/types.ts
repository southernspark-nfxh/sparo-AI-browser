/** 工作台共享契约。T1–T4 只消费这些类型，不另起一套字段名。 */

export const TASK_EVENT_CHANNEL = "studio:tasks-changed";

export const PAGE_MODULES = {
  home: "src/renderer/studio/pages/home.ts",
  metrics: "src/renderer/studio/pages/metrics.ts",
  compose: "src/renderer/studio/pages/compose.ts",
  accounts: "src/renderer/studio/pages/accounts.ts",
  comments: "src/renderer/studio/pages/comments.ts",
  tasks: "src/renderer/studio/pages/tasks.ts",
} as const;

export type StudioViewId = "home" | "compose" | "metrics" | "comments" | "accounts" | "tasks";

export type Completeness = "full" | "partial" | "missing" | "unsupported";

export type DisplayState = "stale" | "login_missing" | "error" | "unknown";

export type AccountState = "checking" | "ok" | "login_missing" | "error" | "unknown";

export type SubmitState = "not_submitted" | "submitting" | "submitted_unknown" | "verified";

export type UserTaskStage =
  | "等待确认"
  | "排队中"
  | "打开发布页"
  | "填写内容"
  | "处理图片与封面"
  | "设置平台选项"
  | "提交中"
  | "核验结果"
  | "已发布"
  | "发布失败"
  | "需要人工"
  | "结果待核验";

export type AsyncView<T> =
  | { status: "loading" }
  | { status: "ready"; value: T; capturedAt: string }
  | { status: "empty"; reason: string }
  | {
      status: "error" | "missing" | "unsupported" | "stale" | "login_missing";
      message: string;
      previous?: T;
      capturedAt?: string;
    };

export type EnvChoice = { envId: string; name: string };

export type DraftInput = {
  id: string;
  title: string;
  summary: string;
  body: string;
  images: string[];
  cover: string;
  topics: string[];
  primaryPlatform: string;
  platforms: Record<string, { enabled: boolean }>;
  schedule: Record<string, never>;
  createdAt: string;
  updatedAt: string;
};

export type DraftSummary = {
  id: string;
  title: string;
  updatedAt: string;
  envId?: string;
};

export type MetricFact = {
  value: number | null;
  text: string;
  unit: string;
  completeness: Completeness;
  source: string;
  capturedAt: string;
};

export type HomeViewModel = {
  envId: string;
  capturedAt: string;
  attention: Array<{ id: string; title: string; detail: string; state: DisplayState | AccountState }>;
  pendingCount: number;
  failedCount: number;
  reads: MetricFact | null;
  revenue: MetricFact | null;
  recentTasks: Array<{ title: string; platform: string; stage: UserTaskStage | ""; updatedAt: string }>;
  recentComments: Array<{ platform: string; author: string; summary: string; createdAt: string }>;
};

export type MetricsViewModel = {
  envId: string;
  capturedAt: string;
  overview: { reads: MetricFact | null; follows: MetricFact | null; revenue: MetricFact | null };
  trend: Array<{ date: string; platform: string; reads: number | null; follows: number | null; revenue: string | null }>;
  ranking: Array<{ title: string; platform: string; reads: number | null; completeness: Completeness }>;
  compare: Array<{ platform: string; reads: number | null; likes: number | null; completeness: Completeness }>;
  revenueSplit: Array<{ platform: string; text: string; completeness: Completeness }>;
  exceptions: Array<{ platform: string; completeness: Completeness; reason: string }>;
};

export type CommentItem = {
  platform: string;
  commentId: string;
  author: string;
  content: string;
  title: string;
  articleId: string;
  createdAt: string;
};

export type CommentsViewModel = {
  envId: string;
  boards: Array<{
    platform: string;
    name: string;
    canReply: boolean;
    reason: string;
    comments: CommentItem[];
  }>;
};

export type TaskAttemptModel = {
  attemptId: string;
  envId: string;
  fromStep: string;
  startedAt: string;
  endedAt: string;
  error: string;
};

export type TaskReceiptModel = {
  jobId: string;
  runId: string;
  envId: string;
  platform: string;
  articleId: string;
  url: string;
  verifiedAt: string;
  summary: string;
};

export type TaskJobModel = {
  jobId: string;
  runId: string;
  draftId: string;
  envId: string;
  platform: string;
  stage: UserTaskStage;
  currentStep: string;
  submitState: SubmitState;
  attempts: TaskAttemptModel[];
  receipt?: TaskReceiptModel;
};

export type TasksViewModel = {
  envId: string;
  runs: Array<{
    runId: string;
    draftId: string;
    draftRevision: number;
    snapshotHash: string;
    envId: string;
    precheckId: string;
    confirmationId: string;
    confirmedAt: string;
    jobs: TaskJobModel[];
  }>;
};

export type StudioViewModel = {
  env: { envId: string; name: string; availableEnvs: EnvChoice[] };
  drafts: AsyncView<DraftSummary[]>;
  home: AsyncView<HomeViewModel>;
  metrics: AsyncView<MetricsViewModel>;
  comments: AsyncView<CommentsViewModel>;
  tasks: AsyncView<TasksViewModel>;
};

export type PrecheckRow = {
  platform: string;
  name: string;
  level: "ok" | "warn";
  marks: string[];
  skip: boolean;
};

export type PrecheckResult = {
  ok: true;
  code: "ok";
  message: string;
  precheckId: string;
  envId: string;
  draftRevision: number;
  snapshotHash: string;
  platforms: string[];
  rows: PrecheckRow[];
};

export type TaskChangedEvent = {
  eventId: string;
  eventType: string;
  occurredAt: string;
  envId: string;
  runId?: string;
  jobId?: string;
  attemptId?: string;
};

export type StudioError = {
  ok: false;
  code: string;
  message: string;
  envId: string;
};

export type SaveDraftResult = {
  ok: true;
  code: "ok";
  message: string;
  envId: string;
  revision: number;
  savedAt: string;
  draft: DraftInput;
};

export type ConfirmResult = {
  ok: true;
  code: "ok";
  message: string;
  envId: string;
  confirmationId: string;
  precheckId: string;
};

export type ReplyResult = {
  ok: boolean;
  code: string;
  message: string;
  envId: string;
};

export type PageActions = {
  navigate: (view: StudioViewId, filter?: string) => void;
  reload: (envId: string) => Promise<void>;
  saveDraft: (input: { envId: string; draft: DraftInput; revision: number }) => Promise<SaveDraftResult | StudioError>;
  precheck: (input: { envId: string; draft: DraftInput; revision: number }) => Promise<PrecheckResult | StudioError>;
  confirm: (input: { envId: string; precheckId: string; confirmationId: string }) => Promise<ConfirmResult | StudioError>;
  pickImages: (input: { envId: string; draftId: string; kind: "body" | "cover" }) => Promise<StudioError>;
  checkAccounts: (input: { envId: string; platforms: string[] }) => Promise<StudioError>;
  openAccount: (input: { envId: string; platform: string }) => Promise<StudioError>;
  refreshMetrics: (envId: string) => Promise<StudioError | { ok: true; code: "ok"; message: string; envId: string }>;
  openTask: (input: { envId: string; jobId: string }) => Promise<StudioError>;
  verifyTask: (input: { envId: string; jobId: string }) => Promise<StudioError>;
  resumeTask: (input: { envId: string; jobId: string; fromStep: string }) => Promise<StudioError>;
  fillReply: (input: { envId: string; platform: string; commentId: string; text: string; content?: string }) => Promise<ReplyResult | StudioError>;
  onTasksChanged: (envId: string, listener: (event: TaskChangedEvent) => void) => () => void;
};

export type PageMount<T> = (
  container: HTMLElement,
  viewModel: T,
  actions: PageActions,
) => { destroy: () => void };
