import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { replyNoteFields, writeNote, readNote } from "../src/main/agent/notes.js";
import { composeQuotedPrompt, fillNoteQuote, type SparoQuote } from "../src/main/agent/quotes.js";

const dirs: string[] = [];

afterEach(() => {
  delete process.env.SPARO_CONFIG_DIR;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function noteQuote(extra: Partial<SparoQuote> = {}): SparoQuote {
  return {
    text: "摘录",
    title: "旧标题",
    kind: "note",
    ...extra,
  };
}

describe("note quote prompt", () => {
  it("keeps the excerpt when there is no noteId", () => {
    const quote = fillNoteQuote(noteQuote(), { title: "库里的标题", markdown: "全文" });
    const prompt = composeQuotedPrompt("对照一下", [quote]);
    expect(prompt).toContain("[笔记：旧标题]");
    expect(prompt).toContain("摘录");
    expect(prompt).not.toContain("全文");
    expect(prompt.endsWith("[用户指令] 对照一下")).toBe(true);
  });

  it("replaces the excerpt with the stored note and truncates to 4000", () => {
    const markdown = "正".repeat(4100);
    const quote = fillNoteQuote(noteQuote({ noteId: "nabc" }), {
      title: "库里的标题",
      markdown,
    });
    expect(quote.title).toBe("库里的标题");
    expect(quote.text).toHaveLength(4000);
    const prompt = composeQuotedPrompt("有什么新东西", [quote]);
    expect(prompt).toContain("[笔记：库里的标题]");
    expect(prompt).toContain("正".repeat(4000));
    expect(prompt).not.toContain("正".repeat(4001));
    expect(prompt.indexOf("[笔记：")).toBeLessThan(prompt.indexOf("[用户指令]"));
  });

  it("leaves the excerpt when the note cannot be read", () => {
    const quote = fillNoteQuote(noteQuote({ noteId: "nmissing", text: "还在摘录" }), null);
    expect(quote.text).toBe("还在摘录");
  });
});

describe("reply note fields", () => {
  it("maps the user sentence, reply, and source url into a note", () => {
    const dir = mkdtempSync(join(tmpdir(), "sparo-notes-"));
    dirs.push(dir);
    process.env.SPARO_CONFIG_DIR = dir;
    const fields = replyNoteFields(
      "123456789012345678901234567890后面不进标题",
      "RAG 是检索增强生成。",
      "https://baike.baidu.com/item/RAG",
    );
    expect(fields.title).toBe("123456789012345678901234567890");
    expect(fields.title).toHaveLength(30);
    expect(fields.source_url).toBe("https://baike.baidu.com/item/RAG");
    expect(fields.markdown).toBe("RAG 是检索增强生成。");
    const meta = writeNote(fields);
    const loaded = readNote(meta.id);
    expect(loaded?.meta.title).toBe(fields.title);
    expect(loaded?.meta.source_url).toBe(fields.source_url);
    expect(loaded?.markdown).toBe(fields.markdown);
  });
});
