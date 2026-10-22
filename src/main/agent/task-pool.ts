/**
 * 后台任务池。上限写死，以后才做设置项。
 * waiting_human 挂起，不占并发名额。
 */
import type { TaskLane } from "./task-class.js";

/** 同时在跑的后台任务上限。写死，不做用户设置。 */
export const TASK_POOL_LIMIT = 3;

export type TaskCardState = "running" | "queued" | "waiting_human" | "done" | "failed";

export type PoolTask = {
  id: string;
  tabId: string;
  title: string;
  lane: TaskLane;
  state: TaskCardState;
  step: string;
};

export type TaskCardView = {
  id: string;
  tabId: string;
  title: string;
  lane: TaskLane;
  state: TaskCardState;
  step: string;
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

  start(input: { id: string; tabId: string; title: string; lane: TaskLane }): PoolTask {
    const task: PoolTask = {
      ...input,
      state: "running",
      step: "进行中",
    };
    this.tasks.push(task);
    return task;
  }

  enqueue(input: { id: string; tabId: string; title: string; lane: TaskLane }): PoolTask {
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

  finish(id: string, state: "done" | "failed" = "done"): PoolTask | undefined {
    const task = this.tasks.find((item) => item.id === id);
    if (!task) return undefined;
    task.state = state;
    task.step = state === "done" ? "完成" : "失败";
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
    const active = this.tasks.filter(
      (task) => task.state === "running" || task.state === "queued" || task.state === "waiting_human",
    );
    const finished = this.tasks
      .filter((task) => task.state === "done" || task.state === "failed")
      .slice(-3);
    return [...active, ...finished].map((task) => ({
      id: task.id,
      tabId: task.tabId,
      title: task.title,
      lane: task.lane,
      state: task.state,
      step: task.step,
    }));
  }
}
