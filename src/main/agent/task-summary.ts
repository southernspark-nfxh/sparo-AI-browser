/**
 * 任务摘要落盘。重启后可以查询，不自动重放。
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type TaskSummary = {
  taskId: string;
  goal: string;
  status: string;
  lastStep: string;
  at: number;
  clientId?: string;
};

export function taskSummaryPath(dir: string): string {
  return join(dir, "agent-task-summaries.json");
}

export function readTaskSummaries(dir: string): TaskSummary[] {
  try {
    const raw = JSON.parse(readFileSync(taskSummaryPath(dir), "utf8")) as { tasks?: TaskSummary[] };
    return Array.isArray(raw.tasks) ? raw.tasks.filter((item) => item?.taskId) : [];
  } catch {
    return [];
  }
}

export function writeTaskSummaries(dir: string, tasks: TaskSummary[]): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(taskSummaryPath(dir), JSON.stringify({ tasks: tasks.slice(-40) }, null, 2), "utf8");
}

export function upsertTaskSummary(tasks: TaskSummary[], next: TaskSummary): TaskSummary[] {
  return [...tasks.filter((item) => item.taskId !== next.taskId), next].slice(-40);
}
