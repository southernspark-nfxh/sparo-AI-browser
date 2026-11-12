import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  emptyDraft,
  failureCount,
  loadDraftDir,
  overviewFrom,
  precheckDraft,
  readProfiles,
  saveDraftDir,
  type StudioProfile,
} from "../src/main/studio-store.js";

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

  it("总览只有待发、失败和登录三项", () => {
    const view = overviewFrom(2, failureCount([{ ok: false }, { ok: true }]));
    expect(view).toEqual({ pending: 2, failed: 1, login: "未检查" });
    expect(Object.keys(view)).toEqual(["pending", "failed", "login"]);
  });
});
