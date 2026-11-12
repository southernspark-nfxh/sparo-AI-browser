import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createEnv } from "../src/main/envs/store.js";
import {
  buildPrecheckResult,
  initialEnvChoice,
  resolveStudioEnv,
  snapshotHash,
  unsupported,
} from "../src/main/studio-env.js";
import { subscribeTaskEvents, taskEventForEnv } from "../src/renderer/studio/api.js";
import { createPageSession } from "../src/renderer/studio/dom.js";
import { PAGE_MODULES, type TaskChangedEvent } from "../src/renderer/studio/types.js";

describe("工作台壳", () => {
  it("登记六个页面位置，生产入口不带夹具", () => {
    expect(PAGE_MODULES).toEqual({
      home: "src/renderer/studio/pages/home.ts",
      metrics: "src/renderer/studio/pages/metrics.ts",
      compose: "src/renderer/studio/pages/compose.ts",
      accounts: "src/renderer/studio/pages/accounts.ts",
      comments: "src/renderer/studio/pages/comments.ts",
      tasks: "src/renderer/studio/pages/tasks.ts",
    });
  });

  it("缺环境或不存在时停止，不回退到别的环境", () => {
    const dir = mkdtempSync(join(tmpdir(), "studio-env-"));
    try {
      const created = createEnv(dir, { account: { type: "other", name: "头条号" } });
      const missing = resolveStudioEnv(dir, "");
      const unknown = resolveStudioEnv(dir, "default");
      const found = resolveStudioEnv(dir, created.id);
      expect(missing).toMatchObject({ ok: false, code: "missing_env", envId: "" });
      expect(missing.message).toContain("不会改用默认登录");
      expect(unknown).toMatchObject({ ok: false, code: "unknown_env", envId: "default" });
      expect(unknown.envId).not.toBe(created.id);
      expect(found).toMatchObject({ ok: true, envId: created.id, name: "头条号" });
      expect(initialEnvChoice([], "default")).toBe("");
      expect(initialEnvChoice([{ envId: created.id }, { envId: "other" }], "")).toBe("");
      expect(initialEnvChoice([{ envId: created.id }], "")).toBe(created.id);
      expect(initialEnvChoice([{ envId: created.id }], "default")).toBe("");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("预检带修订、平台集合和环境，未接线能力不返回成功", () => {
    const draft = {
      title: "标题",
      body: "正文",
      platforms: { toutiao: { enabled: true }, baijiahao: { enabled: false } },
    };
    const result = buildPrecheckResult({
      precheckId: "pre-1",
      envId: "env-1",
      draftRevision: 3,
      draft,
      rows: [],
    });
    expect(result).toMatchObject({
      ok: true,
      precheckId: "pre-1",
      envId: "env-1",
      draftRevision: 3,
      platforms: ["toutiao"],
    });
    expect(result.snapshotHash).toBe(snapshotHash("env-1", draft));
    expect(result.snapshotHash).not.toBe(snapshotHash("env-2", draft));
    const blocked = unsupported("env-1", "续跑尚未接入，不会创建发布批次");
    expect(blocked.ok).toBe(false);
    expect(blocked.code).toBe("unsupported");
    expect(blocked.envId).toBe("env-1");
  });

  it("任务订阅只收到同一环境的事件，取消后不再收到", () => {
    const seen: string[] = [];
    let deliver: ((event: TaskChangedEvent) => void) | null = null;
    const stop = subscribeTaskEvents("env-a", (event) => seen.push(event.eventId), {
      listen(fn) {
        deliver = fn;
        return () => {
          deliver = null;
        };
      },
    });
    const event = (id: string, env: string): TaskChangedEvent => ({
      eventId: id,
      eventType: "task",
      occurredAt: "2026-11-12T00:00:00.000Z",
      envId: env,
    });
    deliver?.(event("other", "env-b"));
    deliver?.(event("mine", "env-a"));
    expect(taskEventForEnv(event("mine", "env-a"), "")).toBe(false);
    stop();
    deliver?.(event("late", "env-a"));
    expect(seen).toEqual(["mine"]);
  });

  it("页面 destroy 取消监听和定时器", async () => {
    const page = createPageSession();
    let ticks = 0;
    let heard = 0;
    const listeners = new Set<() => void>();
    const hear = () => {
      heard += 1;
    };
    listeners.add(hear);
    page.track(() => listeners.delete(hear));
    page.later(() => {
      ticks += 1;
    }, 30);
    page.destroy();
    for (const fn of listeners) fn();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(ticks).toBe(0);
    expect(heard).toBe(0);
    expect(page.destroyed).toBe(true);
  });
});
