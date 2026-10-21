import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { matchReaderIntent, routeUserGoal } from "../src/main/agent/intent-router.js";
import { parseLocalIntent } from "../src/main/agent/stub.js";
import { readingReportHtml } from "../src/main/agent/report-html.js";
import { loadHighlights, saveHighlights, getHighlightsForUrl } from "../src/main/agent/highlight.js";
import { htmlToMarkdown, listNotes, writeNote, readNote, deleteNote } from "../src/main/agent/notes.js";
import { loadSettings, saveSettings } from "../src/main/settings/store.js";

const dirs: string[] = [];

function tempConfig(): string {
  const dir = mkdtempSync(join(tmpdir(), "sparo-reader-"));
  dirs.push(dir);
  process.env.SPARO_CONFIG_DIR = dir;
  return dir;
}

afterEach(() => {
  delete process.env.SPARO_CONFIG_DIR;
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("reader intent", () => {
  it("把这页换成阅读模式，不被读页截走", () => {
    const action = routeUserGoal("把这页换成阅读模式");
    expect(action?.type).toBe("reader_mode");
    expect(parseLocalIntent("把这页换成阅读模式").type).toBe("reader_mode");
  });

  it("打开网址并换成阅读模式时带上 URL", () => {
    const action = matchReaderIntent("打开 https://www.gov.cn 换成阅读模式");
    expect(action).toMatchObject({
      type: "reader_mode",
      url: "https://www.gov.cn",
    });
  });

  it("打开并追问网站含义仍走原来的读页", () => {
    const action = routeUserGoal("打开 https://www.gov.cn 用中文告诉我这是什么网站");
    expect(action?.type).toBe("act");
  });

  it("保存这页到笔记走一键盘存", () => {
    expect(routeUserGoal("保存这页到笔记")?.type).toBe("notes_action");
  });

  it("打开 AI伴读", () => {
    expect(routeUserGoal("打开 AI伴读")?.type).toBe("reader_companion");
  });

  it("搜笔记和列出最近分开", () => {
    expect(routeUserGoal("在我的笔记里搜 gov")).toMatchObject({
      type: "notes_search",
      search: "gov",
      listOnly: false,
    });
    expect(routeUserGoal("列出最近保存的 10 篇")).toMatchObject({
      type: "notes_search",
      limit: 10,
      listOnly: true,
    });
  });
});

describe("reading page html", () => {
  it("普通阅读页不带阅读模式工具栏", () => {
    const html = readingReportHtml({ title: "手册", body: "你好 **世界**" });
    expect(html).toContain("<strong>世界</strong>");
    expect(html).not.toContain("reader-toolbar");
    expect(html).not.toContain("AI伴读");
  });

  it("阅读模式保留正文 HTML，并带工具栏", () => {
    const html = readingReportHtml({
      title: "政务",
      body: "<article><p>中华人民共和国中央人民政府门户网站</p></article>",
      reader: {
        sourceUrl: "https://www.gov.cn",
        companionOn: false,
        theme: "paper",
        fontSize: 16,
      },
    });
    expect(html).toContain("<p>中华人民共和国中央人民政府门户网站</p>");
    expect(html).toContain("AI伴读 关");
    expect(html).toContain("一键盘存");
    expect(html).toContain("btnReaderClose");
    expect(html).toContain("__sparoHighlightReady");
    expect(html).not.toContain("&lt;article&gt;");
  });
});

describe("highlights and notes", () => {
  it("空库与写入", () => {
    tempConfig();
    expect(loadHighlights()).toEqual({});
    expect(listNotes()).toEqual([]);
    saveHighlights({
      "https://www.gov.cn": [
        { chunkId: "h1", color: "yellow", text: "门户", createdAt: "2026-10-21T00:00:00.000Z" },
      ],
    });
    expect(getHighlightsForUrl(loadHighlights(), "https://www.gov.cn")).toHaveLength(1);
    expect(getHighlightsForUrl(loadHighlights(), "https://news.ycombinator.com")).toEqual([]);

    const meta = writeNote({
      title: "政务摘录",
      source_url: "https://www.gov.cn",
      markdown: "# 政务摘录\n\n门户",
      summary: "一句话",
      word_count: 2,
      highlights_refs: ["h1"],
    });
    expect(meta.kind).toBe("note");
    expect(meta.source_url).toBe("https://www.gov.cn");
    const listed = listNotes();
    expect(listed).toHaveLength(1);
    expect(listed[0].title).toBe("政务摘录");
    const full = readNote(meta.id);
    expect(full?.markdown).toContain("门户");
    expect(full?.meta.summary).toBe("一句话");
    expect(full?.meta.word_count).toBe(2);
    expect(deleteNote(meta.id)).toBe(true);
    expect(listNotes()).toEqual([]);
  });

  it("搜索标题和来源", () => {
    tempConfig();
    writeNote({ title: "甲", source_url: "https://www.gov.cn/a", markdown: "a" });
    writeNote({ title: "乙", source_url: "https://news.ycombinator.com", markdown: "b" });
    expect(listNotes(undefined, undefined, "gov")).toHaveLength(1);
    expect(listNotes(1)).toHaveLength(1);
  });

  it("mark 转成纯文本", () => {
    const md = htmlToMarkdown('<p>前 <mark data-chunk-id="h1">重点</mark> 后</p>');
    expect(md).toContain("重点");
    expect(md).not.toContain("data-chunk-id");
  });

  it("AI伴读偏好能存下来", () => {
    const dir = tempConfig();
    saveSettings(dir, { reader: { aiCompanionOn: true, theme: "night", fontSize: 20 } });
    expect(loadSettings(dir).reader).toEqual({
      aiCompanionOn: true,
      theme: "night",
      fontSize: 20,
    });
  });
});
