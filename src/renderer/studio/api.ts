/**
 * sparkStudio 的类型化封装。页面只通过 PageActions 调用这里，不直接碰 IPC。
 */
import { TASK_EVENT_CHANNEL, type DraftInput, type PrecheckResult, type ReplyResult, type SaveDraftResult, type StudioError, type TaskChangedEvent } from "./types.js";

export type EnvChoice = { envId: string; name: string };

export type LegacyOverview = { pending: number; failed: number; login: string };

export type LegacyMetrics = {
  overview: { reads: string; follows: string; revenue: string; exceptions: string[] };
  trend: Array<{ date?: string; platform?: string; reads?: number | null; follows?: number | null; revenue?: string | null }>;
  ranking: Array<{ title?: string; platform?: string; reads?: number | null; completeness?: string }>;
  compare: Array<{ platform?: string; reads?: number | null; likes?: number | null; completeness?: string }>;
  revenueSplit: Array<{ platform?: string; text?: string }>;
  capturedAt?: string;
} | null;

export type LegacyComment = {
  commentId?: string;
  author?: string;
  content?: string;
  title?: string;
  articleId?: string;
  createdAt?: string;
};

export type LegacyBoard = {
  platform?: string;
  name?: string;
  canReply?: boolean;
  reason?: string;
  comments?: LegacyComment[];
};

export type StudioLoad =
  | {
      ok: true;
      code: "ok";
      message: string;
      envId: string;
      name: string;
      availableEnvs: EnvChoice[];
      drafts: DraftInput[];
      draft: DraftInput;
      overview: LegacyOverview;
      ledger: Array<{ platform?: string; title?: string; ok?: boolean; reason?: string; hint?: string }>;
      metrics: LegacyMetrics;
      comments: LegacyBoard[];
      readError?: string;
    }
  | (StudioError & { availableEnvs?: EnvChoice[] });

type SparkBridge = {
  load: (payload: { envId: string }) => Promise<StudioLoad>;
  create: (payload: { envId: string }) => Promise<{ ok: true; code: "ok"; message: string; envId: string; draft: DraftInput } | StudioError>;
  save: (payload: { envId: string; draft: DraftInput; revision: number }) => Promise<SaveDraftResult | StudioError>;
  precheck: (payload: { envId: string; draft: DraftInput; revision: number }) => Promise<PrecheckResult | StudioError>;
  confirm: (payload: { envId: string; precheckId: string; confirmationId: string }) => Promise<
    { ok: true; code: "ok"; message: string; envId: string; confirmationId: string; precheckId: string } | StudioError
  >;
  refresh: (payload: { envId: string }) => Promise<StudioLoad>;
  reply: (payload: { envId: string; platform: string; text: string; commentId: string; content?: string }) => Promise<ReplyResult | StudioError>;
  pickImages: (payload: { envId: string; draftId: string; kind: "body" | "cover" }) => Promise<StudioError>;
  checkAccounts: (payload: { envId: string; platforms: string[] }) => Promise<StudioError>;
  openAccount: (payload: { envId: string; platform: string }) => Promise<StudioError>;
  queryTasks: (payload: { envId: string }) => Promise<StudioError>;
  openTask: (payload: { envId: string; jobId: string }) => Promise<StudioError>;
  verifyTask: (payload: { envId: string; jobId: string }) => Promise<StudioError>;
  resumeTask: (payload: { envId: string; jobId: string; fromStep: string }) => Promise<StudioError>;
  onTasksChanged: (envId: string, listener: (event: TaskChangedEvent) => void) => () => void;
};

function bridge(): SparkBridge | null {
  const host = globalThis as { sparkStudio?: SparkBridge };
  return host.sparkStudio || null;
}

function offline(envId = ""): StudioError {
  return { ok: false, code: "unsupported", message: "工作台桥还没有就绪", envId };
}

export function taskEventForEnv(event: TaskChangedEvent, envId: string): boolean {
  return Boolean(envId) && event.envId === envId;
}

export function subscribeTaskEvents(
  envId: string,
  listener: (event: TaskChangedEvent) => void,
  bus: { listen: (fn: (event: TaskChangedEvent) => void) => () => void },
): () => void {
  return bus.listen((event) => {
    if (taskEventForEnv(event, envId)) listener(event);
  });
}

export const api = {
  load(envId: string): Promise<StudioLoad> {
    const spark = bridge();
    if (!spark) return Promise.resolve({ ...offline(envId), availableEnvs: [] });
    return spark.load({ envId });
  },
  create(envId: string) {
    const spark = bridge();
    if (!spark) return Promise.resolve(offline(envId));
    return spark.create({ envId });
  },
  saveDraft(input: { envId: string; draft: DraftInput; revision: number }) {
    const spark = bridge();
    if (!spark) return Promise.resolve(offline(input.envId));
    return spark.save(input);
  },
  precheck(input: { envId: string; draft: DraftInput; revision: number }) {
    const spark = bridge();
    if (!spark) return Promise.resolve(offline(input.envId));
    return spark.precheck(input);
  },
  confirm(input: { envId: string; precheckId: string; confirmationId: string }) {
    const spark = bridge();
    if (!spark) return Promise.resolve(offline(input.envId));
    return spark.confirm(input);
  },
  refresh(envId: string) {
    const spark = bridge();
    if (!spark) return Promise.resolve({ ...offline(envId), availableEnvs: [] });
    return spark.refresh({ envId });
  },
  fillReply(input: { envId: string; platform: string; commentId: string; text: string; content?: string }) {
    const spark = bridge();
    if (!spark) return Promise.resolve(offline(input.envId));
    return spark.reply(input);
  },
  pickImages(input: { envId: string; draftId: string; kind: "body" | "cover" }) {
    const spark = bridge();
    if (!spark) return Promise.resolve(offline(input.envId));
    return spark.pickImages(input);
  },
  checkAccounts(input: { envId: string; platforms: string[] }) {
    const spark = bridge();
    if (!spark) return Promise.resolve(offline(input.envId));
    return spark.checkAccounts(input);
  },
  openAccount(input: { envId: string; platform: string }) {
    const spark = bridge();
    if (!spark) return Promise.resolve(offline(input.envId));
    return spark.openAccount(input);
  },
  queryTasks(envId: string) {
    const spark = bridge();
    if (!spark) return Promise.resolve(offline(envId));
    return spark.queryTasks({ envId });
  },
  openTask(input: { envId: string; jobId: string }) {
    const spark = bridge();
    if (!spark) return Promise.resolve(offline(input.envId));
    return spark.openTask(input);
  },
  verifyTask(input: { envId: string; jobId: string }) {
    const spark = bridge();
    if (!spark) return Promise.resolve(offline(input.envId));
    return spark.verifyTask(input);
  },
  resumeTask(input: { envId: string; jobId: string; fromStep: string }) {
    const spark = bridge();
    if (!spark) return Promise.resolve(offline(input.envId));
    return spark.resumeTask(input);
  },
  onTasksChanged(envId: string, listener: (event: TaskChangedEvent) => void): () => void {
    const spark = bridge();
    if (!spark) return () => {};
    return subscribeTaskEvents(envId, listener, {
      listen: (fn) => spark.onTasksChanged(envId, fn),
    });
  },
  channel: TASK_EVENT_CHANNEL,
};
