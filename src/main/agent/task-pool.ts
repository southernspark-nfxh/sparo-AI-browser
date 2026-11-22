/**
 * 后台任务池。上限写死，以后才做设置项。
 * waiting_human 挂起，不占并发名额。
 */
import type { TaskLane } from "./task-class.js";
import { canTransition, type TaskLifecycleState } from "./task-state.js";

/** 同时在跑的后台任务上限。写死，不做用户设置。 */
export const TASK_POOL_LIMIT = 3;

/** 规范生命周期。finish() 只落执行结果，不把记录从池里删掉。 */
export type TaskCardState = TaskLifecycleState;

export type TaskResultCard = {
  status: "done";
  summary: string;
  tabId: string;
  url: string;
  outputs: string[];
  unfinished: string[];
  needsAccept: boolean;
  finishedAt: number;
};

export type PoolTask = {
  id: string;
  tabId: string;
  title: string;
  lane: TaskLane;
  state: TaskCardState;
  step: string;
  clientId?: string;
  agentName?: string;
  /** 旧身份色。T01 起不得再拿它做状态色。 */
  color?: string;
  lastLine?: string;
  result?: string;
  updatedAt?: number;
  leaseId?: string;
  /** 跨页父任务编号。父任务本身不在这张卡上占页。 */
  groupId?: string;
  /** 这张任务原来的整句和会话。恢复时用它，不用截断标题。 */
  origin?: { chatKey: string; input: string };
  /** 结构化核验回执。没有通过的回执，不能出完成卡。 */
  verification?: { ok: boolean; items: Array<{ name: string; ok: boolean }>; at: number };
  /** 黄色人工的具体原因。 */
  humanReason?: string;
  /** 红色异常卡住的那一步。finish 不会把它改成空泛的「失败」。 */
  failureStep?: string;
  attempts?: string[];
  advice?: string;
  /** 总指挥聊天已经报过的种类，避免同一件事反复刷。 */
  notice?: "human" | "failed" | "done";
  resultCard?: TaskResultCard;
};

export type TaskCardView = {
  id: string;
  tabId: string;
  title: string;
  lane: TaskLane;
  state: TaskCardState;
  step: string;
  clientId?: string;
  agentName?: string;
  color?: string;
  lastLine?: string;
  result?: string;
  updatedAt?: number;
  leaseId?: string;
  groupId?: string;
  origin?: { chatKey: string; input: string };
  verification?: { ok: boolean; items: Array<{ name: string; ok: boolean }>; at: number };
  humanReason?: string;
  failureStep?: string;
  attempts?: string[];
  advice?: string;
  notice?: "human" | "failed" | "done";
  resultCard?: TaskResultCard;
};

export class TaskPool {
  readonly tasks: PoolTask[] = [];
  foregroundBusy = false;

  /** 保活用：还在跑、在排队、或等用户的任务数。做完的不算。 */
  get size(): number {
    return this.tasks.filter(
      (task) => task.state === "running" || task.state === "queued" || task.state === "waiting_human",
    ).length;
  }

  runningBackground(): number {
    return this.tasks.filter((task) => task.lane === "background" && task.state === "running").length;
  }

  canStartBackground(): boolean {
    return this.runningBackground() < TASK_POOL_LIMIT;
  }

  tryStartForeground(): boolean {
    if (this.foregroundBusy) return false;
    this.foregroundBusy = true;
    return true;
  }

  releaseForeground(): void {
    this.foregroundBusy = false;
  }

  start(input: {
    id: string;
    tabId: string;
    title: string;
    lane: TaskLane;
    clientId?: string;
    agentName?: string;
    color?: string;
    lastLine?: string;
  }): PoolTask {
    const task: PoolTask = {
      ...input,
      state: "running",
      step: "进行中",
    };
    this.tasks.push(task);
    return task;
  }

  enqueue(input: {
    id: string;
    tabId: string;
    title: string;
    lane: TaskLane;
    clientId?: string;
    agentName?: string;
    color?: string;
    lastLine?: string;
  }): PoolTask {
    const task: PoolTask = {
      ...input,
      state: "queued",
      step: "",
    };
    this.tasks.push(task);
    this.renumberQueue();
    return task;
  }

  suspend(id: string): void {
    const task = this.tasks.find((item) => item.id === id);
    if (!task) return;
    task.state = "waiting_human";
    task.step = "等你处理";
  }

  markRunning(id: string): void {
    const task = this.tasks.find((item) => item.id === id);
    if (!task) return;
    task.state = "running";
    task.step = "接着做";
  }

  /** 池满时把挂起的任务插回队首，腾出名额再开。 */
  requeueFront(id: string): PoolTask | undefined {
    const task = this.tasks.find((item) => item.id === id);
    if (!task) return undefined;
    task.state = "queued";
    const rest = this.tasks.filter((item) => item !== task);
    const at = rest.findIndex((item) => item.state === "queued");
    if (at < 0) rest.unshift(task);
    else rest.splice(at, 0, task);
    this.tasks.splice(0, this.tasks.length, ...rest);
    this.renumberQueue();
    return task;
  }

  setStep(id: string, step: string): void {
    const task = this.tasks.find((item) => item.id === id);
    if (!task || task.state !== "running") return;
    task.step = step.replace(/\s+/g, " ").trim().slice(0, 48);
  }

  finish(id: string, state: "done" | "failed" | "stopped" = "done"): PoolTask | undefined {
    const task = this.tasks.find((item) => item.id === id);
    if (!task || task.state === "closed") return task;
    // 停止和异常已经落账。迟到的完成回调不能再改成完成。
    if (task.state === "stopped" || task.state === "failed") return task;
    if (task.state === "done" && state !== "done") return task;
    task.state = state;
    task.step =
      state === "failed" && task.failureStep
        ? task.failureStep
        : state === "done"
          ? "完成"
          : state === "stopped"
            ? "已停止"
            : "失败";
    task.updatedAt = Date.now();
    this.renumberQueue();
    return task;
  }

  /** 人点名停掉一张已经失败的卡。改成已停止，记录和页面都留着。 */
  acceptManualStop(id: string): PoolTask | undefined {
    const task = this.tasks.find((item) => item.id === id);
    if (!task || !canTransition(task.state, "stopped", "stop") || task.state !== "failed") return undefined;
    task.state = "stopped";
    task.step = "已停止";
    task.updatedAt = Date.now();
    this.renumberQueue();
    return task;
  }

  /** 明确结束。运行中的任务不能直接归档。 */
  close(id: string): PoolTask | undefined {
    const task = this.tasks.find((item) => item.id === id);
    if (!task || task.state === "closed") return task;
    if (task.state === "running" || task.state === "queued" || task.state === "waiting_human") return undefined;
    task.state = "closed";
    task.step = "已结束";
    task.updatedAt = Date.now();
    return task;
  }

  /** 收掉被扔下的卡。不改状态，条子上不再出现。 */
  dismiss(id: string): PoolTask | undefined {
    const index = this.tasks.findIndex((item) => item.id === id);
    if (index < 0) return undefined;
    const [task] = this.tasks.splice(index, 1);
    this.renumberQueue();
    return task;
  }

  promoteNext(): PoolTask | undefined {
    if (!this.canStartBackground()) return undefined;
    const next = this.tasks.find((task) => task.lane === "background" && task.state === "queued");
    if (!next) return undefined;
    next.state = "running";
    next.step = "进行中";
    this.renumberQueue();
    return next;
  }

  renumberQueue(): void {
    let n = 0;
    for (const task of this.tasks) {
      if (task.state !== "queued") continue;
      n += 1;
      task.step = `排队中（第 ${n} 位）`;
    }
  }

  visible(): TaskCardView[] {
    return this.tasks
      .filter((task) => task.state !== "closed")
      .map((task) => {
        const view: TaskCardView = {
          id: task.id,
          tabId: task.tabId,
          title: task.title,
          lane: task.lane,
          state: task.state,
          step: task.step,
          clientId: task.clientId,
          agentName: task.agentName,
          color: task.color,
          lastLine: task.lastLine,
        };
        if (task.result != null) view.result = task.result;
        if (task.updatedAt != null) view.updatedAt = task.updatedAt;
        if (task.leaseId != null) view.leaseId = task.leaseId;
        if (task.groupId != null) view.groupId = task.groupId;
        if (task.origin != null) view.origin = task.origin;
        if (task.verification != null) view.verification = task.verification;
        if (task.humanReason != null) view.humanReason = task.humanReason;
        if (task.failureStep != null) view.failureStep = task.failureStep;
        if (task.attempts != null) view.attempts = task.attempts;
        if (task.advice != null) view.advice = task.advice;
        if (task.notice != null) view.notice = task.notice;
        if (task.resultCard != null) view.resultCard = task.resultCard;
        return view;
      });
  }
}

/**
 * 只有本轮结果自己挂起才挂起。
 * 上一张单还在等人时，不能把这一轮已经写出的答案涂成等你处理。
 */
export function shouldSuspend(
  result: { data?: unknown } | undefined,
  _activeMission?: { state?: string },
): boolean {
  const data = result?.data;
  if (!data || typeof data !== "object") return false;
  return (data as { loop?: string }).loop === "waiting_human";
}
