import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readZip, writeZip } from "../src/main/agent/files/zip.js";
import { buildPptx, slidesFromMarkdown } from "../src/main/agent/files/docgen.js";
import { readLocalDoc } from "../src/main/agent/files/read.js";
import { detectFilePaths, stemOf } from "../src/main/agent/files/path-detect.js";
import { detectFileTask } from "../src/main/agent/files/intent.js";
import { chartSvg, parseRows, pickSeries } from "../src/main/agent/files/chart.js";
import { extractPdfText } from "../src/main/agent/files/pdf-text.js";

let dir = "";

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "sparo-files-"));
});

afterAll(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe("zip", () => {
  it("write → read roundtrip", () => {
    const buf = writeZip([
      { name: "a/b.txt", data: "中文内容" },
      { name: "c.xml", data: "<x>1</x>" },
    ]);
    const back = readZip(buf);
    expect(back.get("a/b.txt")?.toString("utf8")).toBe("中文内容");
    expect(back.get("c.xml")?.toString("utf8")).toBe("<x>1</x>");
  });
});

describe("path detect", () => {
  it("finds Windows path with spaces and Chinese", () => {
    const sub = join(dir, "我的 资料");
    mkdirSync(sub, { recursive: true });
    const file = join(sub, "季度 报告.docx");
    writeFileSync(file, "x");
    expect(detectFilePaths(`帮我总结 ${file} 的内容`)).toContain(file);
    expect(detectFilePaths(`"${file}" 生成pdf`)).toContain(file);
    expect(detectFilePaths(`整理${file}的要点`)).toContain(file);
    expect(stemOf(file)).toBe("季度 报告");
  });

  it("ignores non-existent path", () => {
    expect(detectFilePaths("D:\\no\\such\\file-xyz-123.docx 总结一下")).toEqual([]);
  });

  it("does not hijack a file path without an action", () => {
    const file = join(dir, "plain.txt");
    writeFileSync(file, "hello");
    expect(detectFileTask(`保存到 ${file}`)).toBeNull();
    expect(detectFileTask(`${file} 帮我提炼要点`)).not.toBeNull();
  });
});

describe("read", () => {
  it("reads txt and csv", () => {
    const txt = join(dir, "a.txt");
    writeFileSync(txt, "第一行\n第二行");
    const doc = readLocalDoc(txt);
    expect(doc.ok).toBe(true);
    expect(doc.text).toContain("第一行");
  });

  it("reads docx (minimal OOXML)", () => {
    const docx = join(dir, "b.docx");
    const zip = writeZip([
      {
        name: "word/document.xml",
        data: '<w:document><w:body><w:p><w:r><w:t>合同金额 100 万元</w:t></w:r></w:p></w:body></w:document>',
      },
    ]);
    writeFileSync(docx, zip);
    const doc = readLocalDoc(docx);
    expect(doc.ok).toBe(true);
    expect(doc.text).toContain("合同金额 100 万元");
  });

  it("reads xlsx with shared strings", () => {
    const xlsx = join(dir, "c.xlsx");
    const zip = writeZip([
      { name: "xl/workbook.xml", data: '<workbook><sheets><sheet name="销量"/></sheets></workbook>' },
      {
        name: "xl/sharedStrings.xml",
        data: "<sst><si><t>城市</t></si><si><t>北京</t></si><si><t>上海</t></si></sst>",
      },
      {
        name: "xl/worksheets/sheet1.xml",
        data:
          "<worksheet><sheetData>" +
          '<row><c r="A1" t="s"><v>0</v></c><c r="B1" t="inlineStr"><is><t>销量</t></is></c></row>' +
          '<row><c r="A2" t="s"><v>1</v></c><c r="B2"><v>12</v></c></row>' +
          '<row><c r="A3" t="s"><v>2</v></c><c r="B3"><v>34</v></c></row>' +
          "</sheetData></worksheet>",
      },
    ]);
    writeFileSync(xlsx, zip);
    const doc = readLocalDoc(xlsx);
    expect(doc.ok).toBe(true);
    expect(doc.text).toContain("北京");
    const spec = pickSeries(parseRows(doc.text), "销量");
    expect(spec?.values).toEqual([12, 34]);
  });

  it("reads pptx slides in order", () => {
    const pptx = join(dir, "d.pptx");
    const zip = writeZip([
      { name: "ppt/slides/slide1.xml", data: "<a:t>第一页</a:t>" },
      { name: "ppt/slides/slide2.xml", data: "<a:t>第二页</a:t>" },
    ]);
    writeFileSync(pptx, zip);
    const doc = readLocalDoc(pptx);
    expect(doc.text.indexOf("第一页")).toBeLessThan(doc.text.indexOf("第二页"));
  });
});

describe("pdf", () => {
  it("extracts literal text from an uncompressed content stream", () => {
    const pdf = Buffer.from(
      `%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n2 0 obj\n<< /Length 44 >>\nstream\nBT /F1 12 Tf 72 720 Td (Hello Sparo) Tj ET\nendstream\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF`,
      "latin1",
    );
    expect(extractPdfText(pdf)).toContain("Hello Sparo");
  });

  it("returns empty for a binary-only pdf", () => {
    expect(extractPdfText(Buffer.from("%PDF-1.4\n%��\n%%EOF", "latin1"))).toBe("");
  });
});

describe("pptx build", () => {
  it("produces a valid zip with slides", () => {
    const deck = slidesFromMarkdown("季度复盘", "# 季度复盘\n\n## 收入\n- 增长 12%\n- 华东最好\n\n## 问题\n- 退货率高");
    const buf = buildPptx(deck);
    const zip = readZip(buf);
    expect(zip.get("[Content_Types].xml")?.toString("utf8")).toContain("presentationml.presentation.main+xml");
    expect(zip.get("ppt/presentation.xml")?.toString("utf8")).toContain("p:sldIdLst");
    const slides = [...zip.keys()].filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k));
    expect(slides.length).toBe(deck.slides.length);
    expect(zip.get("ppt/slides/slide2.xml")?.toString("utf8")).toContain("收入");
  });
});

describe("chart", () => {
  it("picks numeric series and renders svg", () => {
    const rows = parseRows("城市,销量\n北京,10\n上海,20\n广州,15");
    const spec = pickSeries(rows, "销量");
    expect(spec?.labels).toEqual(["北京", "上海", "广州"]);
    const svg = chartSvg(spec!);
    expect(svg).toContain("<svg");
    expect(svg).toContain("北京");
  });

  it("returns null when no numeric column", () => {
    expect(pickSeries(parseRows("城市,备注\n北京,好\n上海,差"))).toBeNull();
  });
});

describe("intent", () => {
  it("maps formats", () => {
    const file = join(dir, "e.xlsx");
    writeFileSync(file, "x");
    const plan = detectFileTask(`${file} 提炼要点并生成 PDF 和 PPT`);
    expect(plan?.formats).toContain("pdf");
    expect(plan?.formats).toContain("pptx");
    expect(plan?.path).toBe(file);
  });

  it("treats 填进当前网页表单 as form only, not html", () => {
    const file = join(dir, "e.txt");
    writeFileSync(file, "x");
    const plan = detectFileTask(`把 ${file} 的内容填进当前网页表单`);
    expect(plan?.formats).toContain("form");
    expect(plan?.formats).not.toContain("html");
  });

  it("keeps html when explicitly asked", () => {
    const file = join(dir, "e.txt");
    writeFileSync(file, "x");
    const plan = detectFileTask(`把 ${file} 填进表单，另外再生成一份 html 报告`);
    expect(plan?.formats).toContain("form");
    expect(plan?.formats).toContain("html");
  });
});
