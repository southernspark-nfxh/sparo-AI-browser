import { describe, expect, it } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executePrimitivesOnBrowser } from "../src/main/analyzer/execute-primitives.js";
import { FIELD_VALUE_SCRIPT } from "../src/main/page-scripts.js";
import type { AnalyzedPage } from "../src/main/analyzer/types.js";

const page: AnalyzedPage = {
  ok: true,
  url: "https://example.com/form",
  title: "form",
  host: "example.com",
  page_type: "form",
  required_fields: [
    {
      ref: "f1",
      primitive: "text_input",
      label: "标题",
      required: true,
      current_value: "你好",
    },
  ],
  optional_fields: [],
  buttons: [],
  alerts: [],
  field_count: 1,
  capturedAt: "2026-10-21T00:00:00.000Z",
};

describe("execute primitives readField", () => {
  it("读回校验走 FIELD_VALUE_SCRIPT，不抛 ReferenceError", async () => {
    let script = "";
    const browser = {
      configDir: () => join(tmpdir(), "sparo-exec-prim-test"),
      analyzePage: async () => ({ ok: true, message: "ok", data: page }),
      fill: async () => ({ ok: true, message: "filled" }),
      click: async () => ({ ok: true, message: "clicked" }),
      clickText: async () => ({ ok: true, message: "clicked" }),
      select: async () => ({ ok: true, message: "selected" }),
      upload: async () => ({ ok: true, message: "uploaded" }),
      pickCalendar: async () => ({ ok: true, message: "picked" }),
      execute: async (code: string) => {
        script = code;
        return { ok: true, message: "ok", data: { result: { ok: true, value: "你好" } } };
      },
    };
    const r = await executePrimitivesOnBrowser(browser, { payload: { 标题: "你好" } });
    expect(script).toContain(FIELD_VALUE_SCRIPT);
    expect(script).toContain("f1");
    expect(r.ok).toBe(true);
    expect(r.data?.steps[0]?.qa?.actual).toBe("你好");
    expect(r.data?.steps[0]?.qa?.matched).toBe(true);
  });
});
