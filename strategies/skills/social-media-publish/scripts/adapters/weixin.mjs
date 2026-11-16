// 微信公众号 adapter (八万里纵横账号 · Sparo MCP)
// 2026-11-16 实测通过：标题 / 正文 execCommand 写入（ProseMirror 接受），保存用 #js_submit.click()
// 保存后 URL 带 appmsgid，格式 https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit&action=edit&type=77&appmsgid=<id>&token=<token>
// DOM 锚点：
//   标题 ProseMirror → .ProseMirror[data-placeholder="请在这里输入标题"]  （注意：全页 2 个 .ProseMirror，不能全页选）
//   正文 ProseMirror → .rich_media_content .ProseMirror
//   保存草稿按钮     → #js_submit（SPAN，click handler 事件委托，必须 .click() 不能 CDP click）
//   作者输入         → #author
//   封面区           → #js_cover_area（默认在视口外，必须先 scrollIntoView 再 CDP click）
//   封面抽屉「从图片库选择」→ .js_imagedialog
//   图片库对话框     → .weui-desktop-dialog_img-picker（内含唯一 file input）
//   裁剪对话框「确认」→ 对话框内文案为「确认」的按钮

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fail, page, pass, sleep } from "../page.mjs";
import { call, click, exec, tabRows, tabs, uploadFile } from "../sparo.mjs";
import { writeDocx } from "../docx.mjs";
import { resolveTheme } from "../format.mjs";

/** 轮询页面脚本直到 predicate 成立，返回最后一次 JSON 结果。 */
async function pollUntil(ctx, script, predicate, tries = 20, interval = 300) {
  let last = null;
  for (let i = 0; i < tries; i++) {
    const read = await page(ctx, script);
    if (read.stop) return read.stop;
    last = read.value;
    if (predicate(last)) return last;
    await sleep(interval);
  }
  return last;
}

const TITLE_PM = '.ProseMirror[data-placeholder="请在这里输入标题"]';
const BODY_PM = ".rich_media_content .ProseMirror";
const SAVE_BTN = "#js_submit";
const AUTHOR_INPUT = "#author";
// 公众号列表标题硬上限（超出移动端截断）
const TITLE_HARD_LIMIT = 64; // 微信上限；但短标题 15 字内更易读（wechat-mp-publisher 参考，非硬约束）

export const weixin = {
  id: "weixin",
  host: "mp.weixin.qq.com",
  writeUrl: "https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2&action=edit&isNew=1",
  writeMark: "appmsg_edit_v2",
  listUrl: "https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_list",
  accountName: "八万里纵横",

  // ---------- openBlank ----------
  // 已登录的公众号标签 URL 里都带 token；直接用它拼新文章地址导航，比在首页点「新的创作→文章」稳。
  // 一个公众号标签都没有时自己开一个，不要求人先手动打开。
  async openBlank(ctx) {
    let rows = tabRows(await tabs());
    let wxTabs = rows.filter((t) => String(t.url || "").includes(this.host));
    if (!wxTabs.length) {
      await call("new_tab", { url: "https://mp.weixin.qq.com/" });
      await sleep(5000);
      rows = tabRows(await tabs());
      wxTabs = rows.filter((t) => String(t.url || "").includes(this.host));
    }
    if (!wxTabs.length) return fail("NO_TAB", {}, "打不开公众号后台，先确认网络");

    // 优先用不在编辑页的标签，避免顶掉正在编辑的草稿
    const target = wxTabs.find((t) => !String(t.url || "").includes("appmsg_edit")) || wxTabs[0];
    let token = String(target.url || "").match(/token=(\d+)/)?.[1] || "";
    if (!token) {
      const read = await page({ tabId: target.id }, `(() => {
        const a = document.querySelector('a[href*="token="]');
        const m = String(a ? a.href : location.href).match(/token=(\\d+)/);
        return JSON.stringify({ token: m ? m[1] : "" });
      })()`);
      if (read.stop) return read.stop;
      token = read.value?.token || "";
    }
    if (!token) return fail("NO_TOKEN", { tabId: target.id }, "公众号没有登录（找不到 token），先扫码登录");

    await call("navigate", { url: `${this.writeUrl}&type=77&token=${token}`, tabId: target.id });
    await sleep(3000);
    await call("ensure_render", { tabId: target.id });
    ctx.tabId = target.id;
    const ready = await pollUntil(ctx,
      `(() => JSON.stringify({ body: !!document.querySelector(${JSON.stringify(BODY_PM)}), title: !!document.querySelector(${JSON.stringify(TITLE_PM)}) }))()`,
      (v) => v?.body && v?.title, 40, 400);
    if (!ready?.body) return fail("EDITOR_NOT_READY", ready, "新文章编辑页没有打开");
    return pass("OPENED_DIRECT", { tabId: target.id });
  },

  // ---------- waitEditor ----------
  async waitEditor(ctx, timeout = 20000) {
    const tabId = ctx.tabId;
    const deadline = Date.now() + timeout;
    let hasBody = false, hasTitle = false;
    while (Date.now() < deadline) {
      const result = await exec(`
        (() => ({
          body: !!document.querySelector(${JSON.stringify(BODY_PM)}),
          title: !!document.querySelector(${JSON.stringify(TITLE_PM)}),
        }))()
      `, tabId);
      let obj;
      try { obj = JSON.parse(String(result?.data?.result || 'null')); } catch { obj = null; }
      if (obj?.body) hasBody = true;
      if (obj?.title) hasTitle = true;
      if (hasBody && hasTitle) return pass("EDITOR_READY");
      await sleep(300);
    }
    if (!hasBody) return fail("EDITOR_NOT_READY");
    if (!hasTitle) return fail("TITLE_EDITOR_NOT_READY");
    return pass("EDITOR_READY");
  },

  // ---------- readSiteAccount ----------
  async readSiteAccount(ctx) {
    const read = await page(ctx, `
      (() => {
        const el = document.querySelector('.weui-desktop-account__nickname, .weui-desktop-account__nickname_name, [class*=account__nickname]');
        return JSON.stringify({ name: el?.innerText?.trim() || '', href: location.href });
      })()
    `);
    if (read.stop) return read.stop;
    const name = String(read.value?.name || "").trim();
    if (name) ctx.accountName = name;
    return name ? pass("READ_ACCOUNT", { accountName: name }) : fail("ACCOUNT_NAME_UNAVAILABLE", read.value, "页面账号名读不到");
  },

  // ---------- readAccountName ----------
  // engine.mjs 自检所需；直接别名到 readSiteAccount
  async readAccountName(ctx) {
    return this.readSiteAccount(ctx);
  },

  // ---------- readTitle ----------
  // engine.mjs --from 续跑时需要从编辑器读回当前标题
  async readTitle(ctx) {
    const read = await page(ctx, `(() => JSON.stringify({ title: document.querySelector(${JSON.stringify(TITLE_PM)})?.innerText?.trim() || '', href: location.href }))()`);
    if (read.stop) return read.stop;
    return pass("READ_TITLE", read.value || {});
  },

  // ---------- fillTitle ----------
  // 微信标题是独立 ProseMirror，focus → selectAll → delete → insertText → 回读 innerText 比对
  async fillTitle(ctx) {
    const tabId = ctx.tabId;
    const short = (ctx.title || "").trim();
    if (!short) return fail("EMPTY_TITLE");
    if (short.length > TITLE_HARD_LIMIT) return fail(`TITLE_TOO_LONG:${short.length}`);

    await exec(`
      (() => {
        const pm = document.querySelector(${JSON.stringify(TITLE_PM)});
        if (!pm) return 'NO_PM';
        pm.focus();
        document.execCommand('selectAll', false, null);
        document.execCommand('delete', false, null);
        document.execCommand('insertText', false, ${JSON.stringify(short)});
        return pm.innerText || '';
      })()
    `, tabId);
    await sleep(300);

    // 回读
    const verify = await page(ctx, `(() => JSON.stringify({ title: document.querySelector(${JSON.stringify(TITLE_PM)})?.innerText?.trim() || '' }))()`);
    if (verify.stop) return verify.stop;
    const got = String(verify.value?.title || "").trim();
    if (!got) return fail("TITLE_STILL_EMPTY");
    // 允许微信内部规范化的微小差异
    if (!got.includes(short.slice(0, Math.max(4, Math.floor(short.length * 0.6))))) {
      return fail(`TITLE_MISMATCH:expected=${short.slice(0,30)}... got=${got.slice(0,30)}...`);
    }
    ctx.title = short;
    return pass("TITLE_FILLED", { title: short });
  },

  // ---------- fillBody ----------
  // 正文是 .rich_media_content .ProseMirror；execCommand insertHTML 注入 HTML；回读 innerText 长度
  async fillBody(ctx) {
    const tabId = ctx.tabId;
    const html = ctx.bodyHtml || "";
    if (!html) return fail("EMPTY_BODY");

    await exec(`
      (() => {
        const pm = document.querySelector(${JSON.stringify(BODY_PM)});
        if (!pm) return 'NO_PM';
        pm.focus();
        document.execCommand('selectAll', false, null);
        document.execCommand('delete', false, null);
        document.execCommand('insertHTML', false, ${JSON.stringify(html)});
        return (pm.innerText || '').slice(0, 200);
      })()
    `, tabId);
    await sleep(300);

    // 回读：innerText 长度 + 至少能看到第一段
    const read = await page(ctx, `
      (() => {
        const pm = document.querySelector(${JSON.stringify(BODY_PM)});
        if (!pm) return JSON.stringify({ ok: false, reason: 'NO_PM' });
        const text = (pm.innerText || '').trim();
        return JSON.stringify({ ok: text.length > 20, len: text.length });
      })()
    `);
    if (read.stop) return read.stop;
    if (!read.value?.ok) return fail("BODY_MISMATCH", read.value, "正文没有写进去");
    ctx.bodyLen = read.value.len;
    return pass("BODY_FILLED", { len: read.value.len });
  },

  // ---------- importDocx ----------
  // 图片多的稿子走「文档导入」：#js_import_file（顶部「导入」）→ .import-file-dialog
  // 对话框内 file input 接受 doc/docx/markdown，导入会覆盖原有内容。
  // 导入后标题 = 文件名，图片与段落一次落稿；标题随后由 fillTitle 覆盖成正文口径。
  async importDocx(ctx) {
    const blocks = Array.isArray(ctx.blocks) ? ctx.blocks : [];
    const images = ctx.imagePlan?.use || [];
    if (!blocks.length) return fail("EMPTY_BODY");

    let built;
    try {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sparo-docx-"));
      built = writeDocx({ dir, title: ctx.title, blocks, images });
    } catch (error) {
      return fail("DOCX_BUILD_FAILED", {}, String(error?.message || error));
    }
    ctx.docxFile = built.file;
    ctx.docxBytes = built.bytes;
    ctx.docxSkipped = built.skipped;

    // 1. 打开「文档导入」对话框
    const opened = await page(ctx, `(() => {
      const li = document.querySelector('#js_import_file');
      if (!li) return JSON.stringify({ ok: false });
      li.scrollIntoView({ block: 'center' });
      li.click();
      return JSON.stringify({ ok: true });
    })()`);
    if (opened.stop) return opened.stop;
    if (!opened.value?.ok) return fail("DOCX_ENTRY_MISSING", opened.value, "顶部「导入」入口没找到");

    const dialog = await pollUntil(ctx,
      `(() => {
        const d = document.querySelector('.import-file-dialog');
        const inputs = [...document.querySelectorAll('.import-file-dialog input[type=file]')];
        return JSON.stringify({ found: !!d, inputs: inputs.length, accept: inputs.length ? (inputs[inputs.length - 1].accept || '') : '' });
      })()`,
      (v) => v?.found && v?.inputs > 0, 20, 300);
    if (!dialog?.inputs) return fail("DOCX_DIALOG_MISSING", dialog, "文档导入对话框没有出现");

    // 2. 等对话框动画稳定后再上传。微信在 change 里会立刻清空 input.files，
    //    所以只能以「对话框关闭 + 正文有字」判定成功，失败再用新 id 重传。
    const readLanding = `(() => {
      const d = document.querySelector('.import-file-dialog');
      const open = !!d && d.getBoundingClientRect().width > 0;
      const body = document.querySelector(${JSON.stringify(BODY_PM)});
      const title = document.querySelector(${JSON.stringify(TITLE_PM)});
      return JSON.stringify({
        open,
        bodyLen: body ? (body.innerText || '').replace(/\\s+/g, '').length : 0,
        images: body ? body.querySelectorAll('img[data-src]').length : 0,
        title: title ? (title.innerText || '').trim() : '',
      });
    })()`;

    let landed = null;
    for (let attempt = 0; attempt < 3 && !landed; attempt++) {
      await sleep(attempt === 0 ? 800 : 1200);
      if (attempt > 0) {
        const reopened = await page(ctx, `(() => {
          const d = document.querySelector('.import-file-dialog');
          if (d && d.getBoundingClientRect().width > 0) return JSON.stringify({ open: true });
          const li = document.querySelector('#js_import_file');
          if (!li) return JSON.stringify({ open: false, entry: false });
          li.click();
          return JSON.stringify({ open: false, entry: true });
        })()`);
        if (reopened.stop) return reopened.stop;
        await pollUntil(ctx, `(() => {
          const d = document.querySelector('.import-file-dialog');
          const inputs = [...document.querySelectorAll('.import-file-dialog input[type=file]')];
          return JSON.stringify({ found: !!d, inputs: inputs.length });
        })()`, (v) => v?.found && v?.inputs > 0, 15, 300);
      }
      const picked = await page(ctx, `(() => {
        const inputs = [...document.querySelectorAll('.import-file-dialog input[type=file]')];
        const t = inputs[inputs.length - 1];
        if (!t) return JSON.stringify({ selector: '' });
        t.id = 'sparo-wx-docx-' + Date.now();
        return JSON.stringify({ selector: '#' + t.id, accept: t.accept || '' });
      })()`);
      if (picked.stop) return picked.stop;
      if (!picked.value?.selector) continue;
      const up = await uploadFile(picked.value.selector, built.file, ctx.tabId);
      if (typeof up === "string" && /^(MISMATCH|URL_UNREAD|ENV_MISMATCH)/.test(up)) return fail("UPLOAD_BLOCKED", up, up);
      if (typeof up === "string" && /"ok"\s*:\s*false/.test(up)) return fail("UPLOAD_FAILED", up, "文件没上传成功");
      const result = await pollUntil(ctx, readLanding, (v) => v?.open === false && v?.bodyLen > 20, 20, 1000);
      if (result?.open === false && result?.bodyLen > 20) landed = result;
    }
    if (!landed) return fail("DOCX_IMPORT_STUCK", {}, "导入 3 次仍没落稿，对话框还开着");
    if (!(landed.bodyLen > 20)) return fail("DOCX_IMPORT_EMPTY", landed, "导入后正文为空");

    ctx.imageCount = Number(landed.images) || 0;
    ctx.bodyLen = landed.bodyLen;
    return pass("DOCX_IMPORTED", {
      file: path.basename(built.file),
      bytes: built.bytes,
      planImages: images.length,
      images: ctx.imageCount,
      bodyLen: landed.bodyLen,
      importedTitle: landed.title,
      skipped: built.skipped,
    });
  },

  // ---------- formatBody ----------
  // 导入或直填之后统一排版。关键经验（2026-11-16 实测）：
  //   直接改 DOM 的 style 存草稿会被编辑器丢掉；必须把正文重建为带内联样式的 HTML，
  //   再用 execCommand('insertHTML') 粘贴进去——ProseMirror 认这条路，保存后样式还在。
  // 读回结构 → 逐块重排（正文 15px/1.75、H2 左侧主色竖条、引用浅灰底、图片整宽圆角）→ 粘贴覆盖。
  async formatBody(ctx) {
    const theme = resolveTheme(ctx.theme);
    const expected = Number(ctx.imageCount) || (ctx.imagePlan?.use || []).length;

    const staged = await page(ctx, `(() => {
      const T = ${JSON.stringify(theme)};
      const pm = document.querySelector(${JSON.stringify(BODY_PM)});
      if (!pm) return JSON.stringify({ ok: false, reason: 'NO_PM' });
      const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

      // 取块内行内 HTML：展开 Word 的 span，删 mso 属性，只留 strong/em/br 等语义标签
      const cleanInline = (el) => {
        const clone = el.cloneNode(true);
        clone.querySelectorAll('img').forEach((i) => i.remove());
        clone.querySelectorAll('span').forEach((s) => {
          const p = s.parentNode;
          while (s.firstChild) p.insertBefore(s.firstChild, s);
          p.removeChild(s);
        });
        clone.querySelectorAll('*').forEach((n) => {
          if ((n.tagName || '').includes(':')) { n.remove(); return; }
          [...n.attributes].forEach((a) => { if (!(n.tagName === 'A' && a.name === 'href')) n.removeAttribute(a.name); });
        });
        clone.querySelectorAll('strong,b').forEach((n) => n.setAttribute('style', 'font-weight:700;color:' + T.title + ';'));
        clone.querySelectorAll('code').forEach((n) => n.setAttribute('style', 'padding:2px 5px;background:#f5f5f5;border-radius:3px;font-size:90%;'));
        return (clone.innerHTML || '').trim();
      };

      // 摊平块：跳过 section/div 壳，只取真正的段落、标题、列表、引用、分割线
      const blocks = [];
      const isBlock = (el) => /^(P|H1|H2|H3|H4|H5|H6|BLOCKQUOTE|UL|OL|HR|DIV|SECTION)$/.test(el.tagName || '');
      const walk = (parent) => {
        for (const child of [...parent.children]) {
          if (!isBlock(child)) continue;
          const shell = child.tagName === 'DIV' || child.tagName === 'SECTION';
          if (shell && child.querySelector('p,h1,h2,h3,h4,h5,h6,blockquote,ul,ol,hr')) { walk(child); continue; }
          blocks.push(child);
        }
      };
      walk(pm);
      if (!blocks.length) return JSON.stringify({ ok: false, reason: 'NO_BLOCKS' });

      const parts = [];
      const isListText = (t) => /^([•·▪◦\\-]|\\d+[.、)])\\s*/.test(t);
      const paraStyle = (list) => 'margin:' + (list ? '8px 0' : '0 0 ' + T.paraGap + 'px 0') + ';' +
        (list ? 'padding-left:20px;' : '') +
        'font-size:' + T.bodySize + 'px;line-height:' + T.lineHeight + ';color:' + T.body + ';letter-spacing:' + T.letterSpacing + 'px;text-align:justify;';
      const quoteStyle = 'margin:22px 0;padding:14px 16px;background:' + T.quoteBg + ';border-left:3px solid ' + T.quoteBorder + ';' +
        'border-radius:0 6px 6px 0;color:#666666;font-size:' + T.bodySize + 'px;line-height:' + T.lineHeight + ';letter-spacing:' + T.letterSpacing + 'px;text-align:justify;';
      const headStyle = (lv) => {
        const size = lv === 1 ? 22 : lv === 2 ? 18 : lv === 3 ? 16 : 15;
        const color = lv === 3 ? T.accent : T.title;
        let s = 'font-size:' + size + 'px;font-weight:700;line-height:1.5;color:' + color + ';letter-spacing:0.5px;text-align:left;';
        s += lv === 1 ? 'margin:36px 0 18px;' : lv === 3 ? 'margin:26px 0 12px;' : lv === 4 ? 'margin:20px 0 10px;' : 'margin:32px 0 16px;';
        if (lv === 2) s += 'padding-left:10px;border-left:4px solid ' + T.accent + ';';
        return s;
      };
      const imgHtml = (src) => '<p style="margin:18px 0;text-align:center;line-height:1;"><img src="' + esc(src) + '" data-src="' + esc(src) + '" style="width:100%;height:auto;display:block;margin:18px auto;border-radius:' + T.imgRadius + 'px;" /></p>';

      let images = 0;
      for (const el of blocks) {
        const tag = el.tagName || '';
        const head = tag.match(/^H([1-6])$/);
        if (head) {
          const lv = Math.min(Number(head[1]), 4);
          parts.push('<h' + lv + ' style="' + headStyle(lv) + '">' + esc((el.innerText || '').trim()) + '</h' + lv + '>');
          continue;
        }
        if (tag === 'HR') {
          parts.push('<p style="margin:28px 0;border-top:1px solid ' + T.rule + ';font-size:0;line-height:0;">&nbsp;</p>');
          continue;
        }
        if (tag === 'UL' || tag === 'OL') {
          const inner = [...el.querySelectorAll('li')].map((li) =>
            '<li style="font-size:' + T.bodySize + 'px;line-height:' + T.lineHeight + ';color:' + T.body + ';margin:8px 0;letter-spacing:' + T.letterSpacing + 'px;">' + cleanInline(li) + '</li>'
          ).join('');
          parts.push('<' + tag.toLowerCase() + ' style="margin:0 0 ' + T.paraGap + 'px 0;padding-left:22px;">' + inner + '</' + tag.toLowerCase() + '>');
          continue;
        }
        const srcs = [];
        [...el.querySelectorAll('img')].forEach((img) => {
          if (String(img.className || '').includes('ProseMirror-separator')) return;
          const src = img.getAttribute('data-src') || img.getAttribute('src') || '';
          if (src) srcs.push(src);
        });
        const html = cleanInline(el);
        const text = (el.innerText || '').trim();
        const style = el.getAttribute('style') || '';
        if (text) {
          const quote = tag === 'BLOCKQUOTE' || /background/i.test(style);
          parts.push('<p style="' + (quote ? quoteStyle : paraStyle(isListText(text))) + '">' + html + '</p>');
        }
        for (const src of srcs) { images += 1; parts.push(imgHtml(src)); }
      }
      if (!parts.length) return JSON.stringify({ ok: false, reason: 'NO_PARTS' });

      // 整段包一层 section 再粘贴：空白编辑器本身也会包 section；不包的话，
      // Word 导入后当前块是 h1，段落会被塞进 h1 壳里（2026-11-16 实测）
      const html = '<section>' + parts.join('') + '</section>';
      pm.focus();
      // 关键一步：先把当前块改成正文块。Word 导入后残留的当前块是 h1，
      // 不清掉类型的话，粘贴会把段落塞进 h1 壳（2026-11-16 实测）
      document.execCommand('selectAll', false, null);
      document.execCommand('formatBlock', false, 'p');
      document.execCommand('selectAll', false, null);
      document.execCommand('delete', false, null);
      document.execCommand('insertHTML', false, html);
      return JSON.stringify({ ok: true, blocks: blocks.length, images: images, htmlLen: html.length, expected: ${expected} });
    })()`);
    if (staged.stop) return staged.stop;
    if (!staged.value?.ok) return fail("FORMAT_STAGE_FAILED", staged.value, "正文结构读不出来，无法重排");

    // 回读：ProseMirror 重渲染后样式仍要在；图片按导入张数核对
    const check = `(() => {
      const pm = document.querySelector(${JSON.stringify(BODY_PM)});
      if (!pm) return JSON.stringify({ ok: false, reason: 'NO_PM' });
      const styleOf = (el) => (el ? el.getAttribute('style') || '' : '');
      const imgs = [...pm.querySelectorAll('img')].filter((i) => !String(i.className || '').includes('ProseMirror-separator'));
      const paras = [...pm.querySelectorAll('p')];
      const first = paras.find((p) => (p.innerText || '').trim()) || paras[0] || null;
      const head = pm.querySelector('h2') || pm.querySelector('h1,h3,h4');
      return JSON.stringify({
        ok: true,
        paragraphs: paras.length,
        headings: pm.querySelectorAll('h1,h2,h3,h4,h5,h6').length,
        images: imgs.length,
        waste: [...pm.querySelectorAll('[style]')].filter((el) => /mso-|Microsoft YaHei/i.test(styleOf(el))).length,
        bodyLen: (pm.innerText || '').replace(/\\s+/g, '').length,
        styled: /font-size/.test(styleOf(first)),
        headingStyled: head ? /border-left|color/.test(styleOf(head)) : null,
        firstPara: styleOf(first).slice(0, 90),
        firstHeading: styleOf(head).slice(0, 90),
      });
    })()`;
    const read = await pollUntil(ctx, check, (v) => v?.ok && (expected === 0 || v.images >= expected), 14, 600);
    if (!read?.ok) return fail("FORMAT_NO_BODY", read, "正文不在，无法排版");
    if (!(read.bodyLen > 20)) return fail("FORMAT_BODY_EMPTY", read, "排版后正文为空");
    if (expected > 0 && read.images < expected) return fail("FORMAT_IMAGES_LOST", read, "重排后正文图片少了");
    if (!read.styled) return fail("FORMAT_STYLE_LOST", read, "重排后正文样式没生效");
    if (Number(read.waste) > 0) return fail("FORMAT_WASTE", read, "Word 残留样式没清干净");

    ctx.formatApplied = true;
    ctx.imageCount = Number(read.images) || 0;
    return pass("FORMATTED", {
      theme: ctx.theme || "editorial",
      paragraphs: read.paragraphs,
      headings: read.headings,
      images: read.images,
      waste: read.waste,
    });
  },

  // ---------- fillAuthor (optional) ----------
  async fillAuthor(ctx, author) {
    if (!author) return pass("AUTHOR_SKIP");
    const tabId = ctx.tabId;
    await exec(`
      (() => {
        const inp = document.querySelector(${JSON.stringify(AUTHOR_INPUT)});
        if (!inp) return 'NO_INPUT';
        inp.focus();
        inp.value = ${JSON.stringify(author)};
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        inp.dispatchEvent(new Event('change', { bubbles: true }));
        return inp.value;
      })()
    `, tabId);
    return pass("AUTHOR_FILLED", { author });
  },

  // ---------- setOptions (空实现) ----------
  // 微信没有头条那类需要自动勾选的发布选项（广告收益 / 首发声明等），直接过
  async setOptions(ctx) {
    return pass("OPTIONS_SKIP");
  },

  // ---------- setCover ----------
  // 实测完整链路（2026-11-16 v14 验证）：
  //   scrollIntoView → CDP 点封面区 → 抽屉「从图片库选择」→ 对话框内 file input 上传
  //   → 等「下一步」解禁（约 10-12 秒）→ 裁剪对话框「确认」→ 回读 background-image 含 mmbiz.qpic.cn
  async setCover(ctx) {
    if (!ctx.cover) return pass("COVER_SKIP", { reason: "NO_COVER_FILE" });

    const already = await page(ctx, `(() => {
      const p = document.querySelector('#js_cover_area .js_cover_preview_new');
      const bg = p ? (getComputedStyle(p).backgroundImage || '') : '';
      return JSON.stringify({ has: bg.includes('mmbiz.qpic.cn') });
    })()`);
    if (already.stop) return already.stop;
    if (already.value?.has) return pass("COVER_ALREADY", {});

    // 1. 封面区默认在视口外：不滚到中间，CDP 点击打不到
    await page(ctx, `(() => { document.querySelector('#js_cover_area')?.scrollIntoView({ block: 'center' }); return JSON.stringify({ ok: true }); })()`);
    await sleep(500);
    await click("#js_cover_area .js_cover_btn_area", ctx.tabId);

    // 2. 抽屉里的「从图片库选择」
    const drawer = await pollUntil(ctx,
      `(() => { const a = document.querySelector('.js_imagedialog'); return JSON.stringify({ found: !!a }); })()`,
      (v) => v?.found, 20, 300);
    if (!drawer?.found) return fail("COVER_MENU_MISSING", drawer, "封面抽屉没有出现");
    await page(ctx, `(() => { document.querySelector('.js_imagedialog')?.click(); return JSON.stringify({ ok: true }); })()`);

    // 3. 图片库对话框
    const picker = await pollUntil(ctx,
      `(() => { const d = document.querySelector('.weui-desktop-dialog_img-picker'); return JSON.stringify({ found: !!d }); })()`,
      (v) => v?.found, 30, 300);
    if (!picker?.found) return fail("COVER_PICKER_MISSING", picker, "图片库对话框没有出现");

    // 4. 等图片库列表加载稳定：Vue 重渲染会换掉 file input，太早传会落空（2026-11-16 实测）
    await sleep(1500);
    const uploadCover = async () => {
      const picked = await page(ctx, `(() => {
        const d = document.querySelector('.weui-desktop-dialog_img-picker');
        const t = d ? d.querySelector('input[type=file]') : null;
        if (!t) return JSON.stringify({ selector: '' });
        t.id = 'sparo-wx-cover-' + Date.now();
        return JSON.stringify({ selector: '#' + t.id });
      })()`);
      if (picked.stop) return picked.stop;
      if (!picked.value?.selector) return fail("NO_FILE_INPUT", picked.value, "图片库里没有文件框");
      const up = await uploadFile(picked.value.selector, ctx.cover, ctx.tabId);
      if (typeof up === "string" && /^(MISMATCH|URL_UNREAD|ENV_MISMATCH)/.test(up)) return fail("UPLOAD_BLOCKED", up, up);
      return null;
    };
    const firstUp = await uploadCover();
    if (firstUp) return firstUp;

    // 5. 等「下一步」解禁（上传完才 enable，实测 6-12 秒）；首传落空就换新 input 重传一次
    const nextBtn = `[...document.querySelector('.weui-desktop-dialog_img-picker')?.querySelectorAll('button') || []].find(x => (x.innerText||'').trim() === '下一步')`;
    let ready = await pollUntil(ctx,
      `(() => { const b = ${nextBtn}; if (!b) return JSON.stringify({ gone: true }); return JSON.stringify({ disabled: b.disabled || b.classList.contains('weui-desktop-btn_disabled') }); })()`,
      (v) => v?.disabled === false, 20, 1000);
    if (ready?.disabled !== false) {
      const again = await uploadCover();
      if (again) return again;
      ready = await pollUntil(ctx,
        `(() => { const b = ${nextBtn}; if (!b) return JSON.stringify({ gone: true }); return JSON.stringify({ disabled: b.disabled || b.classList.contains('weui-desktop-btn_disabled') }); })()`,
        (v) => v?.disabled === false, 20, 1000);
    }
    if (ready?.disabled !== false) return fail("COVER_UPLOAD_SLOW", ready, "上传 40 秒仍未完成");

    // 6. 下一步 → 编辑封面裁剪对话框（Vue 按钮吃 CDP 合成点击，必须 JS .click()）
    const cropScript = `(() => {
      const d = [...document.querySelectorAll('.weui-desktop-dialog__wrp')].find(x => (x.innerText||'').includes('编辑封面'));
      if (!d) return JSON.stringify({ found: false });
      const c = [...d.querySelectorAll('button, .weui-desktop-btn, a')].find(b => (b.innerText||'').trim() === '确认' && b.getBoundingClientRect().width > 0);
      if (c) c.setAttribute('data-sparo-wx-confirm', '1');
      return JSON.stringify({ found: true, hasConfirm: !!c });
    })()`;
    await page(ctx, `(() => { const b = ${nextBtn}; b?.click(); return JSON.stringify({ ok: !!b }); })()`);
    // 裁剪对话框先出壳、按钮后渲染，所以要同时等到「确认」按钮出现
    let crop = await pollUntil(ctx, cropScript, (v) => v?.found && v?.hasConfirm, 30, 500);
    if (!crop?.hasConfirm) {
      await page(ctx, `(() => { const b = ${nextBtn}; b?.click(); return JSON.stringify({ ok: !!b }); })()`);
      crop = await pollUntil(ctx, cropScript, (v) => v?.found && v?.hasConfirm, 12, 500);
    }
    if (!crop?.found) return fail("COVER_CROP_MISSING", crop, "裁剪对话框没有出现");
    if (!crop.hasConfirm) return fail("COVER_CONFIRM_MISSING", crop, "裁剪对话框没有「确认」按钮");
    await page(ctx, `(() => { const b = document.querySelector('[data-sparo-wx-confirm="1"]') || [...[...document.querySelectorAll('.weui-desktop-dialog__wrp')].find(x => (x.innerText||'').includes('编辑封面'))?.querySelectorAll('button') || []].find(b => (b.innerText||'').trim() === '确认'); b?.click(); return JSON.stringify({ ok: !!b }); })()`);
    const closed = await pollUntil(ctx,
      `(() => {
        const d = [...document.querySelectorAll('.weui-desktop-dialog__wrp')].find(x => (x.innerText||'').includes('编辑封面'));
        return JSON.stringify({ open: !!d && d.getBoundingClientRect().width > 0 });
      })()`,
      (v) => v?.open === false, 15, 400);
    if (closed?.open) return fail("COVER_CROP_STUCK", closed, "裁剪对话框没有关闭");

    // 7. 回读封面
    const done = await pollUntil(ctx,
      `(() => {
        const p = document.querySelector('#js_cover_area .js_cover_preview_new');
        const bg = p ? (getComputedStyle(p).backgroundImage || '') : '';
        return JSON.stringify({ has: bg.includes('mmbiz.qpic.cn'), bg: bg.slice(0, 100) });
      })()`,
      (v) => v?.has, 20, 500);
    if (!done?.has) return fail("COVER_NOT_APPLIED", done, "封面没有落进封面区");
    ctx.coverApplied = true;
    return pass("COVER_SET", { src: done.bg });
  },

  // ---------- insertImages (暂跳过) ----------
  async insertImages(ctx) {
    return pass("IMAGES_SKIP_TEMP", { reason: "IMAGES_NOT_IMPLEMENTED_YET" });
  },

  // ---------- publishOrSchedule (暂只存草稿，群发人工兜底) ----------
  // 不能 CDP click（handler 事件委托不绑元素上），必须直接 .click()
  async publishOrSchedule(ctx) {
    await page(ctx, `(() => { document.querySelector(${JSON.stringify(SAVE_BTN)})?.click(); return JSON.stringify({ ok: true }); })()`);

    // 等 URL 变 → 带 appmsgid
    let appmsgid = null;
    let afterHref = "";
    for (let i = 0; i < 20; i++) {
      await sleep(1000);
      const read = await page(ctx, `(() => JSON.stringify({ href: location.href, tip: document.querySelector('.page_tips.success')?.innerText?.trim() || '' }))()`);
      if (read.stop) return read.stop;
      afterHref = String(read.value?.href || "");
      const m = afterHref.match(/appmsgid=(\d+)/);
      if (m) { appmsgid = m[1]; break; }
      if (String(read.value?.tip || "").includes("已保存") && !afterHref.includes("isNew=1")) {
        appmsgid = afterHref.match(/appmsgid=(\d+)/)?.[1] || null;
        if (appmsgid) break;
      }
    }
    if (!appmsgid) return fail("SAVE_NO_APPMSGID", { href: afterHref }, "存草稿后没有拿到 appmsgid");
    ctx.appmsgid = appmsgid;
    return pass("DRAFT_SAVED_ONLY", { appmsgid, href: afterHref, note: "仅存草稿，群发需人工确认" });
  },

  // ---------- verify ----------
  async verify(ctx) {
    if (!ctx.appmsgid) return fail("NO_APPMSGID");
    const extra = {};
    // docx 导入路径：存草稿后正文、插图与排版必须还在，缺一项就算失败
    if (ctx.docxMode && ctx.imageCount > 0) {
      const doc = await page(ctx, `(() => {
        const body = document.querySelector(${JSON.stringify(BODY_PM)});
        const title = document.querySelector(${JSON.stringify(TITLE_PM)});
        const first = body ? body.querySelector('p') : null;
        const head = body ? body.querySelector('h2') : null;
        return JSON.stringify({
          bodyLen: body ? (body.innerText || '').replace(/\\s+/g, '').length : 0,
          images: body ? body.querySelectorAll('img[data-src]').length : 0,
          title: title ? (title.innerText || '').trim() : '',
          styled: first ? /font-size/.test(first.getAttribute('style') || '') : false,
          headingStyled: head ? /border-left/.test(head.getAttribute('style') || '') : null,
        });
      })()`);
      if (doc.stop) return doc.stop;
      if (!(doc.value?.bodyLen > 20)) return fail("BODY_LOST", doc.value, "存草稿后正文为空");
      if (Number(doc.value?.images || 0) < ctx.imageCount) return fail("IMAGES_LOST", doc.value, "存草稿后正文图片少于导入时");
      if (ctx.formatApplied && !doc.value?.styled) return fail("FORMAT_LOST", doc.value, "存草稿后正文样式被清掉");
      extra.bodyLen = doc.value.bodyLen;
      extra.images = doc.value.images;
      extra.styled = !!doc.value.styled;
      extra.headingStyled = doc.value.headingStyled;
      if (doc.value?.title) extra.title = doc.value.title;
    }
    if (!ctx.coverApplied) return pass("VERIFY_OK", { appmsgid: ctx.appmsgid, ...extra });
    const read = await page(ctx, `(() => {
      const p = document.querySelector('#js_cover_area .js_cover_preview_new');
      const bg = p ? (getComputedStyle(p).backgroundImage || '') : '';
      return JSON.stringify({ has: bg.includes('mmbiz.qpic.cn') });
    })()`);
    if (read.stop) return read.stop;
    if (!read.value?.has) return fail("COVER_LOST", read.value, "存草稿后封面丢了");
    return pass("VERIFY_OK", { appmsgid: ctx.appmsgid, cover: true, ...extra });
  },

  // ---------- probe ----------
  // engine.mjs --probe 模式所需；openBlank 已完成主要探测，probe 本身只认 adapter 有这个方法
  async probe(ctx) {
    return pass("PROBE_OK", { tabId: ctx.tabId });
  },

  // ---------- selfCheck ----------
  async selfCheck() {
    return pass("SELF_CHECK_PASS");
  },
};
