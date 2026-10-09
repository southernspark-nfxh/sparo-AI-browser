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
