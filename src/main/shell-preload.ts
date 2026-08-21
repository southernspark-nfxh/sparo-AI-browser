/**
 * Preload for chrome toolbar and sidebar shell UIs.
 */
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("sparkShell", {
  // chrome → main
  navigate: (url: string) => ipcRenderer.invoke("spark:navigate", url),
  goBack: () => ipcRenderer.invoke("spark:go-back"),
  goForward: () => ipcRenderer.invoke("spark:go-forward"),
  reload: () => ipcRenderer.invoke("spark:reload"),
  newTab: (url?: string) => ipcRenderer.invoke("spark:new-tab", url),
  closeTab: (id: string) => ipcRenderer.invoke("spark:close-tab", id),
  switchTab: (id: string) => ipcRenderer.invoke("spark:switch-tab", id),
  listTabs: () => ipcRenderer.invoke("spark:list-tabs"),

  // sidebar → main
  setPaused: (paused: boolean) => ipcRenderer.invoke("spark:set-paused", paused),
  getStatus: () => ipcRenderer.invoke("spark:get-status"),
  resolveApproval: (id: string, approved: boolean) =>
    ipcRenderer.invoke("spark:resolve-approval", id, approved),
  runQa: () => ipcRenderer.invoke("spark:qa-check"),
  chat: (text: string) => ipcRenderer.invoke("spark:chat", text),
  csScan: () => ipcRenderer.invoke("spark:cs-scan"),
  csDraft: (opts?: { draft?: string; fill?: boolean }) =>
    ipcRenderer.invoke("spark:cs-draft", opts),
  getSettings: () => ipcRenderer.invoke("spark:get-settings"),
  saveSettings: (patch: {
    provider?: string;
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    applyPreset?: boolean;
    deepseekApiKey?: string;
    deepseekBaseUrl?: string;
    deepseekModel?: string;
  }) => ipcRenderer.invoke("spark:save-settings", patch),
  startRecording: (task?: string) =>
    ipcRenderer.invoke("spark:start-recording", task),
  stopRecording: (title?: string) =>
    ipcRenderer.invoke("spark:stop-recording", title),
  listSkills: () => ipcRenderer.invoke("spark:list-skills"),
  deleteSkill: (id: string) => ipcRenderer.invoke("spark:delete-skill", id),
  bookmarkSources: () => ipcRenderer.invoke("spark:bookmark-sources"),
  importBookmarks: (source: "chrome" | "edge") =>
    ipcRenderer.invoke("spark:import-bookmarks", source),
  listBookmarks: () => ipcRenderer.invoke("spark:list-bookmarks"),
  openBookmark: (url: string) => ipcRenderer.invoke("spark:open-bookmark", url),
  clearBookmarks: () => ipcRenderer.invoke("spark:clear-bookmarks"),
  toggleBookmark: () => ipcRenderer.invoke("spark:toggle-bookmark"),
  openBookmarksMenu: (payload?: { overflowUrls?: string[] }) =>
    ipcRenderer.invoke("spark:bookmarks-menu", payload),

  // main → renderer push
  onChromeState: (cb: (state: unknown) => void) => {
    const handler = (_: Electron.IpcRendererEvent, state: unknown) => cb(state);
    ipcRenderer.on("spark:chrome-state", handler);
    return () => ipcRenderer.removeListener("spark:chrome-state", handler);
  },
  onSidebarState: (cb: (state: unknown) => void) => {
    const handler = (_: Electron.IpcRendererEvent, state: unknown) => cb(state);
    ipcRenderer.on("spark:sidebar-state", handler);
    return () => ipcRenderer.removeListener("spark:sidebar-state", handler);
  },
});
