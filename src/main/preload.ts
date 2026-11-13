/**
 * Preload for page WebContentsView.
 * 只给官网账号页露出云会话，其它站点拿不到 token。
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import { TASK_EVENT_CHANNEL, type TaskChangedEvent } from "../renderer/studio/types.js";

contextBridge.exposeInMainWorld("sparkStudio", {
  load: (payload: { envId: string }) => ipcRenderer.invoke("studio:load", payload),
  create: (payload: { envId: string }) => ipcRenderer.invoke("studio:create", payload),
  save: (payload: { envId: string; draft: unknown; revision: number }) => ipcRenderer.invoke("studio:save", payload),
  precheck: (payload: { envId: string; draft: unknown; revision: number }) => ipcRenderer.invoke("studio:precheck", payload),
  confirm: (payload: { envId: string; precheckId: string; confirmationId: string }) => ipcRenderer.invoke("studio:confirm", payload),
  refresh: (payload: { envId: string }) => ipcRenderer.invoke("studio:refresh", payload),
  reply: (payload: { envId: string; platform?: string; text?: string; commentId?: string; content?: string }) => ipcRenderer.invoke("studio:reply", payload),
  pickImages: (payload: { envId: string; draftId: string; kind: "body" | "cover" }) => ipcRenderer.invoke("studio:pick-images", payload),
  checkAccounts: (payload: { envId: string; platforms: string[] }) => ipcRenderer.invoke("studio:check-accounts", payload),
  openAccount: (payload: { envId: string; platform: string }) => ipcRenderer.invoke("studio:open-account", payload),
  openAccountSettings: () => ipcRenderer.invoke("studio:open-account-settings"),
  queryTasks: (payload: { envId: string }) => ipcRenderer.invoke("studio:query-tasks", payload),
  openTask: (payload: { envId: string; jobId: string }) => ipcRenderer.invoke("studio:open-task", payload),
  verifyTask: (payload: { envId: string; jobId: string }) => ipcRenderer.invoke("studio:verify-task", payload),
  resumeTask: (payload: { envId: string; jobId: string; fromStep: string }) => ipcRenderer.invoke("studio:resume-task", payload),
  onTasksChanged: (envId: string, listener: (event: TaskChangedEvent) => void) => {
    const wrapped = (_event: IpcRendererEvent, payload: TaskChangedEvent) => {
      if (payload?.envId === envId) listener(payload);
    };
    ipcRenderer.on(TASK_EVENT_CHANNEL, wrapped);
    return () => ipcRenderer.removeListener(TASK_EVENT_CHANNEL, wrapped);
  },
});

contextBridge.exposeInMainWorld("sparkPage", {
  version: "0.1.0",
  cloudSession: () => ipcRenderer.invoke("spark:cloud-page-session"),
  cloudCheckout: (plan: string, type?: string) =>
    ipcRenderer.invoke("spark:cloud-checkout", plan, type),
});

contextBridge.exposeInMainWorld("SparoAPI", {
  openReaderMode: () => ipcRenderer.invoke("reader:open"),
  saveHighlights: (url: string, highlights: unknown[]) =>
    ipcRenderer.invoke("highlight:save", { url, highlights }),
  loadHighlights: (url: string) => ipcRenderer.invoke("highlight:load", { url }),
  summarizeSelection: (payload: unknown) => ipcRenderer.invoke("reader:summarizeSelection", payload),
  summarizePage: (payload: unknown) => ipcRenderer.invoke("reader:summarizePage", payload),
  saveHighlightNote: (payload: unknown) => ipcRenderer.invoke("notes:saveHighlight", payload),
  saveFullPage: (payload: unknown) => ipcRenderer.invoke("notes:saveFullPage", payload),
  askSparo: (payload: unknown) => ipcRenderer.invoke("reader:askSparo", payload),
  setCompanion: (on: boolean) => ipcRenderer.invoke("reader:setCompanion", { on }),
  getReaderPrefs: () => ipcRenderer.invoke("reader:prefs"),
  setReaderPrefs: (patch: unknown) => ipcRenderer.invoke("reader:setPrefs", patch),
  toast: (text: string) => ipcRenderer.invoke("reader:toast", { text, undo: false }),
  closeReader: () => ipcRenderer.invoke("reader:close"),
});
