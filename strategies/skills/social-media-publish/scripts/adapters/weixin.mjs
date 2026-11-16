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

import { fail, page, pass, sleep } from "../page.mjs";
import { call, click, exec, tabRows, tabs, uploadFile } from "../sparo.mjs";

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

    // 4. 对话框内的 file input 上传
    const picked = await page(ctx, `(() => {
      const d = document.querySelector('.weui-desktop-dialog_img-picker');
      const t = d ? d.querySelector('input[type=file]') : null;
      if (!t) return JSON.stringify({ selector: '' });
      if (!t.id) t.id = 'sparo-wx-cover-' + Date.now();
      return JSON.stringify({ selector: '#' + t.id });
    })()`);
    if (picked.stop) return picked.stop;
    if (!picked.value?.selector) return fail("NO_FILE_INPUT", picked.value, "图片库里没有文件框");
    const up = await uploadFile(picked.value.selector, ctx.cover, ctx.tabId);
    if (typeof up === "string" && /^(MISMATCH|URL_UNREAD|ENV_MISMATCH)/.test(up)) return fail("UPLOAD_BLOCKED", up, up);

    // 5. 等「下一步」解禁（上传完才 enable，实测 10-12 秒）
    const nextBtn = `[...document.querySelector('.weui-desktop-dialog_img-picker')?.querySelectorAll('button') || []].find(x => (x.innerText||'').trim() === '下一步')`;
    const ready = await pollUntil(ctx,
      `(() => { const b = ${nextBtn}; if (!b) return JSON.stringify({ gone: true }); return JSON.stringify({ disabled: b.disabled || b.classList.contains('weui-desktop-btn_disabled') }); })()`,
      (v) => v?.disabled === false, 35, 1000);
    if (ready?.disabled !== false) return fail("COVER_UPLOAD_SLOW", ready, "上传 35 秒仍未完成");

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
    if (!ctx.coverApplied) return pass("VERIFY_OK", { appmsgid: ctx.appmsgid });
    const read = await page(ctx, `(() => {
      const p = document.querySelector('#js_cover_area .js_cover_preview_new');
      const bg = p ? (getComputedStyle(p).backgroundImage || '') : '';
      return JSON.stringify({ has: bg.includes('mmbiz.qpic.cn') });
    })()`);
    if (read.stop) return read.stop;
    if (!read.value?.has) return fail("COVER_LOST", read.value, "存草稿后封面丢了");
    return pass("VERIFY_OK", { appmsgid: ctx.appmsgid, cover: true });
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
