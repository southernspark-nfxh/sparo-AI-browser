import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { snapshotHash } from "../src/main/studio-env.js";
import {
  applyImageEdit,
  contentStamp,
  createStudioDraft,
  emptyDraft,
  failureCount,
  inspectDraft,
  loadDraftDir,
  migrateDraftDir,
  overviewFrom,
  precheckCurrent,
  precheckDraft,
  readProfiles,
  resolveOwnership,
  saveDraftDir,
  saveStudioDraft,
  sealConfirmation,
  type StudioDraft,
  type StudioProfile,
} from "../src/main/studio-store.js";
import { mount, type ComposeDraft, type ComposeProfile, type ComposeViewModel } from "../src/renderer/studio/pages/compose.js";
import type { PageActions, PrecheckResult, StudioError } from "../src/renderer/studio/types.js";

const profiles = readProfiles(join(process.cwd(), "strategies/skills/social-media-publish/platforms"));

describe("媒体工作台预检", () => {
  it("大鱼图不够时标跳过，确认单不写时间", () => {
    const draft = emptyDraft("d1");
    draft.cover = "cover.jpg";
    draft.images = ["a.jpg", "b.jpg"];
    const rows = precheckDraft(draft, profiles);
    const dayu = rows.find((row) => row.platform === "dayu");
    expect(dayu?.level).toBe("warn");
    expect(dayu?.skip).toBe(true);
    expect(dayu?.marks.join(" ")).toContain("需要 3 张");
    expect(JSON.stringify(rows)).not.toMatch(/\d{1,2}:\d{2}/);
    expect(JSON.stringify(rows)).not.toContain("定时");
  });

  it("头条有封面时预检通过，并标出会勾的项", () => {
    const draft = emptyDraft("d2");
    draft.cover = "cover.jpg";
    draft.images = ["a.jpg", "b.jpg", "c.jpg"];
    const toutiao = precheckDraft(draft, profiles).find((row) => row.platform === "toutiao");
    expect(toutiao?.level).toBe("ok");
    expect(toutiao?.skip).toBe(false);
    expect(toutiao?.marks.join(" ")).toContain("预检通过");
    expect(toutiao?.marks.join(" ")).toContain("投放广告赚收益");
  });

  it("字数上限来自规则表，不写死在预检里", () => {
    const custom: StudioProfile = {
      ...profiles[0],
      limits: { ...profiles[0].limits, titleMax: 2 },
    };
    const draft = emptyDraft("d3");
    draft.title = "标题太长";
    draft.cover = "cover.jpg";
    draft.platforms = { toutiao: { enabled: true } };
    const row = precheckDraft(draft, [custom])[0];
    expect(row.level).toBe("warn");
    expect(row.marks.join(" ")).toContain("标题超过 2 字");
  });

  it("能读旧的 title.txt / body.md", () => {
    const root = mkdtempSync(join(tmpdir(), "studio-draft-"));
    const dir = join(root, "old");
    mkdirSync(dir);
    writeFileSync(join(dir, "title.txt"), "旧标题\n");
    writeFileSync(join(dir, "body.md"), "旧正文");
    const loaded = loadDraftDir(dir);
    expect(loaded?.title).toBe("旧标题");
    expect(loaded?.body).toBe("旧正文");
  });

  it("保存后正文在 body.md，草稿含首发平台", () => {
    const root = mkdtempSync(join(tmpdir(), "studio-save-"));
    const draft = emptyDraft("new1");
    draft.title = "新稿";
    draft.body = "正文";
    draft.primaryPlatform = "baijiahao";
    saveDraftDir(root, draft);
    const loaded = loadDraftDir(join(root, "new1"));
    expect(loaded?.body).toBe("正文");
    expect(loaded?.primaryPlatform).toBe("baijiahao");
  });

  it("封面和正文图片落盘为目录内副本，删除源文件后仍能重载恢复", () => {
    const root = mkdtempSync(join(tmpdir(), "studio-images-"));
    const sources = mkdtempSync(join(tmpdir(), "studio-image-sources-"));
    const coverSource = join(sources, "cover.png");
    const bodySource = join(sources, "body.png");
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
    writeFileSync(coverSource, png);
    writeFileSync(bodySource, png);
    const draft = emptyDraft("with-images");
    draft.cover = coverSource;
    draft.images = [bodySource];

    const dir = saveDraftDir(root, draft);
    const persisted = JSON.parse(readFileSync(join(dir, "draft.json"), "utf8")) as StudioDraft;
    const storedCover = join(dir, "cover.png");
    const storedBody = join(dir, "images", "1.png");
    expect(persisted.cover).toBe(storedCover);
    expect(persisted.images).toEqual([storedBody]);
    const loaded = loadDraftDir(dir);
    expect(loaded?.cover).toBe(storedCover);
    expect(loaded?.images).toEqual([storedBody]);

    unlinkSync(coverSource);
    unlinkSync(bodySource);
    const restored = loadDraftDir(dir);
    expect(restored?.cover).toBe(storedCover);
    expect(restored?.images).toEqual([storedBody]);
    expect(existsSync(storedCover)).toBe(true);
    expect(existsSync(storedBody)).toBe(true);
    expect(readFileSync(storedCover)).toEqual(png);
    expect(readFileSync(storedBody)).toEqual(png);
  });

  it("总览只有待发、失败和登录三项", () => {
    const view = overviewFrom(2, failureCount([{ ok: false }, { ok: true }]));
    expect(view).toEqual({ pending: 2, failed: 1, login: "未检查" });
    expect(Object.keys(view)).toEqual(["pending", "failed", "login"]);
  });
});

const SHOP_B = "shop-b";

function linkedDraft(id: string, envId = SHOP_B): StudioDraft {
  const draft = emptyDraft(id);
  draft.envId = envId;
  draft.association = "linked";
  draft.revision = 0;
  draft.cover = "cover.jpg";
  draft.images = ["a.jpg", "b.jpg", "c.jpg"];
  draft.platforms = {
    toutiao: { enabled: true, confirmed: ["ad"] },
    baijiahao: { enabled: false },
    dayu: { enabled: false },
    sohu: { enabled: false },
  };
  return draft;
}

describe("发稿服务", () => {
  it("未登录也能在非默认环境新建、改稿、插图并保存", () => {
    const root = mkdtempSync(join(tmpdir(), "studio-create-"));
    const created = createStudioDraft(root, "d1", SHOP_B, [SHOP_B]);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.draft.envId).toBe(SHOP_B);
    expect(created.draft.association).toBe("linked");
    expect(created.envId).not.toBe("default");
    const edited = applyImageEdit({ ...created.draft, title: "还没登录也能写" }, { op: "add", files: ["D:/pics/one.png", "D:/pics/two.png"] });
    edited.title = "还没登录也能写，标题不会被截断";
    const moved = applyImageEdit(edited, { op: "move", index: 0, direction: 1 });
    const removed = applyImageEdit(moved, { op: "remove", index: 0 });
    const covered = applyImageEdit(removed, { op: "set-cover", file: "D:/pics/cover.png" });
    expect(covered.title).toBe("还没登录也能写，标题不会被截断");
    expect(covered.images).toEqual(["D:/pics/one.png"]);
    expect(covered.cover).toBe("D:/pics/cover.png");
    const saved = saveStudioDraft(root, { envId: SHOP_B, draft: covered, revision: 0, knownEnvIds: [SHOP_B] });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    const loaded = loadDraftDir(join(root, "d1"));
    expect(loaded?.title).toBe("还没登录也能写，标题不会被截断");
    expect(loaded?.images).toEqual(["D:/pics/one.png"]);
    expect(loaded?.cover).toBe("D:/pics/cover.png");
    expect(loaded?.envId).toBe(SHOP_B);
    expect(loaded?.body).toBe(covered.body);
  });

  it("只预检选中的平台，标题越界和缺封面按规则表，且不改原稿", () => {
    const draft = linkedDraft("d2");
    draft.title = "标题太长";
    draft.cover = "";
    draft.platforms.toutiao = { enabled: true };
    const custom: StudioProfile = { ...profiles[0], limits: { ...profiles[0].limits, titleMax: 2 } };
    const before = draft.title;
    const rows = precheckDraft(draft, [custom], { strict: true, accounts: [{ platform: "toutiao", state: "ok", checkedAt: "2026-11-13T02:00:00.000Z" }] });
    expect(rows.map((row) => row.platform)).toEqual(["toutiao"]);
    expect(rows[0].level).toBe("warn");
    expect(rows[0].skip).toBe(true);
    expect(rows[0].marks.join(" ")).toContain("标题超过 2 字");
    expect(rows[0].marks.join(" ")).toContain("缺封面");
    expect(draft.title).toBe(before);
    expect(draft.platforms.toutiao.confirmed).toBeUndefined();
    expect(rows[0].marks.join(" ")).not.toContain("定时");
    expect(rows[0].marks.join(" ")).not.toContain("错峰");
  });

  it("未登录只挡住对应平台，未知登录不能写成正常", () => {
    const draft = linkedDraft("d3");
    draft.platforms.baijiahao = { enabled: true };
    const rows = precheckDraft(draft, profiles, {
      strict: true,
      accounts: [
        { platform: "toutiao", state: "login_missing", checkedAt: "2026-11-13T02:00:00.000Z" },
        { platform: "baijiahao", state: "unknown" },
      ],
    });
    const toutiao = rows.find((row) => row.platform === "toutiao");
    const baijia = rows.find((row) => row.platform === "baijiahao");
    expect(toutiao?.level).toBe("warn");
    expect(toutiao?.marks.join(" ")).toContain("未登录");
    expect(baijia?.marks.join(" ")).toContain("未核验");
    expect(baijia?.marks.join(" ")).not.toContain("登录正常");
    expect(baijia?.level).not.toBe("ok");
    expect(draft.title).toBe("");
    expect(rows.some((row) => row.platform === "dayu")).toBe(false);
  });

  it("修改稿件、平台选择、平台选项或环境后，旧预检失效", () => {
    const draft = linkedDraft("d4");
    draft.revision = 2;
    const first = inspectDraft({
      precheckId: "pre-1",
      envId: SHOP_B,
      draft,
      revision: 2,
      profiles,
      accounts: [{ platform: "toutiao", state: "ok", checkedAt: "2026-11-13T02:00:00.000Z" }],
      knownEnvIds: [SHOP_B],
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first).toMatchObject({ precheckId: "pre-1", envId: SHOP_B, draftRevision: 2, platforms: ["toutiao"] });
    expect(first.snapshotHash).toBe(snapshotHash(SHOP_B, draft));
    const renamed = { ...draft, title: "改过的标题" };
    expect(precheckCurrent(first, SHOP_B, renamed)).toBe(false);
    const reselected = { ...draft, platforms: { ...draft.platforms, baijiahao: { enabled: true } } };
    expect(precheckCurrent(first, SHOP_B, reselected)).toBe(false);
    const retitled = {
      ...draft,
      platforms: { ...draft.platforms, toutiao: { ...draft.platforms.toutiao, title: "另一套标题" } },
    };
    expect(snapshotHash(SHOP_B, retitled)).toBe(first.snapshotHash);
    expect(contentStamp(SHOP_B, retitled)).not.toBe(first.contentStamp);
    expect(precheckCurrent(first, SHOP_B, retitled)).toBe(false);
    const bumped = { ...draft, revision: 3 };
    expect(precheckCurrent(first, SHOP_B, bumped)).toBe(false);
    expect(precheckCurrent(first, "shop-c", { ...draft, envId: "shop-c" })).toBe(false);
  });

  it("保存失败不覆盖已写内容，调用方手里的标题还在", () => {
    const root = mkdtempSync(join(tmpdir(), "studio-conflict-"));
    const created = createStudioDraft(root, "d5", SHOP_B, [SHOP_B]);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const first = saveStudioDraft(root, {
      envId: SHOP_B,
      draft: { ...created.draft, title: "第一版" },
      revision: 0,
      knownEnvIds: [SHOP_B],
    });
    expect(first.ok).toBe(true);
    const editing = { ...created.draft, title: "正在写的标题" };
    const failed = saveStudioDraft(root, { envId: SHOP_B, draft: editing, revision: 0, knownEnvIds: [SHOP_B] });
    expect(failed.ok).toBe(false);
    if (failed.ok) return;
    expect(failed.code).toBe("stale_revision");
    expect(editing.title).toBe("正在写的标题");
    expect(loadDraftDir(join(root, "d5"))?.title).toBe("第一版");
  });

  it("缺环境或环境对不上时停止，不改用另一个环境", () => {
    const root = mkdtempSync(join(tmpdir(), "studio-missing-env-"));
    const missing = createStudioDraft(root, "d6", "  ", [SHOP_B]);
    expect(missing).toMatchObject({ ok: false, code: "missing_env", envId: "" });
    expect(missing.ok ? "" : missing.message).toContain("不会改用默认登录");
    expect(existsSync(join(root, "d6"))).toBe(false);
    const unknown = inspectDraft({
      precheckId: "pre-x",
      envId: "default",
      draft: linkedDraft("d6", SHOP_B),
      revision: 0,
      profiles,
      knownEnvIds: [SHOP_B],
    });
    expect(unknown).toMatchObject({ ok: false, code: "unknown_env", envId: "default" });
    expect(unknown.ok ? "" : unknown.envId).not.toBe(SHOP_B);
  });

  it("旧草稿无法确定归属时标为未关联，明确证明才迁移且不丢字段", () => {
    const unclear = resolveOwnership({ id: "old", title: "旧标题", body: "旧正文", custom: "keep-me", images: ["a.jpg"] }, [SHOP_B, "default"]);
    expect(unclear.ownership).toEqual({ association: "unlinked", envId: "", label: "未关联" });
    expect(unclear.draft.envId).toBeUndefined();
    expect(unclear.draft.custom).toBe("keep-me");
    expect(JSON.stringify(unclear.draft)).not.toContain(SHOP_B);
    const proved = resolveOwnership({ id: "old", title: "旧标题", custom: "keep-me", legacyOwner: "default" }, ["default", SHOP_B]);
    expect(proved.ownership).toEqual({ association: "linked", envId: "default", label: "" });
    expect(proved.draft.custom).toBe("keep-me");
    expect(proved.draft.legacyOwner).toBe("default");
    const notDefault = resolveOwnership({ id: "old", title: "旧标题", custom: "keep-me", legacyOwner: "default" }, [SHOP_B]);
    expect(notDefault.ownership.association).toBe("unlinked");
    expect(notDefault.draft.envId).toBeUndefined();
    expect(JSON.stringify(notDefault.draft)).not.toContain(SHOP_B);
    const explicit = resolveOwnership({ id: "old", title: "旧标题", envId: SHOP_B, cover: "c.jpg" }, ["default"]);
    expect(explicit.ownership.envId).toBe(SHOP_B);
    const root = mkdtempSync(join(tmpdir(), "studio-migrate-"));
    const dir = join(root, "legacy");
    mkdirSync(dir);
    writeFileSync(join(dir, "draft.json"), JSON.stringify({ id: "legacy", title: "旧标题", custom: "keep-me", images: ["a.jpg"] }));
    writeFileSync(join(dir, "body.md"), "旧正文");
    const ownership = migrateDraftDir(dir, [SHOP_B]);
    expect(ownership.label).toBe("未关联");
    const loaded = loadDraftDir(dir) as StudioDraft & { custom?: string };
    expect(loaded.title).toBe("旧标题");
    expect(loaded.body).toBe("旧正文");
    expect(loaded.custom).toBe("keep-me");
    expect(loaded.images).toEqual(["a.jpg"]);
    expect(loaded.envId).toBeUndefined();
    expect(loaded.association).toBe("unlinked");
  });

  it("确认单不发布、不创建生产任务，必填没过就不能确认", () => {
    const root = mkdtempSync(join(tmpdir(), "studio-seal-"));
    const draft = linkedDraft("d7");
    draft.revision = 1;
    const ready = inspectDraft({
      precheckId: "pre-ok",
      envId: SHOP_B,
      draft,
      revision: 1,
      profiles,
      accounts: [{ platform: "toutiao", state: "ok", checkedAt: "2026-11-13T02:00:00.000Z" }],
    });
    expect(ready.ok).toBe(true);
    if (!ready.ok) return;
    const blocked = sealConfirmation(root, { envId: SHOP_B, precheck: ready, draft: { ...draft, title: "已经改了" }, confirmationId: "c1" });
    expect(blocked.ok).toBe(false);
    expect(existsSync(join(root, "confirmed.json"))).toBe(false);
    const sealed = sealConfirmation(root, { envId: SHOP_B, precheck: ready, draft, confirmationId: "c1" });
    expect(sealed.ok).toBe(true);
    if (!sealed.ok) return;
    expect(sealed.wroteToPlatform).toBe(false);
    expect(sealed.publishRun).toBeNull();
    const again = sealConfirmation(root, { envId: SHOP_B, precheck: ready, draft, confirmationId: "c1" });
    expect(again.ok).toBe(true);
    const text = readFileSync(join(root, "confirmed.json"), "utf8");
    const parsed = JSON.parse(text) as { wroteToPlatform: boolean; publishRun: null };
    expect(parsed.wroteToPlatform).toBe(false);
    expect(parsed.publishRun).toBeNull();
    expect(text).not.toMatch(/定时|错峰/);
    expect(readdirSync(root).filter((name) => name.endsWith(".jsonl") || name.toLowerCase().includes("run"))).toEqual([]);
    const unmetDraft = { ...draft, cover: "", platforms: { ...draft.platforms, toutiao: { enabled: true } } };
    const unmet = inspectDraft({
      precheckId: "pre-no",
      envId: SHOP_B,
      draft: unmetDraft,
      revision: 1,
      profiles,
      accounts: [{ platform: "toutiao", state: "ok", checkedAt: "2026-11-13T02:00:00.000Z" }],
    });
    expect(unmet.ok).toBe(true);
    if (!unmet.ok) return;
    const refused = sealConfirmation(join(root, "empty"), { envId: SHOP_B, precheck: unmet, draft: unmetDraft, confirmationId: "c2" });
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.code).toBe("blocked");
    expect(existsSync(join(root, "empty", "confirmed.json"))).toBe(false);
  });
});

describe("发稿页", () => {
  beforeEach(() => {
    installDom();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("保存失败保留输入，销毁后不再保存", async () => {
    const seen: string[] = [];
    let saves = 0;
    const view = composeModel();
    const actions = pageActions({
      async saveDraft(input) {
        saves += 1;
        seen.push(input.draft.title);
        return { ok: false, code: "io", message: "写不进去", envId: input.envId };
      },
    });
    const container = document.createElement("div");
    const page = mount(container, view, actions);
    const title = container.querySelector('[data-field="title"]') as HTMLInputElement;
    title.value = "保留下来的标题";
    title.dispatchEvent(new Event("input"));
    await vi.advanceTimersByTimeAsync(400);
    expect(saves).toBe(1);
    expect(title.value).toBe("保留下来的标题");
    expect(container.querySelector("[data-save-state]")?.textContent).toBe("未保存");
    page.destroy();
    title.value = "销毁后不该再存";
    title.dispatchEvent(new Event("input"));
    await vi.advanceTimersByTimeAsync(1000);
    expect(saves).toBe(1);
    expect(listenerCount(container, "input")).toBe(0);
  });

  it("图片可以预览、移除和排序，选择失败不清空", async () => {
    const view = composeModel();
    view.draft.images = ["D:/pics/a.png", "D:/pics/b.png"];
    view.draft.cover = "D:/pics/cover.png";
    const actions = pageActions({
      async pickImages() {
        return { ok: false, code: "cancelled", message: "没有选中图片", envId: SHOP_B };
      },
    });
    const container = document.createElement("div");
    mount(container, view, actions);
    expect(names(container)).toEqual(["a.png", "b.png"]);
    expect(container.querySelector("[data-role=cover-preview]")?.getAttribute("data-name")).toBe("cover.png");
    click(container, '[data-action="move-image"][data-dir="down"]');
    expect(names(container)).toEqual(["b.png", "a.png"]);
    click(container, '[data-action="remove-image"]');
    expect(names(container)).toEqual(["a.png"]);
    click(container, '[data-action="clear-cover"]');
    expect(container.textContent).toContain("还没有封面");
    click(container, '[data-action="pick-body"]');
    await vi.advanceTimersByTimeAsync(0);
    expect(names(container)).toEqual(["a.png"]);
    expect(container.querySelector("[data-note=images]")?.textContent).toBe("没有选中图片");
  });

  it("检查并发布只打开确认单，未核验和越界不能确认", async () => {
    const calls: Array<Record<string, unknown>> = [];
    let prechecks = 0;
    const actions = pageActions({
      async saveDraft(input) {
        return { ok: true, code: "ok", message: "已保存", envId: input.envId, revision: input.revision + 1, savedAt: "2026-11-13T02:28:00.000Z", draft: input.draft };
      },
      async precheck(input) {
        prechecks += 1;
        const result: PrecheckResult = {
          ok: true,
          code: "ok",
          message: "",
          precheckId: "pre-page",
          envId: input.envId,
          draftRevision: input.revision,
          snapshotHash: "hash",
          platforms: ["toutiao"],
          rows: [{ platform: "toutiao", name: "头条", level: "ok", marks: ["预检通过"], skip: false }],
        };
        return result;
      },
      async confirm(input) {
        calls.push(input);
        return { ok: true, code: "ok", message: "确认已记下。这一步不向平台写稿。", envId: input.envId, confirmationId: input.confirmationId, precheckId: input.precheckId };
      },
    });
    const container = document.createElement("div");
    mount(container, composeModel(), actions);
    const title = container.querySelector('[data-field="title"]') as HTMLInputElement;
    title.value = "标题太长";
    title.dispatchEvent(new Event("input"));
    expect(title.value).toBe("标题太长");
    expect(container.querySelector('[data-field="title"]')?.getAttribute("data-over")).toBe("true");
    expect(container.textContent).toContain("没有自动缩短");
    click(container, '[data-action="check-publish"]');
    await vi.advanceTimersByTimeAsync(0);
    expect(prechecks).toBe(1);
    expect(calls).toEqual([]);
    expect(container.querySelector("[data-role=precheck]")?.textContent).toContain("未核验");
    expect(container.querySelector("[data-role=precheck]")?.textContent).not.toContain("登录正常");
    expect(container.querySelector("[data-role=precheck]")?.textContent).toContain("未选择，不参与本次发布");
    expect(container.querySelector("[data-role=precheck]")?.textContent).not.toMatch(/定时|错峰/);
    click(container, '[data-action="confirm-publish"]');
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toEqual([]);
  });

  it("未核验预检失败后，核验成功会按最新保存 revision 重新预检并可确认", async () => {
    const view = composeModel();
    view.draft.title = "合规";
    view.draft.cover = "D:/pics/cover.png";
    view.draft.platforms.toutiao.confirmed = ["ad"];
    const prechecks: Array<{ envId: string; revision: number; title: string }> = [];
    const confirmations: string[] = [];
    const actions = pageActions({
      async saveDraft(input) {
        return { ok: true, code: "ok", message: "已保存", envId: input.envId, revision: input.revision + 1, savedAt: "2026-11-13T02:28:00.000Z", draft: input.draft };
      },
      async precheck(input) {
        prechecks.push({ envId: input.envId, revision: input.revision, title: input.draft.title });
        const first = prechecks.length === 1;
        return {
          ok: true,
          code: "ok",
          message: "",
          precheckId: first ? "pre-unchecked" : "pre-rechecked",
          envId: input.envId,
          draftRevision: input.revision,
          snapshotHash: "hash",
          platforms: ["toutiao"],
          rows: [{ platform: "toutiao", name: "头条", level: first ? "warn" : "ok", marks: [first ? "登录态未核验" : "预检通过"], skip: first }],
        };
      },
      async checkAccounts(input) {
        return {
          ok: true,
          code: "ok",
          message: "核验完成",
          envId: input.envId,
          accounts: [{ platform: "toutiao", state: "ok", checkedAt: "2026-11-13T02:29:00.000Z" }],
        };
      },
      async confirm(input) {
        confirmations.push(input.precheckId);
        return { ok: true, code: "ok", message: "确认已记下。这一步不向平台写稿。", envId: input.envId, confirmationId: input.confirmationId, precheckId: input.precheckId };
      },
    });
    const container = document.createElement("div");
    mount(container, view, actions);
    click(container, '[data-action="check-publish"]');
    await vi.advanceTimersByTimeAsync(0);
    expect(prechecks).toEqual([{ envId: SHOP_B, revision: 1, title: "合规" }]);
    expect(container.querySelector('[data-action="confirm-publish"]')?.hasAttribute("disabled")).toBe(true);
    click(container, '[data-action="confirm-publish"]');
    await vi.advanceTimersByTimeAsync(0);
    expect(confirmations).toEqual([]);

    click(container, '[data-action="recheck"][data-platform="toutiao"]');
    await vi.advanceTimersByTimeAsync(0);
    expect(prechecks).toEqual([
      { envId: SHOP_B, revision: 1, title: "合规" },
      { envId: SHOP_B, revision: 2, title: "合规" },
    ]);
    expect(container.querySelector('.precheck-row[data-platform="toutiao"]')?.getAttribute("data-status")).toBe("ok");
    expect(container.querySelector('[data-action="confirm-publish"]')?.hasAttribute("disabled")).toBe(false);
    click(container, '[data-action="confirm-publish"]');
    await vi.advanceTimersByTimeAsync(0);
    expect(confirmations).toEqual(["pre-rechecked"]);
  });

  it("平台卡同时只展开一张，准备好的平台才能确认", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const view = composeModel();
    view.accounts = [{ platform: "toutiao", state: "ok", checkedAt: "2026-11-13T02:00:00.000Z" }];
    view.draft.platforms.toutiao.confirmed = ["ad"];
    view.draft.cover = "D:/pics/cover.png";
    const actions = pageActions({
      async saveDraft(input) {
        expect(input.envId).toBe(SHOP_B);
        expect(input.draft.platforms.baijiahao?.enabled).toBe(false);
        return { ok: true, code: "ok", message: "", envId: input.envId, revision: input.revision + 1, savedAt: "2026-11-13T02:28:00.000Z", draft: input.draft };
      },
      async precheck(input) {
        return {
          ok: true,
          code: "ok",
          message: "",
          precheckId: "pre-ready",
          envId: input.envId,
          draftRevision: input.revision,
          snapshotHash: "hash",
          platforms: ["toutiao"],
          rows: [{ platform: "toutiao", name: "头条", level: "ok", marks: ["预检通过"], skip: false }],
        };
      },
      async confirm(input) {
        calls.push({ ...input });
        return { ok: true, code: "ok", message: "确认已记下。这一步不向平台写稿。", envId: input.envId, confirmationId: input.confirmationId, precheckId: input.precheckId };
      },
    });
    const container = document.createElement("div");
    mount(container, view, actions);
    click(container, '[data-platform="toutiao"][data-action="expand"]');
    click(container, '[data-platform="baijiahao"][data-action="expand"]');
    expect(container.querySelector('[data-role=card][data-platform="toutiao"]')?.getAttribute("data-open")).toBe("false");
    expect(container.querySelector('[data-role=card][data-platform="baijiahao"]')?.getAttribute("data-open")).toBe("true");
    click(container, '[data-action="check-publish"]');
    await vi.advanceTimersByTimeAsync(0);
    expect(container.querySelector('[data-status="ok"]')?.textContent).toContain("正常");
    click(container, '[data-action="confirm-publish"]');
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(1);
    expect(Object.keys(calls[0]).sort()).toEqual(["confirmationId", "envId", "precheckId"]);
    expect(calls[0].envId).toBe(SHOP_B);
    const platformTitle = container.querySelector('[data-field="platform-title"][data-platform="toutiao"]') as HTMLInputElement;
    platformTitle.value = "另一套标题";
    platformTitle.dispatchEvent(new Event("input"));
    expect(container.querySelector("[data-role=precheck]")).toBeNull();
  });

  it("没有环境时停止，未关联草稿不放进非默认环境", () => {
    const actions = pageActions();
    const missing = document.createElement("div");
    mount(missing, { ...composeModel(), envId: "" }, actions);
    expect(missing.textContent).toContain("不会改用默认登录");
    expect(missing.querySelector("[data-field=title]")).toBeNull();
    const unlinked = document.createElement("div");
    const model = composeModel();
    model.association = "unlinked";
    model.draft.envId = undefined;
    model.draft.association = "unlinked";
    mount(unlinked, model, actions);
    expect(unlinked.textContent).toContain("未关联");
    expect(unlinked.querySelector("[data-field=title]")).toBeNull();
    expect(unlinked.getAttribute("data-env")).toBe(SHOP_B);
  });
});

function composeModel(): ComposeViewModel {
  const profilesForPage: ComposeProfile[] = [
    { id: "toutiao", name: "头条", titleMin: null, titleMax: 2, bodyMax: null, coverMode: "硬校验，必须回读到图", needsCover: true, minDistinctImages: null, required: [{ id: "ad", label: "投放广告赚收益" }], forbidden: [], defaults: [] },
    { id: "baijiahao", name: "百家", titleMin: null, titleMax: null, bodyMax: null, coverMode: "单图", needsCover: true, minDistinctImages: null, required: [], forbidden: [{ id: "ai", label: "采用AI生成内容" }], defaults: [] },
    { id: "dayu", name: "大鱼", titleMin: null, titleMax: null, bodyMax: null, coverMode: "三图", needsCover: false, minDistinctImages: 3, required: [], forbidden: [], defaults: [{ id: "source", label: "无需标注" }] },
    { id: "sohu", name: "搜狐", titleMin: null, titleMax: null, bodyMax: null, coverMode: "1张", needsCover: true, minDistinctImages: null, required: [{ id: "declare", label: "无需声明" }], forbidden: [], defaults: [] },
  ];
  const draft: ComposeDraft = {
    id: "draft-1",
    title: "",
    summary: "",
    body: "",
    images: [],
    cover: "",
    topics: [],
    primaryPlatform: "toutiao",
    platforms: {
      toutiao: { enabled: true },
      baijiahao: { enabled: false },
      dayu: { enabled: false },
      sohu: { enabled: false },
    },
    schedule: {},
    createdAt: "2026-11-13T00:00:00.000Z",
    updatedAt: "2026-11-13T00:00:00.000Z",
    envId: SHOP_B,
    revision: 0,
    association: "linked",
  };
  return {
    envId: SHOP_B,
    envName: "店铺乙",
    revision: 0,
    association: "linked",
    draft,
    drafts: [draft],
    profiles: profilesForPage,
    accounts: [{ platform: "toutiao", state: "unknown", checkedAt: "" }],
  };
}

function pageActions(over: Partial<PageActions> = {}): PageActions {
  const error = (envId = SHOP_B): StudioError => ({ ok: false, code: "unsupported", message: "尚未接入", envId });
  return {
    navigate: () => undefined,
    reload: async () => undefined,
    saveDraft: async (input) => ({ ok: true, code: "ok", message: "", envId: input.envId, revision: input.revision, savedAt: "", draft: input.draft }),
    precheck: async () => error(),
    confirm: async () => error(),
    pickImages: async () => error(),
    checkAccounts: async () => error(),
    openAccount: async () => error(),
    refreshMetrics: async () => error(),
    openTask: async () => error(),
    verifyTask: async () => error(),
    resumeTask: async () => error(),
    fillReply: async () => error(),
    onTasksChanged: () => () => undefined,
    ...over,
  };
}

function names(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("[data-role=image]")).map((node) => node.getAttribute("data-name") || "");
}

function click(container: HTMLElement, selector: string): void {
  const node = container.querySelector(selector) as HTMLElement | null;
  node?.dispatchEvent(new Event("click"));
}

class DomNode {
  tag: string;
  children: DomNode[] = [];
  parent: DomNode | null = null;
  className = "";
  id = "";
  hidden = false;
  disabled = false;
  title = "";
  placeholder = "";
  type = "";
  checked = false;
  src = "";
  alt = "";
  attrs: Record<string, string> = {};
  private text = "";
  private current = "";
  private listeners = new Map<string, Set<(event: Event) => void>>();

  constructor(tag: string) {
    this.tag = tag;
  }

  set textContent(value: string | null) {
    this.text = value || "";
    this.children = [];
  }

  get textContent(): string {
    if (this.children.length) return this.children.map((child) => child.textContent).join("");
    return this.text;
  }

  set value(value: string) {
    this.current = value;
  }

  get value(): string {
    return this.current;
  }

  append(...nodes: Array<DomNode | string>): void {
    for (const node of nodes) {
      const child = typeof node === "string" ? new DomNode("#text") : node;
      if (typeof node === "string") child.textContent = node;
      child.parent = this;
      this.children.push(child);
    }
  }

  replaceChildren(...nodes: DomNode[]): void {
    for (const child of this.children) child.parent = null;
    this.children = [];
    this.append(...nodes);
  }

  removeChild(child: DomNode): DomNode {
    child.parent = null;
    this.children = this.children.filter((item) => item !== child);
    return child;
  }

  setAttribute(name: string, value: string): void {
    this.attrs[name] = value;
    if (name === "id") this.id = value;
    if (name === "title") this.title = value;
  }

  getAttribute(name: string): string | null {
    return this.attrs[name] ?? null;
  }

  hasAttribute(name: string): boolean {
    return Object.prototype.hasOwnProperty.call(this.attrs, name);
  }

  removeAttribute(name: string): void {
    delete this.attrs[name];
  }

  addEventListener(type: string, fn: (event: Event) => void): void {
    const set = this.listeners.get(type) || new Set<(event: Event) => void>();
    set.add(fn);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, fn: (event: Event) => void): void {
    this.listeners.get(type)?.delete(fn);
  }

  listenerCount(type: string): number {
    return this.listeners.get(type)?.size || 0;
  }

  dispatchEvent(event: Event): boolean {
    this.emit(event.type);
    return true;
  }

  private emit(type: string, target: DomNode = this): void {
    const event = { type, target } as unknown as Event;
    for (const fn of this.listeners.get(type) || []) fn(event);
    this.parent?.emit(type, target);
  }

  querySelector(selector: string): DomNode | null {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector: string): DomNode[] {
    const out: DomNode[] = [];
    const walk = (node: DomNode) => {
      for (const child of node.children) {
        if (selectorMatches(child, selector)) out.push(child);
        walk(child);
      }
    };
    walk(this);
    return out;
  }

  get parentElement(): DomNode | null {
    return this.parent;
  }
}

function selectorMatches(node: DomNode, selector: string): boolean {
  const re = /\[([^\]]+)\]|\.([^.\[#]+)|([a-zA-Z0-9_-]+)/g;
  let saw = false;
  let match: RegExpExecArray | null;
  while ((match = re.exec(selector))) {
    saw = true;
    if (match[1]) {
      const body = match[1];
      const eq = body.indexOf("=");
      if (eq === -1) {
        if (!node.hasAttribute(body)) return false;
      } else if (node.getAttribute(body.slice(0, eq)) !== body.slice(eq + 1).trim().replace(/^["']|["']$/g, "")) {
        return false;
      }
    } else if (match[2]) {
      if (!node.className.split(/\s+/).includes(match[2])) return false;
    } else if (match[3] && node.tag !== match[3]) return false;
  }
  return saw;
}

function installDom(): void {
  const documentStub = {
    createElement: (tag: string) => new DomNode(tag),
    createElementNS: (_ns: string, tag: string) => new DomNode(tag),
    createTextNode: (text: string) => {
      const node = new DomNode("#text");
      node.textContent = text;
      return node;
    },
  };
  Object.assign(globalThis, { document: documentStub });
}

function listenerCount(container: HTMLElement, type: string): number {
  return (container as unknown as DomNode).listenerCount(type);
}
