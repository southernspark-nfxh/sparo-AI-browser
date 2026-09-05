/**
 * Preload for chrome toolbar and sidebar shell UIs.
 */
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("sparkShell", {
  // chrome → main
  pageHoleBounds: (bounds: { x: number; y: number; width: number; height: number }) =>
    ipcRenderer.send("spark:page-hole", bounds),
  navigate: (url: string) => ipcRenderer.invoke("spark:navigate", url),
  goBack: () => ipcRenderer.invoke("spark:go-back"),
  goForward: () => ipcRenderer.invoke("spark:go-forward"),
  reload: () => ipcRenderer.invoke("spark:reload"),
  newTab: (url?: string) => ipcRenderer.invoke("spark:new-tab", url),
  closeTab: (id: string) => ipcRenderer.invoke("spark:close-tab", id),
  switchTab: (id: string) => ipcRenderer.invoke("spark:switch-tab", id),
  toggleMaximize: () => ipcRenderer.invoke("spark:toggle-maximize"),
  listTabs: () => ipcRenderer.invoke("spark:list-tabs"),
  discardInactiveTabs: () => ipcRenderer.invoke("spark:discard-inactive-tabs"),
  clearChat: () => ipcRenderer.invoke("spark:clear-chat"),
  reorderTabs: (fromId: string, toId: string) =>
    ipcRenderer.invoke("spark:reorder-tabs", fromId, toId),
  stop: () => ipcRenderer.invoke("spark:stop"),
  print: () => ipcRenderer.invoke("spark:print"),
  find: (query: string, opts?: { forward?: boolean; findNext?: boolean }) =>
    ipcRenderer.invoke("spark:find", query, opts),
  stopFind: () => ipcRenderer.invoke("spark:stop-find"),
  openHistory: () => ipcRenderer.invoke("spark:open-history"),
  closeHistory: () => ipcRenderer.invoke("spark:close-history"),
  clearHistory: () => ipcRenderer.invoke("spark:clear-history"),
  showInFolder: (filePath: string) => ipcRenderer.invoke("spark:show-in-folder", filePath),

  // sidebar → main
  setPaused: (paused: boolean) => ipcRenderer.invoke("spark:set-paused", paused),
  getStatus: () => ipcRenderer.invoke("spark:get-status"),
  resolveApproval: (id: string, approved: boolean) =>
    ipcRenderer.invoke("spark:resolve-approval", id, approved),
  runQa: () => ipcRenderer.invoke("spark:qa-check"),
  chat: (text: string) => ipcRenderer.invoke("spark:chat", text),
  openReport: (filePath: string) => ipcRenderer.invoke("spark:open-report", filePath),
  csScan: (opts?: { fromHuman?: boolean }) => ipcRenderer.invoke("spark:cs-scan", opts),
  csDraft: (opts?: { draft?: string; fill?: boolean; preferLlm?: boolean; fromHuman?: boolean }) =>
    ipcRenderer.invoke("spark:cs-draft", opts),
  csOneClick: () => ipcRenderer.invoke("spark:cs-one-click"),
  getSettings: () => ipcRenderer.invoke("spark:get-settings"),
  copyAgentConnect: () => ipcRenderer.invoke("spark:copy-agent-connect"),
  connectAgent: (target: string) => ipcRenderer.invoke("spark:connect-agent", target),
  saveSettings: (patch: {
    provider?: string;
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    applyPreset?: boolean;
    llmMode?: "byok" | "cloud";
    deepseekApiKey?: string;
    deepseekBaseUrl?: string;
    deepseekModel?: string;
    locale?: string;
    memorySaver?: boolean;
    memorySaverIdleMinutes?: number;
  }) => ipcRenderer.invoke("spark:save-settings", patch),
  cloudSendCode: (email: string) => ipcRenderer.invoke("spark:cloud-send-code", email),
  cloudVerify: (email: string, code: string) =>
    ipcRenderer.invoke("spark:cloud-verify", email, code),
  cloudLogout: () => ipcRenderer.invoke("spark:cloud-logout"),
  cloudOpenAccount: () => ipcRenderer.invoke("spark:cloud-open-account"),
  cloudRefresh: () => ipcRenderer.invoke("spark:cloud-refresh"),
  getProfile: () => ipcRenderer.invoke("spark:get-profile"),
  saveIdentity: (patch: {
    nickname?: string;
    gender?: string;
    accounts?: { site: string; username: string }[];
    topics?: string[];
    writingStyle?: string;
    forbidden?: string;
    workNotes?: string;
  }) => ipcRenderer.invoke("spark:save-identity", patch),
  clearProfile: () => ipcRenderer.invoke("spark:clear-profile"),
  listEnvs: () => ipcRenderer.invoke("spark:list-envs"),
  createEnv: (init?: { account?: { type?: string; name?: string; note?: string; homeUrl?: string } }) =>
    ipcRenderer.invoke("spark:create-env", init),
  saveEnv: (patch: { id: string; account?: unknown; fingerprint?: unknown; proxy?: unknown; enabled?: boolean }) =>
    ipcRenderer.invoke("spark:save-env", patch),
  cloneEnv: (envId: string) => ipcRenderer.invoke("spark:clone-env", envId),
  deleteEnv: (envId: string) => ipcRenderer.invoke("spark:delete-env", envId),
  openEnv: (envId: string) => ipcRenderer.invoke("spark:open-env", envId),
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
  onToast: (cb: (payload: { text?: string; path?: string }) => void) => {
    const handler = (_: Electron.IpcRendererEvent, payload: { text?: string; path?: string }) =>
      cb(payload || {});
    ipcRenderer.on("spark:toast", handler);
    return () => ipcRenderer.removeListener("spark:toast", handler);
  },
  onOpenFind: (cb: () => void) => {
    const handler = () => cb();
    ipcRenderer.on("spark:open-find", handler);
    return () => ipcRenderer.removeListener("spark:open-find", handler);
  },
  onCloseFind: (cb: () => void) => {
    const handler = () => cb();
    ipcRenderer.on("spark:close-find", handler);
    return () => ipcRenderer.removeListener("spark:close-find", handler);
  },
  onFindResult: (cb: (result: { active?: number; total?: number }) => void) => {
    const handler = (_: Electron.IpcRendererEvent, result: { active?: number; total?: number }) =>
      cb(result || {});
    ipcRenderer.on("spark:find-result", handler);
    return () => ipcRenderer.removeListener("spark:find-result", handler);
  },
  onFindAgain: (cb: (opts: { forward?: boolean }) => void) => {
    const handler = (_: Electron.IpcRendererEvent, opts: { forward?: boolean }) => cb(opts || {});
    ipcRenderer.on("spark:find-again", handler);
    return () => ipcRenderer.removeListener("spark:find-again", handler);
  },
  onHistory: (cb: (payload: { items: unknown }) => void) => {
    const handler = (_: Electron.IpcRendererEvent, payload: { items: unknown }) => cb(payload || {});
    ipcRenderer.on("spark:history", handler);
    return () => ipcRenderer.removeListener("spark:history", handler);
  },
});
