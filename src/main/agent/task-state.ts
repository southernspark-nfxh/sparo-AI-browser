/**
 * 任务状态、四色和页面绑定的唯一契约。
 * 颜色只表达运行状态。Agent 是谁，用名称说，不进这个模块。
 * 分配器在 T02，完成保留在 T03。这里只判断，不改页面。
 */

export type TaskLifecycleState =
  | "queued"
  | "running"
  | "waiting_human"
  | "failed"
  | "done"
  | "stopped"
  | "closed";

/** 没有任务的网页。不是第八种任务状态。 */
export type PageProjectionState = TaskLifecycleState | "idle";

export type TaskTone = "green" | "red" | "yellow" | "gray";

export type StatusSurface = "tab" | "sidebar" | "command";

export type TransitionKind = "advance" | "resume" | "close" | "requeue" | "stop";

/** 页面—任务—Agent 绑定。releasedAt 为空表示仍占用，不能靠颜色判断空闲。 */
export type PageBinding = {
  tabId: string;
  taskId: string;
  clientId: string;
  boundAt: number;
  releasedAt?: number;
  releaseReason?: string;
};

/** 五条必须同时成立，页面才可复用。 */
export type PageReuseSnapshot = {
  hasAgent: boolean;
  hasOpenTask: boolean;
  leaseActive: boolean;
  released: boolean;
  idle: boolean;
};

export type StatusProjection = {
  state: PageProjectionState;
  tone: TaskTone;
  label: string;
  step: string;
  retainsLease: boolean;
};

const PROJECTION: Record<
  PageProjectionState,
  { tone: TaskTone; label: string; step: string; retainsLease: boolean }
> = {
  queued: { tone: "green", label: "排队中", step: "排队中", retainsLease: true },
  running: { tone: "green", label: "进行中", step: "进行中", retainsLease: true },
  waiting_human: { tone: "yellow", label: "等待人工", step: "等待人工", retainsLease: true },
  failed: { tone: "red", label: "卡住／异常", step: "卡住／异常", retainsLease: true },
  done: { tone: "gray", label: "已完成·待验收", step: "已完成·待验收", retainsLease: true },
  stopped: { tone: "gray", label: "已停止·待结束", step: "已停止·待结束", retainsLease: true },
  closed: { tone: "gray", label: "已结束", step: "已结束", retainsLease: false },
  idle: { tone: "gray", label: "静止／无 Agent", step: "静止／无 Agent", retainsLease: false },
};

const ADVANCE: Record<TaskLifecycleState, readonly TaskLifecycleState[]> = {
  queued: ["running", "stopped", "failed"],
  running: ["waiting_human", "failed", "done", "stopped"],
  waiting_human: ["failed", "stopped"],
  failed: [],
  done: [],
  stopped: [],
  closed: [],
};

/** 三处界面共用这一份。surface 不改变颜色、文案或是否占页。 */
export function projectStatus(state: PageProjectionState, _surface?: StatusSurface): StatusProjection {
  const row = PROJECTION[state];
  return { state, ...row };
}

/** 这一页上的任务事实。调用方可以多传，投影会丢掉别的页。 */
export type PageTaskFact = {
  id: string;
  tabId: string;
  state: TaskLifecycleState;
  step?: string;
  title?: string;
  clientId?: string;
  agentName?: string;
  lastLine?: string;
  result?: string;
  updatedAt?: number;
};

export type PageStatusInput = {
  tabId: string;
  tasks?: PageTaskFact[];
  lease?: { clientId?: string; taskId?: string; releasedAt?: number } | null;
  ownerClientId?: string;
  ownerName?: string;
  /** 侧栏正在这张页上跑，池里还没有卡。不能拿去点亮别的页。 */
  foregroundOnThisTab?: boolean;
  /** 这张页自己的已下班标记。没有未关闭任务时才用来显示完成，不拿别的页来补。 */
  markedDone?: boolean;
  /** 这张页是被停下的，不是做完的。优先于已完成。 */
  markedStopped?: boolean;
};

export type PageStatusSnapshot = {
  tabId: string;
  taskId: string;
  agentName: string;
  state: PageProjectionState;
  tone: TaskTone;
  label: string;
  step: string;
  updatedAt: number;
  summary: string;
  title: string;
};

const TASK_RANK: Record<TaskLifecycleState, number> = {
  failed: 6,
  waiting_human: 5,
  running: 4,
  queued: 3,
  stopped: 2,
  done: 1,
  closed: 0,
};

/** 没有真实动作时不写「正在努力」。排队和进行中各有一句空步骤。 */
export function concreteStep(state: PageProjectionState, raw?: string): string {
  const step = String(raw || "").replace(/\s+/g, " ").trim();
  const vague = !step || /正在努力|努力中|拼命处理|加紧处理/.test(step);
  if (state === "queued") {
    if (vague || step === "进行中" || step === "等待下一步") return "排队中";
    return step;
  }
  if (state === "running") {
    if (vague || step === "进行中" || step === "排队中") return "等待下一步";
    return step;
  }
  if (state === "idle") return PROJECTION.idle.step;
  if (vague) return PROJECTION[state].step;
  return step;
}

function summaryFor(state: PageProjectionState, task: PageTaskFact | undefined): string {
  if (!task || state === "idle" || state === "queued" || state === "running") {
    return String(task?.result || "").trim();
  }
  return String(task.result || task.lastLine || "").trim();
}

/**
 * 一页一份快照。只认这张 tabId 上的租约、任务和归属。
 * 红色、黄色压过绿色。别的页的任务即使属于同一个 Agent 也不许混进来。
 */
export function projectPageSnapshot(input: PageStatusInput): PageStatusSnapshot {
  const tabId = String(input.tabId || "");
  let picked: PageTaskFact | undefined;
  for (const task of input.tasks || []) {
    if (!task || task.tabId !== tabId || task.state === "closed") continue;
    if (!picked || TASK_RANK[task.state] > TASK_RANK[picked.state]) picked = task;
  }
  const lease = input.lease && input.lease.releasedAt == null ? input.lease : null;
  const owned = Boolean(picked?.clientId || picked?.agentName || input.ownerClientId || lease?.clientId);
  let state: PageProjectionState = picked?.state || "idle";
  if (!picked && input.foregroundOnThisTab && owned) state = "running";
  else if (!picked && input.markedStopped && owned) state = "stopped";
  else if (!picked && input.markedDone && owned) state = "done";
  const projected = projectStatus(state);
  const carriedId =
    !picked && lease?.taskId && (state === "done" || state === "failed" || state === "stopped")
      ? lease.taskId
      : "";
  return {
    tabId,
    taskId: picked?.id || carriedId,
    agentName: picked?.agentName || (owned ? input.ownerName || "" : ""),
    state,
    tone: projected.tone,
    label: projected.label,
    step: concreteStep(state, picked?.step),
    updatedAt: picked?.updatedAt || 0,
    summary: summaryFor(state, picked),
    title: picked?.title || "",
  };
}

export function retainsLease(state: PageProjectionState): boolean {
  return PROJECTION[state].retainsLease;
}

/** 执行已经停下，但记录还在。done 在这里，closed 不在。 */
export function isTerminalExecution(state: PageProjectionState): boolean {
  return state === "done" || state === "failed" || state === "stopped";
}

/** 生命周期终点。归档，不是删聊天、删历史。 */
export function isClosed(state: PageProjectionState): boolean {
  return state === "closed";
}

export function isLeaseActive(binding: Pick<PageBinding, "releasedAt"> | null | undefined): boolean {
  return !!binding && binding.releasedAt == null;
}

export function canReusePage(snapshot: PageReuseSnapshot): boolean {
  return (
    snapshot.hasAgent === false &&
    snapshot.hasOpenTask === false &&
    snapshot.leaseActive === false &&
    snapshot.released === true &&
    snapshot.idle === true
  );
}

/** 仍占着页的任务，快照直接不可复用。closed 只表示绑定可以结束，页面还要真正回到 idle。 */
export function occupiedSnapshot(state: TaskLifecycleState): PageReuseSnapshot {
  const lease = retainsLease(state);
  return {
    hasAgent: lease,
    hasOpenTask: state !== "closed",
    leaseActive: lease,
    released: !lease,
    idle: false,
  };
}

/**
 * 合法迁移。
 * done 不能借续跑回到 running。
 * stopped / failed / waiting_human 只有明确的原任务恢复才能回到 running。
 * closed 之后不能再迁。
 */
export function canTransition(
  from: TaskLifecycleState,
  to: TaskLifecycleState,
  kind: TransitionKind = "advance",
): boolean {
  if (from === "closed" || from === to) return false;
  if (to === "running" && from === "done") return false;
  if (kind === "close") {
    return (from === "done" || from === "failed" || from === "stopped") && to === "closed";
  }
  if (kind === "resume") {
    return (from === "failed" || from === "stopped" || from === "waiting_human") && to === "running";
  }
  if (kind === "requeue") {
    return (from === "running" || from === "waiting_human") && to === "queued";
  }
  if (kind === "stop") {
    return (
      (from === "queued" || from === "running" || from === "waiting_human" || from === "failed") &&
      to === "stopped"
    );
  }
  return ADVANCE[from].includes(to);
}
