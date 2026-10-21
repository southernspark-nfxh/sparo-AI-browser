/**
 * Preload for page WebContentsView.
 * 只给官网账号页露出云会话，其它站点拿不到 token。
 */
import { contextBridge, ipcRenderer } from "electron";

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
  setCompanion: (on: boolean) => ipcRenderer.invoke("reader:setCompanion", { on }),
  getReaderPrefs: () => ipcRenderer.invoke("reader:prefs"),
  setReaderPrefs: (patch: unknown) => ipcRenderer.invoke("reader:setPrefs", patch),
  toast: (text: string) => ipcRenderer.invoke("reader:toast", { text, undo: false }),
  closeReader: () => ipcRenderer.invoke("reader:close"),
});
