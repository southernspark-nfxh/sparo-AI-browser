import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolvePublishScript } from "../src/main/skills/runner.js";

describe("发稿脚本路径", () => {
  it("从 out/main/index.js 往上找，能落到仓库里的 publish.mjs", () => {
    const root = mkdtempSync(join(tmpdir(), "sparo-publish-path-"));
    const script = join(root, "strategies", "skills", "social-media-publish", "scripts", "publish.mjs");
    mkdirSync(join(root, "strategies", "skills", "social-media-publish", "scripts"), { recursive: true });
    writeFileSync(script, "// fixture");
    const bundled = join(root, "out", "main", "index.js");
    const found = resolvePublishScript([join(root, "out", "main")], join(root, "node_modules", "electron", "dist", "resources"), (file) => file === script);
    expect(found).toBe(script);
    expect(found).not.toBe(join(root, "..", "strategies", "skills", "social-media-publish", "scripts", "publish.mjs"));
    void bundled;
    rmSync(root, { recursive: true, force: true });
  });

  it("安装包优先用 resources 里的脚本", () => {
    const packed = join("C:\\Program Files\\Sparo\\resources", "social-publish-scripts", "publish.mjs");
    const found = resolvePublishScript(
      [join("C:\\Program Files\\Sparo\\resources\\app.asar", "out", "main")],
      "C:\\Program Files\\Sparo\\resources",
      (file) => file === packed,
    );
    expect(found).toBe(packed);
  });
});
