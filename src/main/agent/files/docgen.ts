/**
 * 出文档：PPTX（最小 OOXML）+ 文件名/目录工具。
 * PDF / 图片另在 browser.ts 用隐藏窗 printToPDF / capturePage 生成（需 Electron 运行时）。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { writeZip } from "./zip.js";

export type Slide = { title: string; bullets: string[] };

export type DocSpec = {
  title: string;
  slides: Slide[];
};

function esc(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const EMU_W = 12192000;
const EMU_H = 6858000;

function textBox(
  id: number,
  x: number,
  y: number,
  cx: number,
  cy: number,
  runs: string[],
  sizePt: number,
  bold: boolean,
): string {
  const paras = runs
    .map(
      (r, i) =>
        `<a:p><a:pPr algn="l"/><a:r><a:rPr lang="zh-CN" sz="${Math.round(sizePt * 100)}" b="${bold ? 1 : 0}" dirty="0"><a:latin typeface="Microsoft YaHei"/><a:ea typeface="Microsoft YaHei"/></a:rPr><a:t>${
          i === 0 ? esc(r) : "• " + esc(r)
        }</a:t></a:r></a:p>`,
    )
    .join("");
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="tb${id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr wrap="square"><a:normAutofit/></a:bodyPr><a:lstStyle/>${paras}</p:txBody></p:sp>`;
}

function slideXml(slide: Slide, index: number): string {
  const titleRuns = [slide.title || `第 ${index + 1} 页`];
  const bodyRuns = (slide.bullets || []).filter((b) => b.trim()).slice(0, 12);
  const title = textBox(2, 685800, 457200, EMU_W - 1371600, 900000, titleRuns, 32, true);
  const body = bodyRuns.length
    ? textBox(3, 685800, 1500000, EMU_W - 1371600, EMU_H - 2000000, bodyRuns, 18, false)
    : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${title}${body}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
}

const CT = (part: string, type: string) => `<Override PartName="${part}" ContentType="${type}"/>`;

function contentTypes(count: number): string {
  const slides = Array.from({ length: count }, (_, i) =>
    CT(`/ppt/slides/slide${i + 1}.xml`, "application/vnd.openxmlformats-officedocument.presentationml.slide+xml"),
  ).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>${CT(
    "/ppt/presentation.xml",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml",
  )}${CT("/ppt/slideMasters/slideMaster1.xml", "application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml")}${CT(
    "/ppt/slideLayouts/slideLayout1.xml",
    "application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml",
  )}${slides}${CT(
    "/ppt/presProps.xml",
    "application/vnd.openxmlformats-officedocument.presentationml.presProps+xml",
  )}${CT("/ppt/theme/theme1.xml", "application/vnd.openxmlformats-officedocument.theme+xml")}${CT(
    "/docProps/core.xml",
    "application/vnd.openxmlformats-package.core-properties+xml",
  )}${CT("/docProps/app.xml", "application/vnd.openxmlformats-officedocument.extended-properties+xml")}</Types>`;
}

const REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const OFFICE_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

function presentationXml(count: number, title: string): string {
  const ids = Array.from(
    { length: count },
    (_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`,
  ).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${OFFICE_REL}" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${ids}</p:sldIdLst><p:sldSz cx="${EMU_W}" cy="${EMU_H}"/><p:notesSz cx="${EMU_H}" cy="${EMU_W}"/><p:title>${esc(
    title,
  )}</p:title></p:presentation>`;
}

function presentationRels(count: number): string {
  const slides = Array.from(
    { length: count },
    (_, i) =>
      `<Relationship Id="rId${i + 2}" Type="${OFFICE_REL}/slide" Target="slides/slide${i + 1}.xml"/>`,
  ).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="${OFFICE_REL}/slideMaster" Target="slideMasters/slideMaster1.xml"/>${slides}<Relationship Id="rId${
    count + 2
  }" Type="${OFFICE_REL}/presProps" Target="presProps.xml"/><Relationship Id="rId${
    count + 3
  }" Type="${OFFICE_REL}/theme" Target="theme/theme1.xml"/></Relationships>`;
}

const SLIDE_MASTER = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${OFFICE_REL}" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>`;

const SLIDE_LAYOUT = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${OFFICE_REL}" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1"><p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;

const PRES_PROPS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentationPr xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${OFFICE_REL}" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>`;

const THEME = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Sparo"><a:themeElements><a:clrScheme name="Sparo"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1A1F27"/></a:dk2><a:lt2><a:srgbClr val="F7F4EE"/></a:lt2><a:accent1><a:srgbClr val="B42318"/></a:accent1><a:accent2><a:srgbClr val="6B645A"/></a:accent2><a:accent3><a:srgbClr val="3D3830"/></a:accent3><a:accent4><a:srgbClr val="E6E0D4"/></a:accent4><a:accent5><a:srgbClr val="F1EBE0"/></a:accent5><a:accent6><a:srgbClr val="8A5A44"/></a:accent6><a:hlink><a:srgbClr val="B42318"/></a:hlink><a:folHlink><a:srgbClr val="6B645A"/></a:folHlink></a:clrScheme><a:fontScheme name="Sparo"><a:majorFont><a:latin typeface="Microsoft YaHei"/><a:ea typeface="Microsoft YaHei"/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Microsoft YaHei"/><a:ea typeface="Microsoft YaHei"/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Sparo"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln><a:ln w="12700" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln><a:ln w="19050" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>`;

function coreXml(title: string): string {
  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(
    title,
  )}</dc:title><dc:creator>Sparo</dc:creator><cp:lastModifiedBy>Sparo</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`;
}

const APP_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Sparo</Application></Properties>`;

/** 生成能被 PowerPoint / WPS 打开的 .pptx */
export function buildPptx(spec: DocSpec): Buffer {
  const slides = (spec.slides || []).filter((s) => s && (s.title || (s.bullets || []).length));
  if (!slides.length) slides.push({ title: spec.title || "Sparo", bullets: [] });
  const entries: Array<{ name: string; data: string }> = [
    { name: "[Content_Types].xml", data: contentTypes(slides.length) },
    {
      name: "_rels/.rels",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="${OFFICE_REL}/officeDocument" Target="ppt/presentation.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="${OFFICE_REL}/extended-properties" Target="docProps/app.xml"/></Relationships>`,
    },
    { name: "docProps/core.xml", data: coreXml(spec.title) },
    { name: "docProps/app.xml", data: APP_XML },
    { name: "ppt/presentation.xml", data: presentationXml(slides.length, spec.title) },
    { name: "ppt/_rels/presentation.xml.rels", data: presentationRels(slides.length) },
    { name: "ppt/presProps.xml", data: PRES_PROPS },
    { name: "ppt/theme/theme1.xml", data: THEME },
    { name: "ppt/slideMasters/slideMaster1.xml", data: SLIDE_MASTER },
    {
      name: "ppt/slideMasters/_rels/slideMaster1.xml.rels",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="${OFFICE_REL}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="${OFFICE_REL}/theme" Target="../theme/theme1.xml"/></Relationships>`,
    },
    { name: "ppt/slideLayouts/slideLayout1.xml", data: SLIDE_LAYOUT },
    {
      name: "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="${OFFICE_REL}/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`,
    },
  ];
  slides.forEach((slide, i) => {
    entries.push({ name: `ppt/slides/slide${i + 1}.xml`, data: slideXml(slide, i) });
    entries.push({
      name: `ppt/slides/_rels/slide${i + 1}.xml.rels`,
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="${OFFICE_REL}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>`,
    });
  });
  return writeZip(entries);
}

/** 把 Markdown 正文拆成幻灯片：## 分页，列表/句子做要点。 */
export function slidesFromMarkdown(title: string, md: string): DocSpec {
  const lines = String(md || "").replace(/\r\n/g, "\n").split("\n");
  let deckTitle = title || "文档整理";
  const sections: Array<{ title: string; lines: string[] }> = [];
  let cur: { title: string; lines: string[] } | null = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const h1 = /^#\s+(.+)$/.exec(line);
    if (h1 && !sections.length && !cur) {
      deckTitle = h1[1].trim();
      continue;
    }
    const h2 = /^#{2,3}\s+(.+)$/.exec(line);
    if (h2) {
      if (cur) sections.push(cur);
      cur = { title: h2[1].trim(), lines: [] };
      continue;
    }
    if (!cur) cur = { title: "", lines: [] };
    cur.lines.push(line);
  }
  if (cur) sections.push(cur);

  const bulletsOf = (list: string[]): string[] => {
    const out: string[] = [];
    for (const l of list) {
      const item = l.replace(/^[-*•]\s+/, "").replace(/^\d+[.、)]\s*/, "").trim();
      if (!item) continue;
      if (item.length <= 70) out.push(item);
      else {
        const parts = item.split(/[。；;]/).map((s) => s.trim()).filter(Boolean);
        for (const p of parts) if (p.length > 4) out.push(p.slice(0, 70));
      }
      if (out.length >= 7) break;
    }
    return out;
  };

  let slides: Slide[] = sections
    .map((s) => ({ title: s.title || deckTitle, bullets: bulletsOf(s.lines) }))
    .filter((s) => s.title || s.bullets.length);
  if (!slides.length) {
    const paras = String(md || "")
      .replace(/^#+\s+.*$/gm, "")
      .split(/\n{2,}/)
      .map((p) => p.replace(/\n/g, " ").trim())
      .filter(Boolean);
    slides = paras.slice(0, 8).map((p, i) => ({
      title: `要点 ${i + 1}`,
      bullets: p.length > 70 ? [p.slice(0, 68) + "…"] : [p],
    }));
  }
  slides = slides.slice(0, 12);
  // 封面
  const cover: Slide = {
    title: deckTitle,
    bullets: slides[0]?.bullets.slice(0, 2) || [],
  };
  return { title: deckTitle, slides: [cover, ...slides] };
}

/** 产物目录：%APPDATA%/sparo-store/exports */
export function exportsDir(configDir: string): string {
  const dir = join(configDir, "exports");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

export function writeExport(configDir: string, fileStem: string, ext: string, data: string | Buffer): string {
  const path = join(exportsDir(configDir), `${fileStem}.${ext}`);
  writeFileSync(path, data);
  return path;
}
