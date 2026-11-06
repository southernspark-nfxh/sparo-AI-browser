import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  BrowserWindow: class BrowserWindow {},
  WebContentsView: class WebContentsView {},
  Menu: { buildFromTemplate: () => ({ popup: () => undefined }), setApplicationMenu: () => undefined },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
  app: {
    getPath: () => process.cwd(),
    getAppPath: () => process.cwd(),
    isReady: () => true,
    isPackaged: false,
    on: () => undefined,
    whenReady: () => Promise.resolve(),
    getAppMetrics: () => [],
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
    getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1280, height: 800 } },
    ) },
  nativeImage: { createFromPath: () => ({}) },
}));

import { FreeSoul } from "../src/main/agent/free-soul.js";
import { saveDoc } from "../src/main/save-doc.js";
import { matchSkills } from "../src/main/skills/runner.js";
import { saveSkill } from "../src/main/skills/store.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "sparo-v18-"));
  dirs.push(dir);
  return dir;
}

type SentBody = {
  messages?: Array<{ role?: string; content?: string | null }>;
  tools?: Array<{ function?: { name?: string } }>;
};

function scripted(replies: Array<{ content?: string | null }>, sent: SentBody[]): typeof fetch {
  let index = 0;
  return async (_url, init) => {
    sent.push(JSON.parse(String(init?.body || "{}")) as SentBody);
    const reply = replies[index++];
    if (!reply) throw new Error(`unexpected completion ${index}`);
    return new Response(JSON.stringify({ choices: [{ message: reply }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
}

describe("T68 save_doc 本地文档工具", () => {
  it("默认落 docs 目录，md 格式，内容原样", () => {
    const dir = tempDir();
    const result = saveDoc(dir, { title: "微博热搜前10", body: "# 清单\n\n1. 第一条" });
    expect(result.ok).toBe(true);
    const path = String((result.data as { path: string } | undefined)?.path || "");
    expect(path).toContain(join(dir, "docs"));
    expect(path.endsWith(".md")).toBe(true);
    expect(readFileSync(path, "utf8")).toBe("# 清单\n\n1. 第一条");
  });

  it("指定路径落到已存在的目录，txt 也行", () => {
    const dir = tempDir();
    const target = join(dir, "notes");
    mkdirSync(target, { recursive: true });
    const result = saveDoc(dir, { title: "问答", body: "正文", format: "txt", path: join(target, "问答.txt") });
    expect(result.ok).toBe(true);
    expect(existsSync(join(target, "问答.txt"))).toBe(true);
  });

  it("拒绝：缺 title、缺 body、相对路径、目录不存在、非法扩展名、系统目录、超长", () => {
    const dir = tempDir();
    expect(saveDoc(dir, { body: "x" }).ok).toBe(false);
    expect(saveDoc(dir, { title: "t" }).ok).toBe(false);
    expect(saveDoc(dir, { title: "t", body: "x", path: "notes/a.md" }).ok).toBe(false);
    expect(saveDoc(dir, { title: "t", body: "x", path: join(dir, "没有这个目录", "a.md") }).ok).toBe(false);
    expect(saveDoc(dir, { title: "t", body: "x", path: join(dir, "a.exe") }).ok).toBe(false);
    expect(saveDoc(dir, { title: "t", body: "x", path: "C:\\Windows\\system32\\a.md" }).ok).toBe(false);
    expect(saveDoc(dir, { title: "t", body: "x".repeat(2 * 1024 * 1024 + 1) }).ok).toBe(false);
  });

  it("不覆盖已存在的文件", () => {
    const dir = tempDir();
    const target = join(dir, "已有.md");
    writeFileSync(target, "旧内容", "utf8");
    const result = saveDoc(dir, { title: "t", body: "新内容", path: target });
    expect(result.ok).toBe(false);
    expect(readFileSync(target, "utf8")).toBe("旧内容");
  });

  it("进 Free Soul 工具表和系统提示，step 与 auto 同样", async () => {
    for (const execMode of [undefined, "auto"] as const) {
      const sent: SentBody[] = [];
      const soul = new FreeSoul(
        { apiKey: "test", baseUrl: "https://example.test/v1", model: "m", fetchImpl: scripted([{ content: "好" }], sent) },
        () => ({ ok: true, message: "" }),
      );
      await soul.run({ input: "存个文档", url: "", title: "", execMode });
      const names = (sent[0].tools || []).map((t) => t.function?.name);
      expect(names).toContain("save_doc");
      expect(String(sent[0].messages?.[0]?.content || "")).toContain("save_doc");
    }
  });
});

describe("T69 match_skill 低分候选不再入池", () => {
  function distilledSkill(dir: string, id: string, title: string, intent: string, aliases: string[] = []) {
    return saveSkill(dir, {
      id,
      title,
      intent,
      source: "taught",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      steps: [],
      stepCount: 0,
      stats: { success: 0, fail: 0 },
      enabled: true,
      distilled: true,
      route: [{ kind: "open", goal: "示例" }],
      ...(aliases.length ? { aliases } as object : {}),
    });
  }

  it("「贴吧留言」不再命中零关键词的 distilled 技能", () => {
    const dir = tempDir();
    distilledSkill(dir, "taught-1688", "1688选品", "1688 上游选品");
    const hits = matchSkills(dir, "如何去百度贴吧留言");
    expect(hits.some((h) => h.id === "taught-1688")).toBe(false);
  });

  it("title 子串命中走 35 分通道照常过线，弱关联整句不进候选", () => {
    const dir = tempDir();
    distilledSkill(dir, "taught-weak", "运动鞋批发价目", "运动鞋 批发 报价");
    const hit = matchSkills(dir, "运动鞋");
    expect(hit.some((h) => h.id === "taught-weak")).toBe(true);
    const miss = matchSkills(dir, "怎么挑双舒服的跑鞋");
    expect(miss.some((h) => h.id === "taught-weak")).toBe(false);
  });

  it("exact 与 alias 命中不回归", () => {
    const dir = tempDir();
    distilledSkill(dir, "taught-bijia", "比价助手", "全网比价", ["比价"]);
    const byAlias = matchSkills(dir, "帮我比价索尼耳机");
    expect(byAlias.some((h) => h.id === "taught-bijia")).toBe(true);
    const byExact = matchSkills(dir, "比价助手");
    expect(byExact.some((h) => h.id === "taught-bijia")).toBe(true);
  });
});
