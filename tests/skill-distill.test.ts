import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  distillSkillFromTrace,
  mutationsToSteps,
  parseDistillMeta,
} from "../src/main/agent/remember.js";
import { listSkills } from "../src/main/skills/store.js";
import { matchSkills } from "../src/main/skills/runner.js";

const dirs: string[] = [];
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), "sparo-skill-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

const TRACE = [
  { tool: "navigate", args: { url: "https://example.com/login" } },
  { tool: "fill", args: { selector: "#user", value: "me" } },
  { tool: "fill", args: { selector: "#pass", value: "x" } },
  { tool: "click", args: { selector: "#submit" } },
];

describe("大脑沉淀新技能", () => {
  it("成功轨迹 + 模型起名 → 存成技能，matchSkills 能命中", async () => {
    const dir = tempDir();
    const skill = await distillSkillFromTrace({
      configDir: dir,
      goal: "打开示例站登录",
      url: "https://example.com/login",
      reply: "已登录成功。",
      mutations: TRACE,
      complete: async () =>
        '{"title":"示例站登录","intent":"需要登录示例站时调用","aliases":["登录示例"]}',
    });
    expect(skill).not.toBeNull();
    expect(skill!.title).toBe("示例站登录");
    expect((skill as { aliases?: string[] }).aliases).toContain("登录示例");
    const all = listSkills(dir);
    expect(all.some((s) => s.id === skill!.id)).toBe(true);
    const hit = matchSkills(dir, "登录示例");
    expect(hit.some((m) => m.id === skill!.id)).toBe(true);
  });

  it("模型起名失败也能用规则名沉淀", async () => {
    const dir = tempDir();
    const skill = await distillSkillFromTrace({
      configDir: dir,
      goal: "打开微博发一条今天的心情",
      url: "https://weibo.com",
      reply: "草稿已填好。",
      mutations: TRACE,
      complete: async () => "不是JSON",
    });
    expect(skill).not.toBeNull();
    expect(skill!.title).toBe("微博发帖");
  });

  it("纯读页（没有两步交互）不沉淀", async () => {
    const dir = tempDir();
    const skill = await distillSkillFromTrace({
      configDir: dir,
      goal: "看看这个页面",
      mutations: [
        { tool: "navigate", args: { url: "https://example.com" } },
        { tool: "page_text", args: {} },
      ],
    });
    expect(skill).toBeNull();
  });

  it("失败回复不沉淀", async () => {
    const dir = tempDir();
    const skill = await distillSkillFromTrace({
      configDir: dir,
      goal: "登录某站",
      reply: "打不开这个页面，失败了。",
      mutations: TRACE,
    });
    expect(skill).toBeNull();
  });

  it("验证码场景不沉淀", async () => {
    const dir = tempDir();
    const skill = await distillSkillFromTrace({
      configDir: dir,
      goal: "过一下验证码",
      mutations: TRACE,
    });
    expect(skill).toBeNull();
  });

  it("distill meta 解析容错", () => {
    expect(parseDistillMeta('{"title":"查快递","intent":"查物流时用","aliases":["快递"]}')).toEqual({
      title: "查快递",
      intent: "查物流时用",
      aliases: ["快递"],
    });
    expect(parseDistillMeta("没有JSON")).toBeNull();
    expect(parseDistillMeta('{"title":""}')).toBeNull();
  });

  it("mutationsToSteps 只留会改页面的动作", () => {
    const steps = mutationsToSteps([
      { tool: "navigate", args: { url: "https://a.com" } },
      { tool: "page_text", args: {} },
      { tool: "click", args: { selector: "#go" } },
    ]);
    expect(steps.map((s) => s.action)).toEqual(["navigate", "click"]);
  });
});
