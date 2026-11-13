/**
 * 发布 JSONL 的唯一写入入口。
 * 旧命令走兼容行；工作台新事件在本阶段只能写明确标注的测试夹具，不能进生产台账。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const productionLedgerDir = path.join(skillRoot, "ledger");

export const FIXTURE_MARK = "sparo-studio-task-fixture";

export const STUDIO_EVENT_TYPES = [
  "studio.run.confirmed",
  "studio.job.updated",
  "studio.attempt.started",
  "studio.attempt.finished",
  "studio.receipt.verified",
];

const TYPE_FIELDS = {
  "studio.run.confirmed": ["runId", "draftId", "draftRevision", "snapshotHash", "precheckId", "confirmationId", "confirmedAt"],
  "studio.job.updated": ["runId", "jobId", "draftId", "platform", "stage", "currentStep", "submitState"],
  "studio.attempt.started": ["runId", "jobId", "attemptId", "snapshotHash", "fromStep", "startedAt"],
  "studio.attempt.finished": ["runId", "jobId", "attemptId", "endedAt"],
  "studio.receipt.verified": ["runId", "jobId", "platform", "verifiedAt"],
};

const OPTIONAL_FIELDS = ["title", "body", "platforms", "error", "errorCode", "hint", "articleId", "url", "summary", "fixture"];
const USER_STAGES = new Set([
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
const SUBMIT_STATES = new Set(["not_submitted", "submitting", "submitted_unknown", "verified"]);
const LEGACY_BANNED = ["eventId", "eventType", "runId", "jobId", "attemptId", "envId", "confirmationId", "precheckId", "snapshotHash", "draftRevision"];

const chains = new Map();

export function defaultLedgerPath(now = new Date()) {
  const stamp = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
  return path.join(productionLedgerDir, stamp + ".jsonl");
}

export function isProductionLedger(file) {
  if (!file) return false;
  const root = path.resolve(productionLedgerDir).toLowerCase();
  const target = path.resolve(file).toLowerCase();
  return target === root || target.startsWith(root + path.sep);
}

function resolveTarget(file) {
  return path.resolve(file || defaultLedgerPath());
}

function result(partial) {
  return {
    ok: partial.ok,
    code: partial.code,
    message: partial.message || "",
    appended: partial.appended === true,
    path: partial.path || "",
    row: partial.row ?? null,
  };
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isStudioShape(row) {
  return Boolean(row) && typeof row === "object" && typeof row.eventType === "string" && row.eventType.startsWith("studio.");
}

function readText(file) {
  if (!fs.existsSync(file)) return "";
  return fs.readFileSync(file, "utf8");
}

export function readLedgerLines(file) {
  if (!file || !fs.existsSync(file)) return [];
  const rows = [];
  for (const line of readText(file).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      rows.push(JSON.parse(trimmed));
    } catch {
      rows.push(null);
    }
  }
  return rows;
}

function findEvent(file, eventId) {
  for (const row of readLedgerLines(file)) {
    if (row && row.eventId === eventId) return row;
  }
  return null;
}

function appendLine(file, row) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(row) + "\n", "utf8");
}

function pick(row, keys) {
  const out = {};
  for (const key of keys) {
    if (row[key] !== undefined) out[key] = row[key];
  }
  return out;
}

function validateStudio(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    return { ok: false, code: "bad_row", message: "台账行不是对象" };
  }
  if (row.fixture !== FIXTURE_MARK) {
    return { ok: false, code: "fixture_required", message: "现在还不能创建生产发布批次。" };
  }
  const eventId = text(row.eventId);
  const eventType = text(row.eventType);
  const occurredAt = text(row.occurredAt);
  const envId = text(row.envId);
  if (!eventId || !eventType || !occurredAt) {
    return { ok: false, code: "bad_event", message: "工作台事件缺少事件编号、类型或时间。" };
  }
  if (!envId) {
    return { ok: false, code: "missing_env", message: "缺少环境，已停止。不会改用默认登录。" };
  }
  const fields = TYPE_FIELDS[eventType];
  if (!fields) {
    return { ok: false, code: "bad_event", message: "不认识的工作台事件。" };
  }
  for (const key of fields) {
    const value = row[key];
    if (key === "draftRevision") {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return { ok: false, code: "bad_event", message: "稿件修订号无效。" };
      }
      continue;
    }
    if (typeof value !== "string" || !value.trim()) {
      return { ok: false, code: "bad_event", message: "工作台事件缺少 " + key + "。" };
    }
  }
  if (eventType === "studio.job.updated") {
    if (!USER_STAGES.has(row.stage)) return { ok: false, code: "bad_event", message: "任务阶段无法识别。" };
    if (!SUBMIT_STATES.has(row.submitState)) return { ok: false, code: "bad_event", message: "提交状态无法识别。" };
  }
  if (row.platforms != null && (!Array.isArray(row.platforms) || row.platforms.some((item) => typeof item !== "string"))) {
    return { ok: false, code: "bad_event", message: "平台列表无法识别。" };
  }
  return { ok: true, eventId, eventType, occurredAt, envId, fields };
}

function storeStudio(row, checked) {
  return pick(row, ["eventId", "eventType", "occurredAt", "envId", ...checked.fields, ...OPTIONAL_FIELDS]);
}

function validateLegacy(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    return { ok: false, code: "bad_row", message: "台账行不是对象" };
  }
  if (isStudioShape(row)) {
    return { ok: false, code: "legacy_cannot_create_run", message: "旧台账入口不能创建工作台批次。" };
  }
  for (const key of LEGACY_BANNED) {
    const value = row[key];
    if (value != null && value !== "") {
      return { ok: false, code: "legacy_cannot_create_run", message: "旧台账入口不能创建工作台批次，也不会补环境。" };
    }
  }
  return { ok: true };
}

/** 所有发布 JSONL 字节都从这里追加。同一文件的检查和写入中间不让出事件循环。 */
export function commitLedger(file, row, kind) {
  const target = resolveTarget(file);
  if (kind === "studio") {
    if (isProductionLedger(target)) {
      return result({
        ok: false,
        code: "production_blocked",
        message: "不会往生产台账创建发布批次。",
        path: target,
      });
    }
    const checked = validateStudio(row);
    if (!checked.ok) return result({ ...checked, path: target });
    const existing = findEvent(target, checked.eventId);
    if (existing) {
      return result({
        ok: true,
        code: "duplicate",
        message: "这条事件已经记过",
        path: target,
        row: existing,
      });
    }
    const stored = storeStudio(row, checked);
    try {
      appendLine(target, stored);
    } catch {
      return result({ ok: false, code: "io", message: "台账没有写下", path: target });
    }
    return result({ ok: true, code: "appended", path: target, appended: true, row: stored });
  }
  const checked = validateLegacy(row);
  if (!checked.ok) return result({ ...checked, path: target });
  const stored = { ...row };
  try {
    appendLine(target, stored);
  } catch {
    return result({ ok: false, code: "io", message: "台账没有写下", path: target });
  }
  return result({ ok: true, code: "appended", path: target, appended: true, row: stored });
}

function enqueue(target, task) {
  const prev = chains.get(target) || Promise.resolve();
  const run = prev.then(task);
  chains.set(target, run.then(() => undefined, () => undefined));
  return run;
}

/** 兼容旧调用。工作台事件仍进同一写入函数，并且不能落进生产台账。 */
export function appendLedger(file, row) {
  if (isStudioShape(row)) return commitLedger(file, row, "studio");
  return commitLedger(file, row, "legacy");
}

/** 旧 CLI 与批量台账。不补 envId、runId、attemptId，也不能借这条路径建批次。 */
export function appendLegacyLedger(file, row) {
  return commitLedger(file, row, "legacy");
}

/** 工作台事件串行追加。相同 eventId 再次写入时返回已记录的那一行。 */
export function appendStudioEvent(file, event) {
  const target = file ? path.resolve(file) : "";
  if (!target || isProductionLedger(target)) {
    return Promise.resolve(result({
      ok: false,
      code: "production_blocked",
      message: "不会往生产台账创建发布批次。",
      path: target,
    }));
  }
  return enqueue(target, () => commitLedger(target, event, "studio"));
}
