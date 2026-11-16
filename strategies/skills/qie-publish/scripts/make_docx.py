# -*- coding: utf-8 -*-
"""企鹅号「插入文档」用的 docx 生成器。

用法：
    python make_docx.py <spec.json>

spec.json:
{
  "out": "d:/x/test.docx",
  "title": "文章标题（会被跳过，不写进正文）",
  "body_md": "正文 markdown 全文",
  "article_dir": "文章目录（解析图片相对路径用）"
}

企鹅号只把 docx 的正文导进编辑器，标题一定要单独填标题框，
所以这里遇到和 title 相同的一级标题会跳过，避免正文多一行大标题。
"""

import json
import os
import re
import sys

try:
    from docx import Document
    from docx.shared import Inches, Pt
    from docx.oxml.ns import qn
except ImportError:
    print(json.dumps({"ok": False, "error": "缺少 python-docx：pip install python-docx"}, ensure_ascii=False))
    sys.exit(2)

IMG_EXT = (".jpg", ".jpeg", ".png", ".webp", ".bmp")
MD_IMG = re.compile(r"!\[[^\]]*\]\(([^)]+)\)")
IDX_IMG = re.compile(r"^@@IMG(\d+)@@?$")


def indexed_image(n, base):
    """@@IMG1@@ → 文章目录 images/ 下第 1 张图（按文件名排序）。"""
    for d in (os.path.join(base, "images"), base):
        if not os.path.isdir(d):
            continue
        files = sorted(f for f in os.listdir(d) if f.lower().endswith(IMG_EXT))
        if len(files) >= n:
            return os.path.join(d, files[n - 1])
    return None


def strip_inline(text):
    text = MD_IMG.sub("", text)
    text = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", text)
    text = re.sub(r"(\*\*|__|~~|`)", "", text)
    text = re.sub(r"(^|[^*])\*([^*\n]+)\*", r"\1\2", text)
    text = re.sub(r"(^|[^_\w])_([^_\n]+)_", r"\1\2", text)
    return text.strip()


def resolve_image(raw, base):
    p = raw.strip().strip("<>").split(" ")[0].strip('"').strip("'")
    if not p:
        return None
    cand = p if os.path.isabs(p) else os.path.join(base, p)
    if os.path.isfile(cand) and cand.lower().endswith(IMG_EXT):
        return cand
    # 只给了文件名：在文章目录与 images/ 下找
    name = os.path.basename(p)
    for d in (base, os.path.join(base, "images"), os.path.join(base, "images_bak")):
        cand2 = os.path.join(d, name)
        if os.path.isfile(cand2):
            return cand2
    return None


def build(spec):
    out = spec["out"]
    title = (spec.get("title") or "").strip()
    body = (spec.get("body_md") or "").replace("\r\n", "\n")
    base = spec.get("article_dir") or os.path.dirname(out)

    doc = Document()
    normal = doc.styles["Normal"]
    normal.font.name = "微软雅黑"
    normal.font.size = Pt(12)
    try:
        normal.element.rPr.rFonts.set(qn("w:eastAsia"), "微软雅黑")
    except Exception:
        pass

    blocks = 0
    images = 0
    heading_seen = False
    para_buf = []

    def flush_para():
        nonlocal blocks
        if not para_buf:
            return
        text = " ".join(para_buf).strip()
        para_buf.clear()
        if not text:
            return
        p = doc.add_paragraph(text)
        p.paragraph_format.space_after = Pt(8)
        blocks += 1

    for raw in body.split("\n"):
        line = raw.rstrip()
        stripped = line.strip()

        if not stripped:
            flush_para()
            continue

        # 正文里的图片：@@IMG1@@ / @@IMG path / ![alt](path)
        m = MD_IMG.search(stripped)
        img_path = None
        idx = IDX_IMG.match(stripped)
        if idx:
            img_path = indexed_image(int(idx.group(1)), base)
            if not img_path:
                print("WARN @@IMG%s@@ 找不到对应图片" % idx.group(1), file=sys.stderr)
        elif stripped.startswith("@@IMG"):
            img_path = resolve_image(stripped[5:], base)
        elif m and m.group(0).strip() == stripped:
            img_path = resolve_image(m.group(1), base)
        if img_path:
            flush_para()
            try:
                doc.add_picture(img_path, width=Inches(5.2))
                blocks += 1
                images += 1
            except Exception as exc:  # 图坏了不要毁掉整篇
                doc.add_paragraph("[图片未能插入：%s]" % os.path.basename(img_path))
                print("WARN image failed %s: %s" % (img_path, exc), file=sys.stderr)
            continue

        heading = re.match(r"^(#{1,6})\s+(.+)$", stripped)
        if heading:
            text = strip_inline(heading.group(2))
            if not heading_seen and title and text == title:
                heading_seen = True
                flush_para()
                continue
            heading_seen = True
            flush_para()
            level = min(len(heading.group(1)) + 1, 4)  # # -> H2
            h = doc.add_heading(text, level=level)
            blocks += 1
            continue

        if re.match(r"^([-*_])\1{2,}$", stripped):
            flush_para()
            blocks += 1
            continue

        quote = re.match(r"^>\s?(.*)$", stripped)
        if quote:
            flush_para()
            p = doc.add_paragraph(strip_inline(quote.group(1)))
            p.paragraph_format.left_indent = Inches(0.2)
            blocks += 1
            continue

        ul = re.match(r"^\s*[-*+]\s+(.+)$", line)
        if ul:
            flush_para()
            doc.add_paragraph(strip_inline(ul.group(1)), style="List Bullet")
            blocks += 1
            continue

        ol = re.match(r"^\s*\d+[.)]\s+(.+)$", line)
        if ol:
            flush_para()
            doc.add_paragraph(strip_inline(ol.group(1)), style="List Number")
            blocks += 1
            continue

        para_buf.append(strip_inline(stripped))

    flush_para()

    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    doc.save(out)
    return {"ok": True, "out": out, "blocks": blocks, "images": images}


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"ok": False, "error": "用法：python make_docx.py spec.json"}, ensure_ascii=False))
        sys.exit(2)
    with open(sys.argv[1], "r", encoding="utf-8") as fh:
        spec = json.load(fh)
    try:
        print(json.dumps(build(spec), ensure_ascii=False))
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        sys.exit(1)
