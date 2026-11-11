// 文章目录约定：title.txt / body.md / cover.jpg / images/
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const IMAGE_RE = /\.(jpe?g|png|webp|gif)$/i;

export function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 行内 Markdown → 编辑器认的 HTML。加粗、斜体、删除线、行内代码都转成标签，不漏出 * 和 #。 */
function inlineHtml(text) {
  const slots = [];
  const stash = (html) => "\u0000" + (slots.push(html) - 1) + "\u0000";
  let s = escapeHtml(text);
  s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, ""); // 正文里的图片走 images/ 目录，语法本身不发文
  s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1"); // 外链只留文字，平台会拦外链
  s = s.replace(/`([^`]+)`/g, (_, code) => stash("<code>" + code + "</code>"));
  s = s.replace(/\*\*([^*]+)\*\*/g, (_, t) => stash("<strong>" + t + "</strong>"));
  s = s.replace(/__([^_]+)__/g, (_, t) => stash("<strong>" + t + "</strong>"));
  s = s.replace(/~~([^~]+)~~/g, (_, t) => stash("<del>" + t + "</del>"));
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, (_, pre, t) => pre + stash("<em>" + t + "</em>"));
  s = s.replace(/(^|[^_\w])_([^_\n]+)_/g, (_, pre, t) => pre + stash("<em>" + t + "</em>"));
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => slots[Number(i)]);
}

/**
 * 正文 Markdown → 平台编辑器可用的 HTML。
 * 小标题、加粗、斜体、引用、有序/无序列表、分隔线都渲染成标签；
 * 正文第一行如果又写了一遍标题（# 标题），跳过，避免和标题栏重复。
 */
export function toParagraphHtml(markdown, opts = {}) {
  const title = String(opts.title || "").trim();
  const text = String(markdown || "")
    .replace(/\r\n/g, "\n")
    .replace(/^---[\s\S]*?---\n*/, "")
    .trim();

  const out = [];
  let list = "";
  let para = [];
  let headingConsumed = false;

  const flushPara = () => {
    if (!para.length) return;
    out.push("<p>" + para.join("<br>") + "</p>");
    para = [];
  };
  const closeList = () => {
    if (!list) return;
    out.push("</" + list + ">");
    list = "";
  };
  const block = (html) => {
    flushPara();
    closeList();
    out.push(html);
  };

  for (const raw of text.split("\n")) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) {
      flushPara();
      closeList();
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const body = heading[2].trim();
      const plain = body.replace(/[*_`]/g, "").trim();
      if (!headingConsumed && title && plain === title) {
        headingConsumed = true;
        flushPara();
        closeList();
        continue;
      }
      const level = Math.min(heading[1].length + 1, 4); // # → h2，## → h3
      block("<h" + level + ">" + inlineHtml(body) + "</h" + level + ">");
      continue;
    }

    if (/^([-*_])\1{2,}$/.test(line.trim())) {
      block("<hr>");
      continue;
    }

    const quote = line.match(/^>\s?(.*)$/);
    if (quote) {
      block("<blockquote>" + inlineHtml(quote[1]) + "</blockquote>");
      continue;
    }

    const ul = line.match(/^\s*[-*+]\s+(.+)$/);
    if (ul) {
      flushPara();
      if (list !== "ul") {
        closeList();
        out.push("<ul>");
        list = "ul";
      }
      out.push("<li>" + inlineHtml(ul[1]) + "</li>");
      continue;
    }

    const ol = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (ol) {
      flushPara();
      if (list !== "ol") {
        closeList();
        out.push("<ol>");
        list = "ol";
      }
      out.push("<li>" + inlineHtml(ol[1]) + "</li>");
      continue;
    }

    closeList();
    const inline = inlineHtml(line);
    if (inline.trim()) para.push(inline);
  }

  flushPara();
  closeList();
  return out.join("");
}

function fingerprint(file) {
  const buf = fs.readFileSync(file);
  return crypto.createHash("sha1").update(buf).digest("hex");
}

/** 按文件内容去重。同图复制三份不算三张不同图。 */
export function distinctImages(files) {
  const seen = new Set();
  const out = [];
  for (const file of files) {
    const key = fingerprint(file);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(file);
  }
  return out;
}

export function loadArticle(dir) {
  const root = path.resolve(dir);
  const titleFile = path.join(root, "title.txt");
  const bodyFile = path.join(root, "body.md");
  const cover = path.join(root, "cover.jpg");
  if (!fs.existsSync(titleFile)) throw new Error("文章目录缺少 title.txt");
  if (!fs.existsSync(bodyFile)) throw new Error("文章目录缺少 body.md");
  if (!fs.existsSync(cover)) throw new Error("文章目录缺少 cover.jpg");
  const title = fs.readFileSync(titleFile, "utf8").replace(/^\uFEFF/, "").trim();
  const body = fs.readFileSync(bodyFile, "utf8").replace(/^\uFEFF/, "").trim();
  if (!title) throw new Error("title.txt 是空的");
  if (!body) throw new Error("body.md 是空的");
  // 插图目录：优先 images/，次选 images_bak/（素材备份目录也当正文插图用）
  const imagesDir = ["images", "images_bak"].map((name) => path.join(root, name)).find((p) => fs.existsSync(p)) || "";
  const listed = imagesDir
    ? fs.readdirSync(imagesDir)
        .filter((name) => IMAGE_RE.test(name))
        .sort((a, b) => a.localeCompare(b, "en"))
        .map((name) => path.join(imagesDir, name))
    : [];
  const images = distinctImages(listed);
  return {
    dir: root,
    title,
    body,
    bodyHtml: toParagraphHtml(body, { title }),
    cover,
    images,
    droppedDuplicates: listed.length - images.length,
  };
}
