import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  canReusePage,
  canTransition,
  isClosed,
  isLeaseActive,
  isTerminalExecution,
  occupiedSnapshot,
  projectStatus,
  retainsLease,
  type PageProjectionState,
  type StatusSurface,
} from "../src/main/agent/task-state.js";

vi.mock("electron", () => ({
  BrowserWindow: class BrowserWindow {},
  WebContentsView: class WebContentsView {},
  Menu: { buildFromTemplate: () => ({ popup: () => undefined }) },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
  app: {
    getPath: () => process.cwd(),
    getAppPath: () => process.cwd(),
    isReady: () => true,
    isPackaged: false,
    on: () => undefined,
    whenReady: () => Promise.resolve(),
  },
  ipcMain: { handle: () => undefined, on: () => undefined, removeHandler: () => undefined },
  session: { defaultSession: {}, fromPartition: () => ({}) },
  clipboard: { writeText: () => undefined, readText: () => "" },
  shell: { openExternal: async () => undefined, openPath: async () => "" },
  screen: {
    getPrimaryDisplay: () => ({
      workArea: { x: 0, y: 0, width: 1280, height: 800 },
      workAreaSize: { width: 1280, height: 800 },
    }),
    getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1280, height: 800 } }),
  },
}));

const STATES: PageProjectionState[] = [
  "queued",
  "running",
  "waiting_human",
  "failed",
  "done",
  "stopped",
  "closed",
  "idle",
];

const SURFACES: StatusSurface[] = ["tab", "sidebar", "command"];

describe("任务状态投影", () => {
  it("七类任务状态和 idle 的颜色、文案、占页判断唯一", () => {
    expect(projectStatus("queued")).toMatchObject({ tone: "green", label: "排队中", step: "排队中", retainsLease: true });
    expect(projectStatus("running")).toMatchObject({ tone: "green", label: "进行中", retainsLease: true });
    expect(projectStatus("waiting_human")).toMatchObject({ tone: "yellow", label: "等待人工", retainsLease: true });
    expect(projectStatus("failed")).toMatchObject({ tone: "red", label: "卡住／异常", retainsLease: true });
    expect(projectStatus("done")).toMatchObject({ tone: "gray", label: "已完成·待验收", retainsLease: true });
    expect(projectStatus("stopped")).toMatchObject({ tone: "gray", label: "已停止·待结束", retainsLease: true });
    expect(projectStatus("closed")).toMatchObject({ tone: "gray", label: "已结束", retainsLease: false });
    expect(projectStatus("idle")).toMatchObject({ tone: "gray", label: "静止／无 Agent", retainsLease: false });
    for (const state of STATES) expect(retainsLease(state)).toBe(projectStatus(state).retainsLease);
  });

  it("排队是绿色，但步骤只写排队，不假装已经在操作网页", () => {
    const queued = projectStatus("queued");
    expect(queued.tone).toBe("green");
    expect(queued.step).toBe("排队中");
    expect(queued.step).not.toMatch(/读取|编辑|上传|点击/);
  });

  it("Tab、侧栏、指挥室共用同一映射，没有身份色入口", () => {
    for (const state of STATES) {
      const projected = SURFACES.map((surface) => projectStatus(state, surface));
      expect(projected[1]).toEqual(projected[0]);
      expect(projected[2]).toEqual(projected[0]);
      expect(projected[0]).not.toHaveProperty("agentColor");
      expect(projected[0]).not.toHaveProperty("color");
    }
  });
});

describe("保留、终态和可复用", () => {
  it("done、stopped、failed 都占着页，不能复用", () => {
    for (const state of ["done", "stopped", "failed"] as const) {
      expect(retainsLease(state)).toBe(true);
      expect(isTerminalExecution(state)).toBe(true);
      expect(isClosed(state)).toBe(false);
      expect(canReusePage(occupiedSnapshot(state))).toBe(false);
    }
  });

  it("只有无 Agent、无未关闭任务、无有效 lease、已释放且 idle 的页可复用", () => {
    expect(
      canReusePage({
        hasAgent: false,
        hasOpenTask: false,
        leaseActive: false,
        released: true,
        idle: true,
      }),
    ).toBe(true);
    const idle = {
      hasAgent: false,
      hasOpenTask: false,
      leaseActive: false,
      released: true,
      idle: true,
    };
    expect(canReusePage({ ...idle, hasAgent: true })).toBe(false);
    expect(canReusePage({ ...idle, hasOpenTask: true })).toBe(false);
    expect(canReusePage({ ...idle, leaseActive: true })).toBe(false);
    expect(canReusePage({ ...idle, released: false })).toBe(false);
    expect(canReusePage({ ...idle, idle: false })).toBe(false);
  });

  it("灰色的 closed 也不等于可复用，idle 本身也不等于已经释放", () => {
    expect(canReusePage(occupiedSnapshot("closed"))).toBe(false);
    expect(canReusePage({ ...occupiedSnapshot("closed"), idle: true, hasOpenTask: false })).toBe(true);
    expect(
      canReusePage({
        hasAgent: false,
        hasOpenTask: false,
        leaseActive: false,
        released: false,
        idle: true,
      }),
    ).toBe(false);
  });

  it("done 不是 closed；closed 不再占页", () => {
    expect(isTerminalExecution("done")).toBe(true);
    expect(isClosed("done")).toBe(false);
    expect(isTerminalExecution("closed")).toBe(false);
    expect(isClosed("closed")).toBe(true);
    expect(isTerminalExecution("running")).toBe(false);
    expect(isTerminalExecution("waiting_human")).toBe(false);
    expect(retainsLease("closed")).toBe(false);
  });

  it("releasedAt 为空才算有效绑定", () => {
    expect(isLeaseActive(undefined)).toBe(false);
    expect(isLeaseActive(null)).toBe(false);
    expect(isLeaseActive({ releasedAt: undefined })).toBe(true);
    expect(isLeaseActive({ releasedAt: 1 })).toBe(false);
  });
});

describe("状态迁移", () => {
  it("done 不能回到 running，也不能借恢复路径续跑新需求", () => {
    expect(canTransition("done", "running")).toBe(false);
    expect(canTransition("done", "running", "resume")).toBe(false);
    expect(canTransition("done", "running", "advance")).toBe(false);
    expect(canTransition("done", "closed", "close")).toBe(true);
  });

  it("stopped 和 failed 只能按原任务恢复回到 running", () => {
    expect(canTransition("stopped", "running", "resume")).toBe(true);
    expect(canTransition("failed", "running", "resume")).toBe(true);
    expect(canTransition("waiting_human", "running", "resume")).toBe(true);
    expect(canTransition("stopped", "running")).toBe(false);
    expect(canTransition("failed", "running")).toBe(false);
    expect(canTransition("stopped", "closed", "close")).toBe(true);
    expect(canTransition("failed", "closed", "close")).toBe(true);
    expect(canTransition("failed", "stopped", "stop")).toBe(true);
    expect(canTransition("failed", "stopped")).toBe(false);
    expect(canTransition("done", "stopped", "stop")).toBe(false);
    expect(canTransition("running", "stopped", "stop")).toBe(true);
  });

  it("closed 是终点；运行中的页不能直接归档", () => {
    for (const to of ["queued", "running", "waiting_human", "failed", "done", "stopped", "closed"] as const) {
      expect(canTransition("closed", to)).toBe(false);
      expect(canTransition("closed", to, "resume")).toBe(false);
      expect(canTransition("closed", to, "close")).toBe(false);
    }
    expect(canTransition("running", "closed", "close")).toBe(false);
    expect(canTransition("queued", "closed", "close")).toBe(false);
    expect(canTransition("waiting_human", "closed", "close")).toBe(false);
  });

  it("正常推进和重新排队仍走原有路径", () => {
    expect(canTransition("queued", "running")).toBe(true);
    expect(canTransition("running", "waiting_human")).toBe(true);
    expect(canTransition("running", "done")).toBe(true);
    expect(canTransition("running", "failed")).toBe(true);
    expect(canTransition("running", "stopped")).toBe(true);
    expect(canTransition("running", "queued", "requeue")).toBe(true);
    expect(canTransition("waiting_human", "queued", "requeue")).toBe(true);
    expect(canTransition("done", "queued", "requeue")).toBe(false);
  });
});

describe("浏览器只读适配", () => {
  let readOnlyPageStatus: typeof import("../src/main/browser.js").readOnlyPageStatus;

  beforeAll(async () => {
    ({ readOnlyPageStatus } = await import("../src/main/browser.js"));
  });

  it("侧栏投影直接调用同一份状态函数，不把旧身份色翻译回来", async () => {
    for (const state of STATES) {
      const viaBrowser = readOnlyPageStatus(state, "tab");
      const viaState = projectStatus(state, "sidebar");
      expect(viaBrowser.tone).toBe(viaState.tone);
      expect(viaBrowser.label).toBe(viaState.label);
      expect(viaBrowser.step).toBe(viaState.step);
      expect(viaBrowser.retainsLease).toBe(viaState.retainsLease);
      expect(readOnlyPageStatus(state, "command").tone).toBe(viaState.tone);
    }
    const held = {
      tabId: "tab-1",
      taskId: "task-1",
      clientId: "agent-a",
      boundAt: 10,
    };
    expect(readOnlyPageStatus("done", "sidebar", held).binding).toEqual(held);
    expect(readOnlyPageStatus("done", "sidebar", { ...held, releasedAt: 20, releaseReason: "accepted" }).binding).toBe(
      null,
    );
  });
});
