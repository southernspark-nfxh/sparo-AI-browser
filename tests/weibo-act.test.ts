import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { weiboActScript } from "../src/main/skills/weibo-act.js";

describe("微博当前页评论转发", () => {
  it("文字里的引号不会把脚本拆开，两件都做", () => {
    const script = weiboActScript('他说"好"', "both", "兰溪");
    expect(script).toContain('"他说\\"好\\""');
    expect(script).toContain('"mode":"both"');
    expect(script).toContain("没有离开这一页");
    expect(script).not.toContain("location.assign");
    expect(script).not.toContain("window.open");
    expect(script).toContain("登录(?:\\s|[\\/|｜]){0,12}注册");
    expect(script).toContain("aria-label");
    expect(script).toContain("own.length <= 8");
    expect(script).toContain("/^\\d+$/");
    expect(script).toContain("页面上看到的是");
    expect(script).not.toContain("document.body.innerText || \"\").includes(text");
    expect(() => new Function(`return ${script}`)).not.toThrow();
  });

  it("技能别名覆盖评论和转发", () => {
    const skill = JSON.parse(
      readFileSync("strategies/skills/weibo-comment-repost.json", "utf8"),
    ) as { id: string; aliases: string[]; steps: Array<{ tool: string }> };
    expect(skill.id).toBe("weibo-comment-repost");
    expect(skill.aliases).toContain("微博评论");
    expect(skill.aliases).toContain("微博转发");
    expect(skill.steps.map((step) => step.tool)).toEqual(["weibo_act"]);
  });
});
