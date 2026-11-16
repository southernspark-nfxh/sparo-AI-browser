// 零依赖 .docx 生成器：手写 ZIP（zlib.deflateRawSync + CRC32）+ 最小 OOXML。
// 用途：图片多的稿子走平台「文档导入」，一次把标题、正文、插图送进编辑器。
// 仓库 node_modules 里没有 jszip/adm-zip/docx，这里不引第三方。
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

// ---------- ZIP ----------
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const time = ((date.getHours() & 0x1f) << 11) | ((date.getMinutes() & 0x3f) << 5) | ((date.getSeconds() / 2) & 0x1f);
  const day = (((date.getFullYear() - 1980) & 0x7f) << 9) | (((date.getMonth() + 1) & 0xf) << 5) | (date.getDate() & 0x1f);
  return { time, day };
}

/** entries: [{ name, data:Buffer }] → ZIP Buffer（deflate） */
export function zipStore(entries, date = new Date()) {
  const { time, day } = dosDateTime(date);
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const raw = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, "utf8");
    const packed = zlib.deflateRawSync(raw);
    const crc = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 名称
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, packed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(day, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // disk
    central.writeUInt16LE(0, 36); // internal attr
    central.writeUInt32LE(0, 38); // external attr
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + packed.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([Buffer.concat(locals), centralBuf, eocd]);
}

// ---------- OOXML ----------
function xmlEscape(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    // OOXML 不接受控制字符
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
}

const MEDIA_TYPES = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
};

function mediaTypeOf(file) {
  const ext = path.extname(String(file)).replace(".", "").toLowerCase();
  return MEDIA_TYPES[ext] ? { ext: ext === "jpeg" ? "jpg" : ext, type: MEDIA_TYPES[ext] } : null;
}

// 固定版心宽 4 英寸（3657600 EMU），高度按 3:2，避免解析图片真实像素
const IMG_CX = 3657600;
const IMG_CY = 2438400;

function run(text) {
  return `<w:r><w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r>`;
}

function para(text, ppr = "") {
  return `<w:p>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ""}${run(text)}</w:p>`;
}

function heading(text, level) {
  const n = Math.min(Math.max(level || 1, 1), 3);
  return para(text, `<w:pStyle w:val="Heading${n}"/><w:outlineLvl w:val="${n - 1}"/>`);
}

function bullet(text, index, ordered) {
  const mark = ordered ? `${index}. ` : "• ";
  return para(mark + text, `<w:pStyle w:val="ListParagraph"/><w:ind w:left="420" w:hanging="240"/>`);
}

function quote(text) {
  return `<w:p><w:pPr><w:ind w:left="420"/><w:shd w:val="clear" w:color="auto" w:fill="F5F5F5"/></w:pPr><w:r><w:rPr><w:i/></w:rPr><w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r></w:p>`;
}

function hr() {
  return `<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="CCCCCC"/></w:pBdr></w:pPr></w:p>`;
}

function imagePara(relId, docPrId, name) {
  return `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:drawing>` +
    `<wp:inline distT="0" distB="0" distL="0" distR="0">` +
    `<wp:extent cx="${IMG_CX}" cy="${IMG_CY}"/>` +
    `<wp:effectExtent l="0" t="0" r="0" b="0"/>` +
    `<wp:docPr id="${docPrId}" name="Picture ${docPrId}"/>` +
    `<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr>` +
    `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">` +
    `<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:nvPicPr><pic:cNvPr id="${docPrId}" name="${xmlEscape(name)}"/><pic:cNvPicPr><a:picLocks noChangeAspect="1"/></pic:cNvPicPr></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${IMG_CX}" cy="${IMG_CY}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
    `</pic:pic></a:graphicData></a:graphic>` +
    `</wp:inline></w:drawing></w:r></w:p>`;
}

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Microsoft YaHei" w:eastAsia="Microsoft YaHei" w:hAnsi="Microsoft YaHei"/><w:sz w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="360" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="36"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="200" w:after="100"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="160" w:after="80"/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/></w:style>
</w:styles>`;

/**
 * blocks: [{ type:'h', level, text } | { type:'p', text } | { type:'li', ordered, text } | { type:'quote', text } | { type:'hr' }]
 * images: 本地图片绝对路径数组
 * 返回 Buffer；无法内嵌的格式（webp）跳过，并在返回里列出来。
 */
export function buildDocx({ blocks = [], images = [] } = {}) {
  const media = [];
  const skipped = [];
  for (const file of images) {
    const kind = mediaTypeOf(file);
    if (!kind) {
      skipped.push(file);
      continue;
    }
    media.push({ file, name: `image${media.length + 1}.${kind.ext}`, type: kind.type });
  }

  // 图片按段落均分：第 i 张落在第 round((i+1)*blocks/(n+1)) 段之后
  const slots = new Map();
  const count = media.length;
  media.forEach((item, i) => {
    const at = blocks.length ? Math.min(blocks.length, Math.round(((i + 1) * blocks.length) / (count + 1))) : 0;
    if (!slots.has(at)) slots.set(at, []);
    slots.get(at).push(item);
  });

  const body = [];
  let docPrId = 0;
  let orderedIndex = 0;
  const emitImages = (list) => {
    for (const item of list) {
      docPrId += 1;
      body.push(imagePara(`rIdImg${media.indexOf(item) + 1}`, docPrId, item.name));
    }
  };

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const text = String(block.text || "").trim();
    if (block.type === "h") body.push(heading(text, block.level));
    else if (block.type === "li") {
      orderedIndex = block.ordered ? orderedIndex + 1 : 0;
      body.push(bullet(text, orderedIndex, block.ordered));
    } else if (block.type === "quote") body.push(quote(text));
    else if (block.type === "hr") body.push(hr());
    else if (text) body.push(para(text));
    if (slots.has(i + 1)) emitImages(slots.get(i + 1));
  }
  if (slots.has(0)) emitImages(slots.get(0));

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
<w:body>${body.join("")}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="851" w:footer="992" w:gutter="0"/></w:sectPr></w:body>
</w:document>`;

  const exts = [...new Set(media.map((item) => item.name.split(".").pop()))];
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
${exts.map((ext) => `<Default Extension="${ext}" ContentType="${MEDIA_TYPES[ext] || "image/jpeg"}"/>`).join("")}
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rIdDoc" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

  const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
${media.map((item, i) => `<Relationship Id="rIdImg${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${item.name}"/>`).join("")}
</Relationships>`;

  const entries = [
    { name: "[Content_Types].xml", data: contentTypes },
    { name: "_rels/.rels", data: rootRels },
    { name: "word/document.xml", data: documentXml },
    { name: "word/_rels/document.xml.rels", data: docRels },
    { name: "word/styles.xml", data: STYLES_XML },
    ...media.map((item) => ({ name: `word/media/${item.name}`, data: fs.readFileSync(item.file) })),
  ];
  return { buffer: zipStore(entries), media: media.map((item) => item.file), skipped };
}

/** 文件名直接用标题：公众号导入后拿文件名当标题，省得再猜。 */
export function docxFileName(title) {
  const clean = String(title || "article")
    .replace(/[\\/:*?"<>|\r\n\t]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60) || "article";
  return clean + ".docx";
}

/** 落盘到指定目录，返回 { file, media, skipped }。 */
export function writeDocx({ dir, title, blocks, images }) {
  const built = buildDocx({ blocks, images });
  const file = path.join(dir, docxFileName(title));
  fs.writeFileSync(file, built.buffer);
  return { file, media: built.media, skipped: built.skipped, bytes: built.buffer.length };
}
