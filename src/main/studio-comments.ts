/**
 * 评论收件箱服务。页面不直接调用这里。
 * 缺环境就停止；填框结果不等于已回复。
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { CommentItem, CommentsViewModel, ReplyResult, StudioError } from "../renderer/studio/types.js";
import { resolveStudioEnv } from "./studio-env.js";

export const REPLY_PLATFORMS = ["toutiao", "baijiahao"] as const;

export type DataStatus = "ready" | "empty" | "error" | "login_missing" | "unsupported";

export type CommentRecord = {
  envId: string;
  platform: string;
  commentId: string;
  author: string;
  content: string;
  title: string;
  articleId: string;
  createdAt: string;
  draftText: string;
  pendingReply: string;
  replied: boolean;
  association: "linked" | "unlinked";
  linkLabel: string;
};

export type CommentStore = {
  version: 2;
  legacyMerged: boolean;
  records: CommentRecord[];
  drafts: Array<{
    envId: string;
    platform: string;
    commentId: string;
    text: string;
    stamps: number[];
    association: "linked" | "unlinked";
    linkLabel: string;
  }>;
  notes: Array<{ envId: string; platform: string; reason: string }>;
};

export type StatusBoard = {
  platform: string;
  name: string;
  open?: boolean;
  canReply?: boolean;
  reason?: string;
};

export type InboxComment = CommentItem & { replied: boolean };

export type InboxBoard = CommentsViewModel["boards"][number] & {
  comments: InboxComment[];
  dataStatus: DataStatus;
  unrepliedCount: number | null;
};

export type InboxModel = CommentsViewModel & {
  envName: string;
  boards: InboxBoard[];
};

export type FillHooks = {
  now?: number;
  probe?: (ctx: { envId: string; platform: string; commentId: string; text: string }) => Promise<unknown> | unknown;
  listTabs?: () => Promise<Array<{ id?: string; url?: string; envId?: string }>>;
  exec?: (script: string, tabId: string) => Promise<unknown>;
};

type FillContext = {
  envId: string;
  storeDir: string;
  commentId: string;
  content: string;
  now?: number;
  probe?: FillHooks["probe"];
  listTabs?: FillHooks["listTabs"];
  exec?: FillHooks["exec"];
};

export type CommentActionResult = ReplyResult & {
  filled?: boolean;
  replied?: boolean;
  kept?: boolean;
  focusPlatform?: string;
  retryAt?: number;
};

export type CommentsPort = {
  canReply: (platform: string) => boolean;
  listCommentStatus: () => StatusBoard[];
  loadCommentStore: (dir: string) => CommentStore;
  listCachedComments: (dir: string, envId: string) => CommentRecord[];
  saveReplyDraft: (platform: string, text: string, meta: { envId?: string; storeDir?: string; commentId?: string }) => { text?: string };
  fillOpenReply: (platform: string, text: string, comment: FillContext) => Promise<CommentActionResult>;
  reconcileWithGet: (
    dir: string,
    envId: string,
    platform: string,
    fetched: Array<{ commentId?: string; author?: string; content?: string; title?: string; articleId?: string; createdAt?: string; replies?: string[]; replyText?: string }>,
  ) => CommentActionResult & { records?: CommentRecord[] };
};

const REPLY = new Set<string>(REPLY_PLATFORMS);

function probeOpen(board: StatusBoard): boolean {
  if (board.open === false) return false;
  if (board.open === true) return true;
  return !/未实测|未通|不可用/.test(board.reason || "");
}

export function boardDataStatus(reason: string, count: number): DataStatus {
  if (/登录/.test(reason)) return "login_missing";
  if (/未实测|探针未通|不可用/.test(reason)) return "unsupported";
  if (/不是 JSON|读取失败|失败/.test(reason)) return "error";
  if (count === 0) return "empty";
  return "ready";
}

export function buildCommentsViewModel(input: {
  envId: string;
  envName: string;
  boards: StatusBoard[];
  records: CommentRecord[];
  notes?: Array<{ envId: string; platform: string; reason: string }>;
}): InboxModel {
  const notes = (input.notes || []).filter((note) => note.envId === input.envId);
  return {
    envId: input.envId,
    envName: input.envName,
    boards: input.boards.map((board) => {
      const open = probeOpen(board);
      const noteReason = notes.find((note) => note.platform === board.platform)?.reason || "";
      const blocked = !open ? (board.reason || "评论接口未实测") : "";
      const hold = /登录|不是 JSON|读取失败|失败|未实测|探针未通|不可用/.test(blocked || noteReason);
      const mine = hold
        ? []
        : input.records.filter((item) => item.association === "linked" && item.envId === input.envId && item.platform === board.platform);
      const comments: InboxComment[] = mine.map((item) => ({
        platform: item.platform,
        commentId: item.commentId,
        author: item.author,
        content: item.content,
        title: item.title,
        articleId: item.articleId,
        createdAt: item.createdAt,
        replied: item.replied === true,
      }));
      let reason = blocked || noteReason;
      if (open && !hold && !reason && comments.length === 0) reason = "列表为空";
      const dataStatus = boardDataStatus(reason, comments.length);
      return {
        platform: board.platform,
        name: board.name,
        canReply: REPLY.has(board.platform) && open && board.canReply !== false && dataStatus !== "login_missing" && dataStatus !== "unsupported" && dataStatus !== "error",
        reason,
        comments,
        dataStatus,
        unrepliedCount: dataStatus === "ready" || dataStatus === "empty"
          ? comments.filter((item) => !item.replied).length
          : null,
      };
    }),
  };
}

export function loadCommentInbox(
  configDir: string,
  storeDir: string,
  envId: string,
  port: CommentsPort,
): InboxModel | StudioError {
  const env = resolveStudioEnv(configDir, envId);
  if (!env.ok) return env;
  const store = port.loadCommentStore(storeDir);
  return buildCommentsViewModel({
    envId: env.envId,
    envName: env.name,
    boards: port.listCommentStatus(),
    records: store.records,
    notes: store.notes,
  });
}

export async function fillCommentReply(
  configDir: string,
  storeDir: string,
  input: { envId: string; platform: string; commentId: string; text: string; content?: string },
  port: CommentsPort,
  hooks: FillHooks = {},
): Promise<CommentActionResult> {
  const env = resolveStudioEnv(configDir, input.envId);
  if (!env.ok) return env;
  if (!port.canReply(input.platform)) {
    return { ok: false, code: "readonly", message: "只读，回复未开", envId: env.envId, replied: false };
  }
  const text = String(input.text || "").trim();
  if (!text) return { ok: false, code: "empty", message: "回复草稿是空的，没有填写。", envId: env.envId, replied: false, kept: true };
  const store = port.loadCommentStore(storeDir);
  const unlinked = store.records.find((item) => item.platform === input.platform && item.commentId === input.commentId && item.association === "unlinked");
  const record = store.records.find((item) => item.association === "linked" && item.envId === env.envId && item.platform === input.platform && item.commentId === input.commentId);
  if (!record) {
    return {
      ok: false,
      code: unlinked ? "unlinked" : "unlinked_or_missing",
      message: unlinked ? "这条评论未关联，不能在当前环境回复。" : "这条评论不属于当前环境，已停止。不会改用别的环境。",
      envId: env.envId,
      replied: false,
      kept: true,
    };
  }
  port.saveReplyDraft(input.platform, text, { envId: env.envId, storeDir, commentId: input.commentId });
  try {
    const filled = await port.fillOpenReply(input.platform, text, {
      envId: env.envId,
      storeDir,
      commentId: input.commentId,
      content: input.content || record.content,
      now: hooks.now,
      probe: hooks.probe,
      listTabs: hooks.listTabs,
      exec: hooks.exec,
    });
    return { ...filled, envId: env.envId, replied: false };
  } catch {
    return { ok: false, code: "fill_failed", message: "没有写进回复框，草稿还留着。", envId: env.envId, replied: false, kept: true };
  }
}

export function ingestCommentGet(
  configDir: string,
  storeDir: string,
  envId: string,
  platform: string,
  fetched: Array<{ commentId?: string; author?: string; content?: string; title?: string; articleId?: string; createdAt?: string; replies?: string[]; replyText?: string }>,
  port: CommentsPort,
): CommentActionResult {
  const env = resolveStudioEnv(configDir, envId);
  if (!env.ok) return env;
  return port.reconcileWithGet(storeDir, env.envId, platform, fetched);
}

function isCommentsPort(value: unknown): value is CommentsPort {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.canReply === "function"
    && typeof row.listCommentStatus === "function"
    && typeof row.loadCommentStore === "function"
    && typeof row.listCachedComments === "function"
    && typeof row.saveReplyDraft === "function"
    && typeof row.fillOpenReply === "function"
    && typeof row.reconcileWithGet === "function";
}

export async function defaultCommentsPort(): Promise<CommentsPort> {
  const here = dirname(fileURLToPath(import.meta.url));
  const file = [
    join(here, "../../strategies/skills/social-media-publish/scripts/comments.mjs"),
    join(process.cwd(), "strategies/skills/social-media-publish/scripts/comments.mjs"),
  ].find((item) => existsSync(item));
  if (!file) throw new Error("找不到评论脚本");
  const loaded: unknown = await import(pathToFileURL(file).href);
  if (!isCommentsPort(loaded)) throw new Error("评论脚本不可用");
  return loaded;
}
