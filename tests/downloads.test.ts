import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { sanitizeDownloadName, uniqueDownloadPath } from "../src/main/downloads.js";

describe("uniqueDownloadPath", () => {
  it("keeps the first unused name", () => {
    const dir = join("D:", "dl");
    expect(uniqueDownloadPath(dir, "report.pdf", () => false)).toBe(join(dir, "report.pdf"));
  });

  it("adds a numeric suffix when the file already exists", () => {
    const dir = join("D:", "dl");
    const taken = new Set([join(dir, "a.pdf"), join(dir, "a (1).pdf")]);
    expect(uniqueDownloadPath(dir, "a.pdf", (p) => taken.has(p))).toBe(join(dir, "a (2).pdf"));
  });

  it("strips illegal filename characters", () => {
    expect(sanitizeDownloadName("a<>b:c.pdf")).toBe("a__b_c.pdf");
  });
});
