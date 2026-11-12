import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { allowReply, canReply, fillOpenReply, HOUR_CAP, mapCommentList, MIN_GAP_MS, replyLabel } from "../strategies/skills/social-media-publish/scripts/comments.mjs";
import { loadProfile } from "../strategies/skills/social-media-publish/scripts/profile.mjs";

describe("评论回复边界", () => {
  it("只有头条和百家能回复", () => {
    expect(canReply("toutiao")).toBe(true);
    expect(canReply("baijiahao")).toBe(true);
    expect(replyLabel("dayu")).toBe("只读，回复未开");
    expect(replyLabel("sohu")).toBe("只读，回复未开");
  });

  it("间隔 20 秒，每小时不超过 30 条", () => {
    const now = 1_000_000;
    expect(allowReply([now - MIN_GAP_MS + 1000], now).ok).toBe(false);
    expect(allowReply([now - MIN_GAP_MS], now).ok).toBe(true);
    const burst = Array.from({ length: HOUR_CAP }, (_, index) => now - 60_000 - index * 1000);
    expect(allowReply(burst, now).reason).toContain("30");
  });

  it("按实测字段映射评论，不补空行", () => {
    const toutiao = mapCommentList(loadProfile("toutiao"), {
      data: [{ id_str: "1", text: "写得好", create_time: 1762828800, user: { name: "甲" }, article_info: { group_id_str: "9", title: "一篇" } }],
    });
    expect(toutiao).toEqual([expect.objectContaining({ commentId: "1", author: "甲", content: "写得好", title: "一篇", articleId: "9" })]);
    const baijia = mapCommentList(loadProfile("baijiahao"), {
      data: { reply_list: [{ reply_id: "2", content: "收到", uname: "乙", article_id: "8", title: "另一篇", create_time: "2026-11-11 09:00" }] },
    });
    expect(baijia[0]).toMatchObject({ commentId: "2", author: "乙", content: "收到", createdAt: "2026-11-11 09:00" });
    expect(mapCommentList(loadProfile("baijiahao"), {
      data: { reply_list: [{ reply_id: "3", content: "时间", uname: "丙", article_id: "1", title: "题", create_time: "1794387488" }] },
    })[0].createdAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    expect(mapCommentList(loadProfile("toutiao"), { data: {} })).toEqual([]);
  });

  it("没到间隔时填写动作直接停，不去碰页面", async () => {
    const dir = mkdtempSync(join(tmpdir(), "studio-reply-"));
    const prev = process.env.APPDATA;
    process.env.APPDATA = dir;
    mkdirSync(join(dir, "sparo-store"), { recursive: true });
    writeFileSync(join(dir, "sparo-store", "comment-drafts.json"), JSON.stringify({
      toutiao: { text: "", stamps: [Date.now()] },
    }));
    try {
      const result = await fillOpenReply("toutiao", "已看到", { commentId: "1", content: "写得好" });
      expect(result.filled).toBeUndefined();
      expect(result.message).toContain("20");
    } finally {
      process.env.APPDATA = prev;
    }
  });
});
