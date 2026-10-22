/**
 * Preload for chrome toolbar and sidebar shell UIs.
 */
import { contextBridge, ipcRenderer, webUtils } from "electron";

contextBridge.exposeInMainWorld("sparkShell", {
  // chrome → main
  pageHoleBounds: (bounds: { x: number; y: number; width: number; height: number }) =>
    ipcRenderer.send("spark:page-hole", bounds),
  setSidebarWidth: (w: number) => ipcRenderer.send("spark:set-sidebar-width", w),
  focusShell: () => ipcRenderer.send("spark:focus-shell"),
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
  learningAnswer: (text: string) => ipcRenderer.invoke("spark:learning-answer", text),
  learningSkip: () => ipcRenderer.invoke("spark:learning-skip"),
  deleteLesson: (id: string) => ipcRenderer.invoke("spark:delete-lesson", id),
  getStatus: () => ipcRenderer.invoke("spark:get-status"),
  resolveApproval: (id: string, approved: boolean) =>
    ipcRenderer.invoke("spark:resolve-approval", id, approved),
  runQa: () => ipcRenderer.invoke("spark:qa-check"),
  chat: (
    text: string,
    images?: string[],
    quotes?: Array<{
      text: string;
      url?: string;
      title?: string;
      siteName?: string;
      kind?: "page" | "note";
      noteId?: string;
    }>,
  ) => ipcRenderer.invoke("spark:chat", text, images, quotes),
  /** 拖进侧栏的本地文件 → 真实磁盘路径（Electron webUtils） */
  filePath: (file: File) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return "";
    }
  },
  pickFile: () => ipcRenderer.invoke("spark:pick-file"),
  openReport: (filePath: string) => ipcRenderer.invoke("spark:open-report", filePath),
  openReaderMode: () => ipcRenderer.invoke("reader:open"),
  listNotes: (query?: { limit?: number; tag?: string; search?: string }) =>
    ipcRenderer.invoke("notes:list", query || {}),
  deleteNote: (id: string) => ipcRenderer.invoke("notes:delete", { id }),
  openNote: (id: string) => ipcRenderer.invoke("notes:open", { id }),
  openNotesPanel: (search?: string) => ipcRenderer.invoke("notes:panel", { search: search || "" }),
  readerUndo: () => ipcRenderer.invoke("reader:undo"),
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
    onboardingDismissed?: boolean;
    firstJobHintDismissed?: boolean;
    memorySaver?: boolean;
    memorySaverIdleMinutes?: number;
  }) => ipcRenderer.invoke("spark:save-settings", patch),
  cloudSendCode: (email: string) => ipcRenderer.invoke("spark:cloud-send-code", email),
  cloudVerify: (email: string, code: string) =>
    ipcRenderer.invoke("spark:cloud-verify", email, code),
  cloudLogout: () => ipcRenderer.invoke("spark:cloud-logout"),
  cloudOpenAccount: (plan?: string) => ipcRenderer.invoke("spark:cloud-open-account", plan),
  cloudCheckout: (plan: string) => ipcRenderer.invoke("spark:cloud-checkout", plan),
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
    homeCity?: string;
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
  openNavMenu: () => ipcRenderer.invoke("spark:nav-menu"),

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
  onToast: (cb: (payload: { text?: string; path?: string; duration?: number; undo?: boolean }) => void) => {
    const handler = (
      _: Electron.IpcRendererEvent,
      payload: { text?: string; path?: string; duration?: number; undo?: boolean },
    ) => cb(payload || {});
    ipcRenderer.on("spark:toast", handler);
    return () => ipcRenderer.removeListener("spark:toast", handler);
  },
  onQuoteFromPage: (cb: (payload: {
    text?: string;
    url?: string;
    title?: string;
    siteName?: string;
    favicon?: string;
    kind?: string;
  }) => void) => {
    const handler = (
      _: Electron.IpcRendererEvent,
      payload: {
        text?: string;
        url?: string;
        title?: string;
        siteName?: string;
        favicon?: string;
        kind?: string;
      },
    ) => cb(payload || {});
    ipcRenderer.on("spark:quote-from-page", handler);
    return () => ipcRenderer.removeListener("spark:quote-from-page", handler);
  },
  onNotes: (cb: (payload: { search?: string }) => void) => {
    const handler = (_: Electron.IpcRendererEvent, payload: { search?: string }) => cb(payload || {});
    ipcRenderer.on("spark:notes", handler);
    return () => ipcRenderer.removeListener("spark:notes", handler);
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
  // 主进程在窗口恢复后主动要求重新测量并上报 page-hole（恢复过渡的 ResizeObserver 回调可能丢失）
  onRequestHole: (cb: () => void) => {
    const handler = () => cb();
    ipcRenderer.on("spark:request-hole", handler);
    return () => ipcRenderer.removeListener("spark:request-hole", handler);
  },
});

contextBridge.exposeInMainWorld("SparoAPI", {
  openReaderMode: () => ipcRenderer.invoke("reader:open"),
  listNotes: (query?: { limit?: number; tag?: string; search?: string }) =>
    ipcRenderer.invoke("notes:list", query || {}),
  deleteNote: (id: string) => ipcRenderer.invoke("notes:delete", { id }),
  openNote: (id: string) => ipcRenderer.invoke("notes:open", { id }),
});
