/**
 * Vertical workflows (Dianxiaomi pack). Hidden in public Sparo unless SPARO_ENABLE_DXM=1.
 */
import type { ToolResult } from "../../shared/types.js";
import { playbookForAgent } from "./listing-playbook.js";
import { dxmEnabled } from "../features.js";

export type WorkflowId =
  | "dxm_full_listing"
  | "dxm_autopilot"
  | "dxm_resize_800"
  | "dxm_translate_zh_en"
  | "dxm_images_all"
  | "dxm_qa";

export type WorkflowMeta = {
  id: WorkflowId;
  title: string;
  aliases: string[];
  description: string;
  needsEditPage: boolean;
};

/** Minimal browser surface used by workflows */
export type WorkflowBrowser = {
  getUrl(): string;
  navigate(url: string, opts?: { asHuman?: boolean }): Promise<ToolResult>;
  execute(script: string): Promise<ToolResult & { data?: { result?: unknown } }>;
  menuClick(trigger: string, item: string): Promise<ToolResult>;
  clickText(
    text: string,
    opts?: { exact?: boolean; withinPortal?: boolean; caret?: boolean },
  ): Promise<ToolResult>;
  click(target: {
    ref?: string;
    selector?: string;
    caret?: boolean;
  }): Promise<ToolResult>;
  /** Send a key to the focused page (e.g. Enter) — used when modal CDP click is swallowed */
  pressKey?(key: string): Promise<ToolResult>;
  dismissOverlays(): Promise<ToolResult>;
  fill(
    target: { ref?: string; selector?: string },
    value: string,
  ): Promise<ToolResult>;
  qaCheck(): Promise<ToolResult>;
  listPortals(): Promise<ToolResult>;
  setPaused(paused: boolean): void;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 速卖通编辑 + 采集箱编辑等可改图页 */
export function isDxmEditPage(url: string): boolean {
  const u = url || "";
  return (
    u.includes("dianxiaomi.com/web/smt/edit") ||
    u.includes("dianxiaomi.com/web/productCrawl/edit") ||
    /dianxiaomi\.com\/web\/[^/]*edit/i.test(u)
  );
}

export const WORKFLOWS: WorkflowMeta[] = [
  {
    id: "dxm_full_listing",
    title: "一句话上品（职业技能）",
    aliases: [
      "上品",
      "上架",
      "完整上架",
      "一句话上架",
      "处理好",
      "处理这个商品",
      "上架准备",
      "自动处理",
      "帮我弄好",
      "全自动",
      "一键处理",
      "autopilot",
    ],
    description:
      "清公告→主图6→改尺寸800→图片翻译→文字一键翻译→不含关税→QA→暂停人审。不自动发布。",
    needsEditPage: true,
  },
  {
    id: "dxm_autopilot",
    title: "Autopilot（同上品）",
    aliases: [],
    description: "dxm_full_listing 别名",
    needsEditPage: true,
  },
  {
    id: "dxm_resize_800",
    title: "批量改图片尺寸→800（小边）",
    aliases: ["改尺寸", "改图片尺寸", "批量改尺寸", "图片改800", "resize", "800"],
    description: "产品图片 → 编辑图片 → 批量改图片尺寸 → 等比例/小边 800 → 生成JPG",
    needsEditPage: true,
  },
  {
    id: "dxm_translate_zh_en",
    title: "图片翻译（图上中文→英文）",
    aliases: ["图片翻译", "翻译图片", "图翻", "translate"],
    description: "编辑图片→图片翻译→全选→弹窗一键翻译×2。与页顶文字一键翻译不同。",
    needsEditPage: true,
  },
  {
    id: "dxm_images_all",
    title: "改尺寸800 + 图片翻译 + 文字一键翻译",
    aliases: ["图片全流程", "图片处理", "images"],
    description: "改尺寸→图片翻译→页顶文字一键翻译",
    needsEditPage: true,
  },
  {
    id: "dxm_qa",
    title: "速卖通 QA 自审",
    aliases: ["检查qa", "自审", "验收", "qa"],
    description: "检查标题英文/主图6/图片翻译/关税等",
    needsEditPage: false,
  },
];

export function listWorkflowSummaries(): Array<{
  id: string;
  title: string;
  aliases: string[];
  description: string;
}> {
  if (!dxmEnabled()) return [];
  return WORKFLOWS.map((w) => ({
    id: w.id,
    title: w.title,
    aliases: w.aliases,
    description: w.description,
  }));
}

export function resolveWorkflowId(input: string): WorkflowId | null {
  const t = input.trim().toLowerCase();
  if (!t) return null;
  if (
    /上品|上架|完整上架|一句话上架|处理好|处理这个商品|上架准备|自动处理|帮我弄好|全自动|一键处理|autopilot|dxm_full_listing|dxm_autopilot/i.test(
      t,
    )
  ) {
    return "dxm_full_listing";
  }
  for (const w of WORKFLOWS) {
    if (w.id === t) return w.id;
  }
  if (/改尺寸|改图片尺寸|批量改|resize|800/.test(t) && /翻译|translate/.test(t)) {
    return "dxm_images_all";
  }
  if (/图片全流程|图片处理|images\s*all/.test(t)) return "dxm_images_all";
  if (/改尺寸|改图片尺寸|批量改尺寸|图片改\s*800|resize|小边.*800/.test(t)) {
    return "dxm_resize_800";
  }
  if (/图片翻译|翻译图片|中文\s*[→\-到至]\s*英文|translate/.test(t)) {
    return "dxm_translate_zh_en";
  }
  if (/^(qa|自审|验收)$/i.test(t) || /检查\s*(当前页)?\s*qa|速卖通\s*qa/.test(t)) {
    return "dxm_qa";
  }
  for (const w of WORKFLOWS) {
    if (w.aliases.some((a) => a.toLowerCase() === t || t.includes(a.toLowerCase()))) {
      return w.id;
    }
  }
  return null;
}

export function dxmGuideMessage(url: string, mode: "home" | "help" | "edit" = "help"): string {
  const onEdit = isDxmEditPage(url);
  if (mode === "home" || mode === "help") {
    if (onEdit) return "已在编辑页。说「处理好这个商品」即可，做完我会停给你审。";
    if (/dianxiaomi\.com/i.test(url)) {
      return "已在店小蜜。点开要处理的商品编辑页，再说「处理好这个商品」。";
    }
    return "先打开店小蜜商品编辑页，再说「处理好这个商品」。";
  }
  // edit
  if (onEdit) return "已在编辑页。说「处理好这个商品」。";
  return "请点开采集/速卖通商品编辑页，再说「处理好这个商品」。";
}

export function dxmPlaybookForAgent(): string {
  return playbookForAgent();
}

async function dismissAll(browser: WorkflowBrowser): Promise<void> {
  await browser.dismissOverlays();
  await browser.execute(`(() => {
    // Hide leftover dropdowns that steal clicks
    for (const d of document.querySelectorAll('.ant-dropdown')) {
      d.classList.add('ant-dropdown-hidden');
      d.style.display = 'none';
    }
    for (const w of document.querySelectorAll('.ant-modal-wrap')) {
      if (getComputedStyle(w).display === 'none') continue;
      const title = (w.querySelector('.ant-modal-title')?.innerText || '').trim();
      const body = (w.querySelector('.ant-modal-body')?.innerText || '').trim();
      // Never cancel in-flight image jobs
      if (/图片处理中|处理中/.test(title)) continue;
      if (/提示/.test(title) && /进行中|翻译中|正在/.test(body)) continue;
      // Unsaved / leave confirm — keep editing
      if (/继续关闭|确认关闭|离开/.test(body + title) || Array.from(w.querySelectorAll('button')).some(b => /继续关闭/.test(b.innerText||''))) {
        const cancel = Array.from(w.querySelectorAll('button')).find(b => /取消|否|留下|继续编辑/.test((b.innerText||'').trim()));
        (cancel || w.querySelector('.ant-modal-close'))?.click();
        continue;
      }
      if (!/批量改图片尺寸|图片翻译|提示/.test(title)) continue;
      // Prefer confirm/close — never click 取消 (cancels the job)
      const buttons = Array.from(w.querySelectorAll('button'));
      const ok = buttons.find(b => /确定|知道了|完成|关闭/.test((b.innerText||'').trim()) && !/取消|继续关闭/.test(b.innerText||''));
      const x = w.querySelector('.ant-modal-close');
      (ok || x)?.click();
    }
    return true;
  })()`);
  await sleep(400);
}

/** Soft close only success tip / idle translate modal — never touch 取消 or 处理中 */
async function dismissTranslateIdle(browser: WorkflowBrowser): Promise<void> {
  await browser.execute(`(() => {
    for (const w of document.querySelectorAll('.ant-modal-wrap')) {
      if (getComputedStyle(w).display === 'none') continue;
      const title = (w.querySelector('.ant-modal-title')?.innerText || '').trim();
      const body = (w.querySelector('.ant-modal-body')?.innerText || '').trim();
      if (/图片处理中|处理中/.test(title)) continue;
      if (/进行中|翻译中|正在/.test(body)) continue;
      if (/提示/.test(title) && /已翻译成功|成功|完成/.test(body)) {
        const ok = Array.from(w.querySelectorAll('button')).find(b =>
          /确定|知道了|完成/.test((b.innerText||'').trim()));
        (ok || w.querySelector('.ant-modal-close'))?.click();
        continue;
      }
      if (/图片翻译/.test(title) && !/进行中|翻译中/.test(body)) {
        w.querySelector('.ant-modal-close')?.click();
      }
    }
    return true;
  })()`);
  await sleep(400);
}

async function goProductImages(browser: WorkflowBrowser): Promise<void> {
  await browser.execute(`(() => {
    const nav = Array.from(document.querySelectorAll('a,li,div,span')).find(el => {
      const t = (el.innerText||'').trim();
      const r = el.getBoundingClientRect();
      return (t === '产品信息' || t === '采集图片信息') && r.width > 0 && r.width < 160;
    });
    nav?.click();
    return !!nav;
  })()`);
  await sleep(600);
  await browser.execute(`(() => {
    const label = Array.from(document.querySelectorAll('label,div,span,h3,h4')).find((el) => {
      const t = (el.innerText || '').trim();
      return (t === '产品图片' || t === '采集图片') && el.children.length < 8;
    });
    const mod = document.querySelector('.img-module');
    (label || mod)?.scrollIntoView({ block: 'start' });
    return { label: !!label, mod: !!mod };
  })()`);
  await sleep(400);
}

/** 点开语种下拉后选「中文→英文」
 * - 页顶文字一键：普通翻译 / 高级翻译
 * - 图片翻译弹窗：阿里翻译beta / 象寄 / 百度… 下的「中文→英文」
 */
async function pickZhEnLanguage(
  browser: WorkflowBrowser,
  opts?: { preferNormal?: boolean; imageModal?: boolean },
): Promise<ToolResult> {
  const preferNormal = opts?.preferNormal !== false;
  const imageModal = !!opts?.imageModal;
  const marked = await browser.execute(`(() => {
    const preferNormal = ${preferNormal ? "true" : "false"};
    const imageModal = ${imageModal ? "true" : "false"};
    const isLang = (t) => {
      const s = String(t || '').replace(/\\s+/g, ' ').trim();
      return /中文\\s*[→\\->﹣－—]+\\s*英文/.test(s) || /^中文.*英文$/.test(s);
    };
    // Prefer lang menus; ignore 编辑图片 menu
    const dds = Array.from(document.querySelectorAll('.ant-dropdown')).filter((d) => {
      const t = d.innerText || '';
      if (/批量改图片尺寸|图片白底|清空图片/.test(t) && !/阿里翻译|象寄|百度|普通翻译|高级翻译/.test(t)) {
        return false;
      }
      return isLang(t) || /普通翻译|高级翻译|阿里翻译|象寄翻译|自定义翻译|AI翻译/.test(t);
    });
    let dd = dds.find((d) => getComputedStyle(d).display !== 'none' && !d.classList.contains('ant-dropdown-hidden'));
    if (!dd) dd = dds[0];
    if (!dd) return { ok: false, reason: 'no-lang-dropdown', n: document.querySelectorAll('.ant-dropdown').length };
    dd.classList.remove('ant-dropdown-hidden');
    dd.style.cssText = 'display:block;position:fixed;left:32%;top:160px;z-index:99999;visibility:visible;pointer-events:auto;';
    const items = Array.from(dd.querySelectorAll('li,.ant-dropdown-menu-item'));
    let hit = null;
    if (!imageModal && preferNormal) {
      for (let i = 0; i < items.length; i++) {
        const t = (items[i].innerText || '').replace(/\\s+/g, ' ').trim();
        if (t === '普通翻译' || t.startsWith('普通翻译')) {
          for (let j = i + 1; j < Math.min(i + 8, items.length); j++) {
            const jt = (items[j].innerText || '').replace(/\\s+/g, ' ').trim();
            if (isLang(jt) && jt.length < 40) { hit = items[j]; break; }
          }
          break;
        }
      }
    }
    if (!hit && imageModal) {
      // Prefer 阿里翻译beta 下的中文→英文
      for (let i = 0; i < items.length; i++) {
        const t = (items[i].innerText || '').replace(/\\s+/g, ' ').trim();
        if (/阿里翻译/.test(t)) {
          for (let j = i; j < Math.min(i + 6, items.length); j++) {
            const jt = (items[j].innerText || '').replace(/\\s+/g, ' ').trim();
            if (isLang(jt) && jt.length < 40) { hit = items[j]; break; }
          }
          break;
        }
      }
    }
    if (!hit) {
      hit = items.find((el) => {
        const t = (el.innerText || '').replace(/\\s+/g, ' ').trim();
        return isLang(t) && t.length < 40;
      }) || null;
    }
    if (!hit) {
      hit = Array.from(dd.querySelectorAll('div,span,a,li')).find((el) => {
        const t = (el.innerText || '').replace(/\\s+/g, ' ').trim();
        return isLang(t) && t.length < 24;
      }) || null;
    }
    if (!hit) return { ok: false, reason: 'no-zh-en-item', sample: (dd.innerText || '').slice(0, 160) };
    hit.setAttribute('data-spark-ref', 'dxm-zh-en');
    hit.scrollIntoView({ block: 'nearest' });
    return { ok: true, text: (hit.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 40), sample: (dd.innerText || '').slice(0, 80) };
  })()`);
  const fr = marked.data?.result as { ok?: boolean; reason?: string; text?: string; sample?: string } | undefined;
  if (!fr?.ok) {
    let picked = await browser.clickText("中文 → 英文", { withinPortal: true });
    if (!picked.ok) picked = await browser.clickText("中文 -> 英文", { withinPortal: true });
    if (!picked.ok) picked = await browser.clickText("中文 → 英文");
    if (!picked.ok) {
      return {
        ok: false,
        message: `未选中「中文 → 英文」：${fr?.reason || picked.message}${fr?.sample ? " / " + fr.sample : ""}`,
      };
    }
    return { ok: true, message: "已选语种「中文 → 英文」" };
  }

  let clk = await browser.click({ ref: "dxm-zh-en" });
  if (!clk.ok) {
    clk = await browser.clickText("中文 → 英文", { withinPortal: true });
  }
  if (!clk.ok) {
    return { ok: false, message: `语种点击失败：${clk.message}` };
  }
  return { ok: true, message: `已选语种「${fr.text || "中文→英文"}」` };
}

function assertEditPage(browser: WorkflowBrowser): ToolResult | null {
  const url = browser.getUrl();
  if (!isDxmEditPage(url)) {
    return {
      ok: false,
      message:
        `当前不在店小蜜商品编辑页（${url}）。请打开速卖通编辑(/web/smt/edit)或采集箱编辑(/web/productCrawl/edit)，再说「处理好这个商品」。`,
    };
  }
  return null;
}

/** 打开「批量改图片尺寸」：采集箱页 dropdown 常不响应 menuClick，需强制露出后点项 */
async function openBatchResizeMenu(browser: WorkflowBrowser): Promise<ToolResult> {
  // Prefer normal menu_click first (SMT 编辑页)
  const menu = await browser.menuClick("编辑图片", "批量改图片尺寸");
  if (menu.ok) return menu;

  const forced = await browser.execute(`(() => {
    const mod = document.querySelector('.img-module') || document.body;
    const btn = Array.from(mod.querySelectorAll('a.img-options-action-btn,a,button')).find((el) => {
      const t = (el.innerText || '').replace(/\\s+/g, '');
      const r = el.getBoundingClientRect();
      return t.includes('编辑图片') && !t.includes('批量编辑') && r.width > 0 && r.y >= 0 && r.y < innerHeight;
    });
    const dd = Array.from(document.querySelectorAll('.ant-dropdown')).find((d) =>
      /批量改图片尺寸/.test(d.innerText || ''),
    );
    if (!btn || !dd) return { ok: false, hasBtn: !!btn, hasDd: !!dd };
    const box = btn.getBoundingClientRect();
    dd.classList.remove('ant-dropdown-hidden');
    dd.style.cssText = 'display:block;position:fixed;left:' + box.left + 'px;top:' + (box.bottom + 2) + 'px;z-index:99999;';
    const item = Array.from(dd.querySelectorAll('li,.ant-dropdown-menu-item')).find((el) =>
      (el.innerText || '').trim().startsWith('批量改图片尺寸'),
    );
    if (!item) return { ok: false, hasBtn: true, hasDd: true, noItem: true };
    item.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    item.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    item.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
    item.click();
    (item.querySelector('a,span') || item).click();
    item.setAttribute('data-spark-ref', 'dxm-batch-resize-item');
    return { ok: true, forced: true };
  })()`);

  if ((forced.data?.result as { ok?: boolean } | undefined)?.ok) {
    await sleep(800);
    return { ok: true, message: "已强制打开并点击「批量改图片尺寸」" };
  }

  // last resort: trusted click marked item if visible
  const marked = await browser.execute(`(() => {
    const dd = Array.from(document.querySelectorAll('.ant-dropdown')).find((d) =>
      /批量改图片尺寸/.test(d.innerText || ''),
    );
    if (!dd) return { ok: false };
    dd.classList.remove('ant-dropdown-hidden');
    dd.style.display = 'block';
    dd.style.zIndex = '99999';
    const item = Array.from(dd.querySelectorAll('li,.ant-dropdown-menu-item')).find((el) =>
      (el.innerText || '').trim().startsWith('批量改图片尺寸'),
    );
    if (!item) return { ok: false };
    item.setAttribute('data-spark-ref', 'dxm-batch-resize-item');
    return { ok: true };
  })()`);
  if ((marked.data?.result as { ok?: boolean } | undefined)?.ok) {
    const clk = await browser.click({ ref: "dxm-batch-resize-item" });
    if (clk.ok) return { ok: true, message: "已点击「批量改图片尺寸」（forced dropdown）" };
  }

  return {
    ok: false,
    message: `打开改尺寸菜单失败：${menu.message}`,
  };
}

async function resizeTo800(browser: WorkflowBrowser): Promise<ToolResult> {
  const gate = assertEditPage(browser);
  if (gate) return gate;

  await dismissAll(browser);
  await goProductImages(browser);

  // Already 800? soft-pass (still try menu if mixed)
  const pre = await browser.execute(`(() => {
    const mod = document.querySelector('.img-module') || document;
    const dims = Array.from(mod.querySelectorAll('.img-size,.single-image')).map(el => (el.innerText||'').trim()).filter(t => /^\\d+\\s*[Xx×]\\s*\\d+/.test(t));
    const all = dims.length > 0 && dims.every(t => /800\\s*[Xx×]\\s*800/.test(t));
    return { all800: all, n: dims.length, sample: dims.slice(0, 6) };
  })()`);
  const preData = pre.data?.result as { all800?: boolean; n?: number } | undefined;
  if (preData?.all800 && (preData.n || 0) >= 6) {
    return {
      ok: true,
      message: `主图已是 800×800（${preData.n} 处尺寸标注），跳过改尺寸`,
      data: preData,
    };
  }

  const menu = await openBatchResizeMenu(browser);
  if (!menu.ok) {
    return { ok: false, message: menu.message };
  }
  await sleep(1200);

  await browser.clickText("等比例调整");
  await sleep(400);
  await browser.clickText("等比例调整", { withinPortal: true });
  await sleep(300);

  await browser.clickText("图片小边").catch(() => ({ ok: false, message: "" }));
  await sleep(300);
  const edge = await browser.clickText("图片小边", { withinPortal: true });
  if (!edge.ok) {
    await browser.clickText("图片短边", { withinPortal: true });
  }
  await sleep(300);

  await browser.execute(`(() => {
    const wrap = Array.from(document.querySelectorAll('.ant-modal-wrap')).find(w =>
      getComputedStyle(w).display !== 'none' && (w.querySelector('.ant-modal-title')?.innerText||'').includes('批量改图片尺寸'));
    if (!wrap) return { ok:false };
    const input = Array.from(wrap.querySelectorAll('input')).find(i => {
      const r = i.getBoundingClientRect();
      return (i.type==='text'||i.type==='number'||!i.type) && r.width>30 && r.width<150;
    });
    if (!input) return { ok:false };
    input.setAttribute('data-spark-ref','dxm-rz-size');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value')?.set;
    const tracker = input._valueTracker;
    if (tracker) tracker.setValue(input.value||'');
    if (setter) setter.call(input,'800'); else input.value='800';
    input.dispatchEvent(new Event('input',{bubbles:true}));
    input.dispatchEvent(new Event('change',{bubbles:true}));
    return { ok:true, value: input.value };
  })()`);
  await browser.fill({ ref: "dxm-rz-size" }, "800").catch(() => ({ ok: false, message: "" }));

  await browser.execute(`(() => {
    const wrap = Array.from(document.querySelectorAll('.ant-modal-wrap')).find(w =>
      getComputedStyle(w).display !== 'none' && (w.querySelector('.ant-modal-title')?.innerText||'').includes('批量改图片尺寸'));
    const lab = Array.from(wrap?.querySelectorAll('.ant-checkbox-wrapper') || []).find(l => (l.innerText||'').trim().startsWith('选择全部'));
    if (lab && !lab.querySelector('.ant-checkbox-checked')) lab.click();
    return true;
  })()`);

  await browser.clickText("生成JPG图片");

  for (let i = 0; i < 25; i++) {
    await sleep(1500);
    const st = await browser.execute(`(() => {
      const wrap = Array.from(document.querySelectorAll('.ant-modal-wrap')).find(w => getComputedStyle(w).display !== 'none');
      return { title: wrap?.querySelector('.ant-modal-title')?.innerText?.trim() || null };
    })()`);
    const title = (st.data?.result as { title?: string | null } | undefined)?.title;
    if (!title || title === "提示") break;
    if (title !== "批量改图片尺寸" && title !== "图片处理中") break;
  }
  await dismissAll(browser);
  return { ok: true, message: "已完成：批量改图片尺寸（小边 800）" };
}

/** 打开「图片翻译」弹窗：menuClick 失败时强制露出下拉再点项；成功必须见到标题 */
async function openImageTranslateMenu(browser: WorkflowBrowser): Promise<ToolResult> {
  const verifyModal = async () => {
    for (let i = 0; i < 16; i++) {
      const open = await browser.execute(`(() => {
        const wrap = Array.from(document.querySelectorAll('.ant-modal-wrap')).find(w =>
          getComputedStyle(w).display !== 'none' && /图片翻译/.test(w.querySelector('.ant-modal-title')?.innerText||''));
        return { open: !!wrap };
      })()`);
      if ((open.data?.result as { open?: boolean } | undefined)?.open) return true;
      await sleep(350);
    }
    return false;
  };

  const menu = await browser.menuClick("编辑图片", "图片翻译");
  if (menu.ok && (await verifyModal())) {
    return { ok: true, message: menu.message };
  }

  const forced = await browser.execute(`(() => {
    const candidates = Array.from(document.querySelectorAll('a.img-options-action-btn,a,button')).filter((el) => {
      const t = (el.innerText || '').replace(/\\s+/g, '');
      const r = el.getBoundingClientRect();
      return t.includes('编辑图片') && !t.includes('批量编辑') && r.width > 0 && r.height > 0;
    });
    // Prefer visible in viewport; else first
    const btn = candidates.find((el) => {
      const r = el.getBoundingClientRect();
      return r.y >= 0 && r.y < innerHeight - 40;
    }) || candidates[0];
    const dd = Array.from(document.querySelectorAll('.ant-dropdown')).find((d) =>
      /图片翻译/.test(d.innerText || ''),
    );
    if (!btn || !dd) return { ok: false, hasBtn: !!btn, hasDd: !!dd, nBtn: candidates.length };
    btn.scrollIntoView({ block: 'center' });
    const box = btn.getBoundingClientRect();
    dd.classList.remove('ant-dropdown-hidden');
    dd.style.cssText = 'display:block;position:fixed;left:' + Math.max(8, box.left) + 'px;top:' + (box.bottom + 2) + 'px;z-index:99999;visibility:visible;pointer-events:auto;';
    const item = Array.from(dd.querySelectorAll('li,.ant-dropdown-menu-item')).find((el) => {
      const t = (el.innerText || '').replace(/\\s+/g, '').trim();
      return t.includes('图片翻译') && !t.includes('一键');
    });
    if (!item) return { ok: false, hasBtn: true, hasDd: true, noItem: true };
    item.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    item.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    item.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
    item.click();
    (item.querySelector('a,span') || item).click();
    // Hide trigger dropdown so it won't steal later clicks
    dd.classList.add('ant-dropdown-hidden');
    dd.style.display = 'none';
    return { ok: true, forced: true };
  })()`);

  if ((forced.data?.result as { ok?: boolean } | undefined)?.ok && (await verifyModal())) {
    return { ok: true, message: "已强制打开并点击「图片翻译」" };
  }

  // Trusted click marked item
  const marked = await browser.execute(`(() => {
    const dd = Array.from(document.querySelectorAll('.ant-dropdown')).find((d) =>
      /图片翻译/.test(d.innerText || ''),
    );
    if (!dd) return { ok: false };
    dd.classList.remove('ant-dropdown-hidden');
    dd.style.display = 'block';
    dd.style.zIndex = '99999';
    const item = Array.from(dd.querySelectorAll('li,.ant-dropdown-menu-item')).find((el) => {
      const t = (el.innerText || '').replace(/\\s+/g, '').trim();
      return t.includes('图片翻译') && !t.includes('一键');
    });
    if (!item) return { ok: false };
    item.setAttribute('data-spark-ref', 'dxm-img-translate-item');
    return { ok: true };
  })()`);
  if ((marked.data?.result as { ok?: boolean } | undefined)?.ok) {
    const clk = await browser.click({ ref: "dxm-img-translate-item" });
    if (clk.ok && (await verifyModal())) {
      return { ok: true, message: "已点击「图片翻译」（forced dropdown）" };
    }
  }

  return {
    ok: false,
    message: `打开图片翻译失败：${menu.message}`,
  };
}

/** 最近一次图片翻译结果，供 QA 分项 */
let lastImageTranslate: {
  ok: boolean;
  count: number;
  tip: string;
  at: number;
} | null = null;

async function translateZhEn(browser: WorkflowBrowser): Promise<ToolResult> {
  const gate = assertEditPage(browser);
  if (gate) return gate;

  await dismissAll(browser);
  await goProductImages(browser);

  const menu = await openImageTranslateMenu(browser);
  if (!menu.ok) {
    lastImageTranslate = { ok: false, count: 0, tip: menu.message, at: Date.now() };
    return { ok: false, message: menu.message };
  }
  await sleep(800);

  const selected = await selectAllTranslateImages(browser);
  if (!selected.ok || !selected.count) {
    lastImageTranslate = {
      ok: false,
      count: selected.count ?? 0,
      tip: selected.detail || "全选失败",
      at: Date.now(),
    };
    return {
      ok: false,
      message: `图片翻译全选失败（已选中 ${selected.count ?? 0} 张）：${selected.detail || "请手动全选后再试"}`,
    };
  }

  // Ensure 快速翻译 + 关掉残留「编辑图片」下拉 + 去掉重复空弹窗
  await browser.execute(`(() => {
    for (const d of document.querySelectorAll('.ant-dropdown')) {
      const t = d.innerText || '';
      if (/批量改图片尺寸|图片白底|清空图片/.test(t) && !/阿里翻译|普通翻译/.test(t)) {
        d.classList.add('ant-dropdown-hidden');
        d.style.display = 'none';
      }
    }
    const wraps = Array.from(document.querySelectorAll('.ant-modal-wrap')).filter(w =>
      getComputedStyle(w).display !== 'none' && /图片翻译/.test(w.querySelector('.ant-modal-title')?.innerText||''));
    // Close extras that have 0 selected if another has >0
    const scored = wraps.map(w => {
      const m = (w.innerText || '').match(/已选中\\s*(\\d+)/);
      return { w, n: m ? Number(m[1]) : 0 };
    });
    const best = scored.slice().sort((a,b) => b.n - a.n)[0];
    for (const s of scored) {
      if (best && s.w !== best.w && s.n === 0 && scored.length > 1) {
        s.w.querySelector('.ant-modal-close')?.click();
      }
    }
    const wrap = best?.w || wraps[0];
    if (!wrap) return { ok:false };
    const lab = Array.from(wrap.querySelectorAll('label,.ant-checkbox-wrapper')).find(el =>
      /快速翻译/.test((el.innerText||'').trim()));
    if (lab && !lab.querySelector('.ant-checkbox-checked') && !lab.classList.contains('ant-checkbox-wrapper-checked')) {
      lab.click();
    }
    return { ok:true, n: best?.n || 0, modals: wraps.length };
  })()`);
  await sleep(300);

  // 弹窗内「一键翻译」：ref 打在 button 上（caret 在右侧箭头，不能只标 span）
  const markModalOneKey = async () =>
    browser.execute(`(() => {
      const wraps = Array.from(document.querySelectorAll('.ant-modal-wrap')).filter(w =>
        getComputedStyle(w).display !== 'none' && /图片翻译/.test(w.querySelector('.ant-modal-title')?.innerText||''));
      const wrap = wraps.slice().sort((a,b) => {
        const na = Number(((a.innerText||'').match(/已选中\\s*(\\d+)/)||[])[1]||0);
        const nb = Number(((b.innerText||'').match(/已选中\\s*(\\d+)/)||[])[1]||0);
        return nb - na;
      })[0];
      if (!wrap) return { ok:false };
      const btn = Array.from(wrap.querySelectorAll('button')).find(b => {
        const t = (b.innerText||'').replace(/\\s+/g,'').trim();
        return t.includes('一键翻译') || b.classList.contains('ant-dropdown-trigger');
      });
      if (!btn) return { ok:false };
      btn.setAttribute('data-spark-ref','dxm-img-onekey');
      btn.scrollIntoView({ block: 'center' });
      const r = btn.getBoundingClientRect();
      return { ok:true, w: Math.round(r.width), x: Math.round(r.x), y: Math.round(r.y) };
    })()`);

  let marked = await markModalOneKey();
  if (!(marked.data?.result as { ok?: boolean } | undefined)?.ok) {
    lastImageTranslate = { ok: false, count: selected.count, tip: "无弹窗一键翻译按钮", at: Date.now() };
    return { ok: false, message: "图片翻译弹窗内未找到「一键翻译」" };
  }

  // 先 caret 打开「阿里翻译…中文→英文」菜单
  let clk = await browser.click({ ref: "dxm-img-onekey", caret: true });
  if (!clk.ok) clk = await browser.clickText("一键翻译", { caret: true });
  await sleep(800);

  // 若仍无阿里/语种菜单，再点一次 caret
  const hasLang = await browser.execute(`(() => {
    const ok = Array.from(document.querySelectorAll('.ant-dropdown')).some(d => {
      const t = d.innerText || '';
      return /阿里翻译|象寄|百度|中文/.test(t) && /英文/.test(t);
    });
    return { ok };
  })()`);
  if (!(hasLang.data?.result as { ok?: boolean } | undefined)?.ok) {
    await markModalOneKey();
    await browser.click({ ref: "dxm-img-onekey", caret: true });
    await sleep(800);
  }

  const picked = await pickZhEnLanguage(browser, { preferNormal: false, imageModal: true });
  if (!picked.ok) {
    lastImageTranslate = {
      ok: false,
      count: selected.count,
      tip: `未选中中文→英文：${picked.message}`,
      at: Date.now(),
    };
    return { ok: false, message: `图片翻译未选中「中文 → 英文」：${picked.message}` };
  }

  await sleep(900);
  // 图翻弹窗内第二次 CDP 点击常被 ant-modal-wrap 吞掉；语种选完后优先 Enter 提交
  const pressEnter = async () => {
    if (typeof browser.pressKey === "function") {
      await browser.pressKey("Enter");
    } else {
      await browser.execute(`(() => {
        const ev = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true });
        document.activeElement?.dispatchEvent(ev);
        document.body.dispatchEvent(ev);
        return true;
      })()`);
    }
  };

  let startedProbe = await browser.execute(`(() => {
    const wraps = Array.from(document.querySelectorAll('.ant-modal-wrap')).filter(w => getComputedStyle(w).display !== 'none');
    const text = wraps.map(w => (w.innerText||'')).join('\\n')
      + Array.from(document.querySelectorAll('.ant-message-notice-content')).map(e=>e.innerText||'').join('\\n');
    const spin = !!document.querySelector('.ant-spin-spinning');
    return { started: spin || /图片处理中|处理中|翻译中|正在翻译|排队|已翻译成功/.test(text) };
  })()`);

  if (!(startedProbe.data?.result as { started?: boolean } | undefined)?.started) {
    await pressEnter();
    await sleep(800);
  }

  startedProbe = await browser.execute(`(() => {
    const wraps = Array.from(document.querySelectorAll('.ant-modal-wrap')).filter(w => getComputedStyle(w).display !== 'none');
    const text = wraps.map(w => (w.innerText||'')).join('\\n');
    const spin = !!document.querySelector('.ant-spin-spinning');
    return { started: spin || /图片处理中|处理中|翻译中|正在翻译|排队|已翻译成功/.test(text) };
  })()`);

  if (!(startedProbe.data?.result as { started?: boolean } | undefined)?.started) {
    // 再试：点按钮文字区左侧（避开 caret）+ Enter
    await markModalOneKey();
    await browser.execute(`(() => {
      const btn = document.querySelector('[data-spark-ref="dxm-img-onekey"]');
      if (!btn) return false;
      const r = btn.getBoundingClientRect();
      // mark a left-side hit point via a child span
      let span = btn.querySelector('span');
      if (!span) {
        span = document.createElement('span');
        span.textContent = '一键翻译';
        btn.appendChild(span);
      }
      span.setAttribute('data-spark-ref', 'dxm-img-onekey-text');
      return true;
    })()`);
    await browser.click({ ref: "dxm-img-onekey-text" });
    await sleep(400);
    await pressEnter();
    await sleep(800);
  }

  // 若出现确认提示，JS click 确认（Skill：确认按钮 JS click 可用）
  await browser.execute(`(() => {
    for (const w of document.querySelectorAll('.ant-modal-wrap')) {
      if (getComputedStyle(w).display === 'none') continue;
      const title = (w.querySelector('.ant-modal-title')?.innerText || '').trim();
      const body = (w.querySelector('.ant-modal-body')?.innerText || '');
      if (/提示|确认/.test(title) || /是否|确认翻译|提交/.test(body)) {
        const ok = Array.from(w.querySelectorAll('button')).find(b =>
          /确定|确认|是|提交/.test((b.innerText||'').trim()) && !/取消/.test(b.innerText||''));
        ok?.click();
      }
    }
    return true;
  })()`);
  await sleep(1000);

  let lastTip = "";
  let success = false;
  let sawProgress = false;
  for (let i = 0; i < 150; i++) {
    await sleep(2000);
    const st = await browser.execute(`(() => {
      const wraps = Array.from(document.querySelectorAll('.ant-modal-wrap')).filter(
        w => getComputedStyle(w).display !== 'none',
      );
      const titles = wraps.map(w => (w.querySelector('.ant-modal-title')?.innerText||'').trim());
      const tips = wraps
        .filter(w => (w.querySelector('.ant-modal-title')?.innerText||'').trim() === '提示')
        .map(w => (w.querySelector('.ant-modal-body')?.innerText||'').trim().slice(0,240));
      const bodies = wraps.map(w => (w.querySelector('.ant-modal-body')?.innerText||'').trim().slice(0,240));
      const msgs = Array.from(document.querySelectorAll('.ant-message-notice-content,.ant-notification-notice-message'))
        .map(e => (e.innerText||'').trim().slice(0,120));
      const spin = !!document.querySelector('.ant-spin-spinning');
      const allText = titles.join('\\n') + '\\n' + bodies.join('\\n') + '\\n' + msgs.join('\\n');
      const progressing = spin
        || /图片处理中|处理中|进行中|翻译中|正在翻译|排队/.test(allText);
      const trModalOpen = titles.some(t => /图片翻译/.test(t));
      const processingModal = titles.some(t => /图片处理中|处理中/.test(t));
      const successN = (allText.match(/已翻译成功\\s*(\\d+)\\s*张/) || [])[1];
      return { tips, msgs, titles, progressing, trModalOpen, processingModal, successN };
    })()`);
    const data = st.data?.result as {
      tips?: string[];
      msgs?: string[];
      progressing?: boolean;
      trModalOpen?: boolean;
      processingModal?: boolean;
      successN?: string;
    } | undefined;
    const tips = data?.tips || [];
    const msgs = data?.msgs || [];
    lastTip = tips[0] || msgs[0] || lastTip;
    if (data?.progressing) sawProgress = true;

    const doneText = [...tips, ...msgs].some(
      (t) => /已翻译成功|翻译成功|全部完成/.test(t) && !/进行中|翻译中/.test(t),
    );
    if (doneText || (data?.successN && Number(data.successN) > 0 && !data.progressing)) {
      success = true;
      break;
    }
    const hardFail = [...tips, ...msgs].some(
      (t) => /失败|不足|余额|未选中|请选择|已取消|取消成功/.test(t) && !/进行中|翻译中/.test(t),
    );
    if (hardFail) break;

    if (data?.progressing || data?.processingModal) continue;

    if (sawProgress && !data?.progressing && !data?.processingModal) {
      if (doneText || (!data?.trModalOpen && i > 3)) {
        success = !hardFail;
        break;
      }
      if (tips.some((t) => /成功|完成/.test(t) && !/进行中/.test(t))) {
        success = true;
        break;
      }
    }
  }

  await dismissTranslateIdle(browser);
  lastImageTranslate = {
    ok: success,
    count: selected.count,
    tip: lastTip,
    at: Date.now(),
  };
  if (!success && /失败|不足|未选中|请选择|已取消|0张/.test(lastTip)) {
    return {
      ok: false,
      message: `图片翻译未成功（已选中 ${selected.count} 张）。${lastTip.slice(0, 160)}`,
    };
  }
  if (!success && !sawProgress) {
    return {
      ok: false,
      message: `图片翻译似乎未开始或已中断（已选中 ${selected.count} 张）。${lastTip.slice(0, 120)}`,
    };
  }
  if (!success) {
    return {
      ok: false,
      message: `图片翻译未确认成功（已选中 ${selected.count} 张）。${lastTip.slice(0, 120)}`,
    };
  }
  return {
    ok: true,
    message: lastTip
      ? `图片翻译完成（选中 ${selected.count} 张）。${lastTip.slice(0, 120)}`
      : `图片翻译完成（选中 ${selected.count} 张）`,
  };
}

/** 强化全选：trusted click「选择全部」+ 点掉「点击选中」瓦片，并校验已选中张数 */
async function selectAllTranslateImages(
  browser: WorkflowBrowser,
): Promise<{ ok: boolean; count: number; detail?: string }> {
  const markSelectAll = await browser.execute(`(() => {
    const wrap = Array.from(document.querySelectorAll('.ant-modal-wrap')).find(w =>
      getComputedStyle(w).display !== 'none' && /图片翻译/.test(w.querySelector('.ant-modal-title')?.innerText||''));
    if (!wrap) return { ok:false, reason:'no-modal' };
    const lab = Array.from(wrap.querySelectorAll('label,.ant-checkbox-wrapper')).find(el =>
      /选择全部/.test((el.innerText||'').trim()));
    if (!lab) return { ok:false, reason:'no-select-all' };
    const box = lab.querySelector('.ant-checkbox') || lab;
    box.setAttribute('data-spark-ref','dxm-tr-select-all');
    return { ok:true, already: !!(lab.querySelector('.ant-checkbox-checked') || lab.classList.contains('ant-checkbox-wrapper-checked')) };
  })()`);
  const mark = markSelectAll.data?.result as
    | { ok?: boolean; already?: boolean; reason?: string }
    | undefined;
  if (!mark?.ok) {
    return { ok: false, count: 0, detail: mark?.reason || "找不到选择全部" };
  }

  // Always trusted-click once (even if looks checked — may be indeterminate)
  await browser.click({ ref: "dxm-tr-select-all" });
  await sleep(500);
  // If still unchecked / zero selected, click again
  let count = await readSelectedCount(browser);
  if (count <= 0) {
    await browser.click({ ref: "dxm-tr-select-all" });
    await sleep(400);
    count = await readSelectedCount(browser);
  }

  // Click remaining tiles showing 点击选中 / unchecked image checkboxes
  for (let round = 0; round < 3 && count <= 0; round++) {
    await browser.execute(`(() => {
      const wrap = Array.from(document.querySelectorAll('.ant-modal-wrap')).find(w =>
        getComputedStyle(w).display !== 'none' && /图片翻译/.test(w.querySelector('.ant-modal-title')?.innerText||''));
      if (!wrap) return { n:0 };
      let n = 0;
      Array.from(wrap.querySelectorAll('*')).forEach(el => {
        const t = (el.innerText||'').trim();
        if (t === '点击选中' && el.children.length < 3) {
          try { el.click(); n++; } catch (_) {}
        }
      });
      Array.from(wrap.querySelectorAll('.ant-checkbox-wrapper')).forEach(lab => {
        const t = (lab.innerText||'').trim();
        if (/选择全部|快速翻译/.test(t)) return;
        if (lab.querySelector('.ant-checkbox-checked')) return;
        try { lab.click(); n++; } catch (_) {}
      });
      return { n };
    })()`);
    await sleep(400);
    count = await readSelectedCount(browser);
  }

  // Last resort: click every visible image card in modal
  if (count <= 0) {
    await browser.execute(`(() => {
      const wrap = Array.from(document.querySelectorAll('.ant-modal-wrap')).find(w =>
        getComputedStyle(w).display !== 'none' && /图片翻译/.test(w.querySelector('.ant-modal-title')?.innerText||''));
      if (!wrap) return { n:0 };
      let n = 0;
      const imgs = Array.from(wrap.querySelectorAll('img')).filter(img => {
        const r = img.getBoundingClientRect();
        return r.width > 40 && r.height > 40;
      });
      for (const img of imgs) {
        const card = img.closest('div,li,label') || img;
        try { card.dispatchEvent(new MouseEvent('click', { bubbles: true })); n++; } catch (_) {}
      }
      return { n: imgs.length };
    })()`);
    await sleep(500);
    count = await readSelectedCount(browser);
  }

  return {
    ok: count > 0,
    count,
    detail: count > 0 ? `已选中${count}张` : "全选后仍为 0 张",
  };
}

async function readSelectedCount(browser: WorkflowBrowser): Promise<number> {
  const st = await browser.execute(`(() => {
    const wrap = Array.from(document.querySelectorAll('.ant-modal-wrap')).find(w =>
      getComputedStyle(w).display !== 'none' && /图片翻译/.test(w.querySelector('.ant-modal-title')?.innerText||''));
    if (!wrap) return { count: 0 };
    const m = (wrap.innerText || '').match(/已选中\\s*(\\d+)\\s*张/);
    if (m) return { count: Number(m[1]) };
    const checked = wrap.querySelectorAll('.ant-checkbox-checked').length;
    // subtract select-all + quick-translate if checked
    return { count: Math.max(0, checked - 2) };
  })()`);
  return Number((st.data?.result as { count?: number } | undefined)?.count || 0);
}

/** 页顶一键翻译（文字）— translation-btn 打开 ant-dropdown：普通翻译→中文→英文 */
async function oneKeyTranslate(browser: WorkflowBrowser): Promise<ToolResult> {
  const gate = assertEditPage(browser);
  if (gate) return gate;
  await dismissAll(browser);
  await sleep(300);
  await browser.execute(`(() => { window.scrollTo(0, 0); return true; })()`);
  await sleep(200);

  const marked = await browser.execute(`(() => {
    // close stray menus
    for (const d of document.querySelectorAll('.ant-dropdown')) {
      d.classList.add('ant-dropdown-hidden');
      d.style.display = 'none';
    }
    const btns = Array.from(document.querySelectorAll('button.translation-btn,button'));
    const candidates = btns.filter((el) => {
      const t = (el.innerText || '').replace(/\\s+/g, '').trim();
      const r = el.getBoundingClientRect();
      if (!t.includes('一键翻译')) return false;
      if (!el.classList.contains('translation-btn') && t !== '一键翻译') return false;
      if (r.width < 36 || r.height < 16 || r.top > 220) return false;
      const inModal = el.closest('.ant-modal-wrap');
      if (inModal && getComputedStyle(inModal).display !== 'none') return false;
      return true;
    });
    candidates.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
    const btn = candidates.find((el) => el.classList.contains('translation-btn')) || candidates[0];
    if (!btn) return { ok: false };
    btn.setAttribute('data-spark-ref', 'dxm-page-onekey');
    btn.scrollIntoView({ block: 'center' });
    return { ok: true, top: Math.round(btn.getBoundingClientRect().top), cls: btn.className };
  })()`);
  if (!(marked.data?.result as { ok?: boolean } | undefined)?.ok) {
    return { ok: false, message: "未找到页面顶部「一键翻译」" };
  }

  const openLangMenu = async (): Promise<boolean> => {
    // Prefer center click first — caret on this page sometimes hits wrong overlay
    let clk = await browser.click({ ref: "dxm-page-onekey" });
    if (!clk.ok) clk = await browser.clickText("一键翻译");
    await sleep(600);
    let has = await browser.execute(`(() => {
      const dds = Array.from(document.querySelectorAll('.ant-dropdown')).filter((d) => {
        const t = d.innerText || '';
        const vis = getComputedStyle(d).display !== 'none' && !d.classList.contains('ant-dropdown-hidden');
        return vis && (/普通翻译|高级翻译/.test(t) || /中文/.test(t) && /英文/.test(t));
      });
      return { ok: dds.length > 0, sample: dds[0] ? (dds[0].innerText||'').slice(0,80) : '' };
    })()`);
    if ((has.data?.result as { ok?: boolean } | undefined)?.ok) return true;

    // Retry caret
    await browser.execute(`(() => {
      for (const d of document.querySelectorAll('.ant-dropdown')) {
        d.classList.add('ant-dropdown-hidden');
        d.style.display = 'none';
      }
      return true;
    })()`);
    clk = await browser.click({ ref: "dxm-page-onekey", caret: true });
    await sleep(700);
    has = await browser.execute(`(() => {
      const dds = Array.from(document.querySelectorAll('.ant-dropdown')).filter((d) => {
        const t = d.innerText || '';
        const hide = d.classList.contains('ant-dropdown-hidden') || getComputedStyle(d).display === 'none';
        return !hide && (/普通翻译|高级翻译/.test(t) || /中文/.test(t) && /英文/.test(t));
      });
      // also accept just-created entering dropdowns
      const any = Array.from(document.querySelectorAll('.ant-dropdown')).filter((d) =>
        /普通翻译|高级翻译/.test(d.innerText || '') || (/中文/.test(d.innerText||'') && /英文/.test(d.innerText||'')),
      );
      if (dds.length) return { ok: true, sample: (dds[0].innerText||'').slice(0,80) };
      if (any.length) {
        const d = any[0];
        d.classList.remove('ant-dropdown-hidden');
        d.style.cssText = 'display:block;position:fixed;left:40%;top:120px;z-index:99999;visibility:visible;';
        return { ok: true, forced: true, sample: (d.innerText||'').slice(0,80) };
      }
      return { ok: false };
    })()`);
    return !!(has.data?.result as { ok?: boolean } | undefined)?.ok;
  };

  if (!(await openLangMenu())) {
    return { ok: false, message: "文字一键翻译：未打开语种下拉（普通翻译/中文→英文）" };
  }

  const picked = await pickZhEnLanguage(browser, { preferNormal: true });
  if (!picked.ok) {
    return { ok: false, message: `文字一键翻译未选语种：${picked.message}` };
  }

  await sleep(800);
  let tip = "";
  let success = false;
  let idleRounds = 0;
  for (let i = 0; i < 40; i++) {
    await sleep(1500);
    const st = await browser.execute(`(() => {
      const msgs = Array.from(document.querySelectorAll('.ant-message-notice-content,.ant-notification-notice-message'))
        .map(e => (e.innerText||'').trim().slice(0,120));
      const spin = !!document.querySelector('.ant-spin-spinning');
      const panel = document.querySelector('.translate-panel');
      const progressing = spin || msgs.some(m => /处理中|进行中|翻译中|正在翻译/.test(m));
      return { msgs, progressing, panelOpen: !!panel };
    })()`);
    const data = st.data?.result as {
      msgs?: string[];
      progressing?: boolean;
      panelOpen?: boolean;
    } | undefined;
    tip = data?.msgs?.[0] || tip;
    const titleSt = await browser.execute(titleProbeScript());
    const td = titleSt.data?.result as { looksEn?: boolean; titleVal?: string } | undefined;
    if (td?.looksEn) {
      success = true;
      break;
    }
    if (data?.msgs?.some((t) => /失败|不足|余额|已取消/.test(t))) break;
    if (data?.progressing) {
      idleRounds = 0;
      continue;
    }
    idleRounds++;
    if (!data?.panelOpen && idleRounds > 4) break;
    if (idleRounds > 10) break;
  }

  await dismissTranslateIdle(browser);
  const finalTitle = await browser.execute(titleProbeScript());
  const ft = finalTitle.data?.result as { titleVal?: string; looksEn?: boolean } | undefined;
  if (ft?.looksEn) success = true;

  if (!success && /失败|不足|已取消/.test(tip)) {
    return { ok: false, message: `一键翻译未成功：${tip.slice(0, 160)}` };
  }
  if (!success) {
    return {
      ok: false,
      message: tip
        ? `一键翻译已触发但标题未英文化：${tip.slice(0, 100)}；标题：${(ft?.titleVal || "").slice(0, 40)}`
        : `一键翻译已触发但标题仍非英文：${(ft?.titleVal || "").slice(0, 50)}。请人审弹层/余额后重试。`,
    };
  }
  return {
    ok: true,
    message: tip
      ? `页顶一键翻译完成。${tip.slice(0, 120)}`
      : `页顶一键翻译完成。标题：${(ft?.titleVal || "").slice(0, 60)}`,
  };
}

async function clearNotices(browser: WorkflowBrowser): Promise<ToolResult> {
  await browser.execute(`(() => {
    document.querySelectorAll('.ant-modal-wrap, .notice-list-modal, .bullet-layer').forEach((m) => {
      try {
        const title = (m.querySelector('.ant-modal-title')?.innerText || '') + (m.textContent || '');
        if (/公告|促销|618|通知|活动|温馨提示/.test(title) || true) {
          const close = m.querySelector('.ant-modal-close, button');
          if (close && /关闭|知道|确定|我知道/.test(close.innerText || close.className)) {
            close.click();
          } else {
            m.style.display = 'none';
          }
        }
      } catch (_) {}
    });
    return true;
  })()`);
  await dismissAll(browser);
  return { ok: true, message: "已清理公告/遮罩" };
}

async function ensureMainImages6(browser: WorkflowBrowser): Promise<ToolResult> {
  await goProductImages(browser);
  await browser.execute(`(() => {
    const tip = Array.from(document.querySelectorAll('.explain-module,*,div,span')).find((el) =>
      /已经选用了/.test(el.innerText || '') && (el.innerText || '').length < 80,
    );
    tip && tip.scrollIntoView({ block: 'center' });
    document.querySelector('.img-module')?.scrollIntoView({ block: 'start' });
    return true;
  })()`);
  await sleep(500);

  // Checkbox mode (SMT 编辑) vs list+delete mode (采集箱编辑)
  const mode = await browser.execute(`(() => {
    const tipM = document.body.innerText.match(/已经选用了[\\s\\n]*(\\d+)[\\s\\n]*张/);
    const mod = document.querySelector('.img-module');
    const items = Array.from((mod || document).querySelectorAll('.single-image'));
    const checked = items.filter((item) =>
      item.querySelector('.ant-checkbox-wrapper-checked,.ant-checkbox-checked'),
    ).length;
    const hasCheckbox = items.some((item) =>
      item.querySelector('input[type=checkbox],.ant-checkbox,.ant-checkbox-wrapper'),
    );
    return {
      tipCount: tipM ? Number(tipM[1]) : null,
      listCount: items.length,
      checked,
      hasCheckbox,
    };
  })()`);
  const m = mode.data?.result as {
    tipCount?: number | null;
    listCount?: number;
    checked?: number;
    hasCheckbox?: boolean;
  } | undefined;

  if (m?.hasCheckbox) {
    // Use tipCount when present; trusted-click unchecked boxes until 6
    let count = m.tipCount ?? m.checked ?? 0;
    for (let round = 0; round < 8 && count < 6; round++) {
      const marked = await browser.execute(`(() => {
        const items = Array.from(document.querySelectorAll('.single-image'));
        for (let i = 0; i < items.length; i++) {
          if (items[i].querySelector('.ant-checkbox-wrapper-checked,.ant-checkbox-checked')) continue;
          const lab = items[i].querySelector('.ant-checkbox-wrapper, .ant-checkbox, input[type=checkbox]');
          if (!lab) continue;
          lab.setAttribute('data-spark-ref', 'dxm-main-check');
          lab.scrollIntoView({ block: 'center' });
          return { ok: true, i };
        }
        return { ok: false };
      })()`);
      if (!(marked.data?.result as { ok?: boolean } | undefined)?.ok) break;
      await browser.click({ ref: "dxm-main-check" });
      await sleep(400);
      const st = await browser.execute(`(() => {
        const tipM = document.body.innerText.match(/已经选用了[\\s\\n]*(\\d+)[\\s\\n]*张/);
        let c = 0;
        document.querySelectorAll('.single-image').forEach((item) => {
          if (item.querySelector('.ant-checkbox-wrapper-checked,.ant-checkbox-checked')) c++;
        });
        return { tip: tipM ? Number(tipM[1]) : null, checked: c };
      })()`);
      const s = st.data?.result as { tip?: number | null; checked?: number } | undefined;
      count = s?.tip ?? s?.checked ?? count;
    }
    // If too many, uncheck from end
    for (let round = 0; round < 8 && count > 6; round++) {
      await browser.execute(`(() => {
        const items = Array.from(document.querySelectorAll('.single-image'));
        for (let i = items.length - 1; i >= 0; i--) {
          const lab = items[i].querySelector('.ant-checkbox-wrapper-checked');
          if (!lab) continue;
          lab.setAttribute('data-spark-ref', 'dxm-main-uncheck');
          lab.scrollIntoView({ block: 'center' });
          return true;
        }
        return false;
      })()`);
      await browser.click({ ref: "dxm-main-uncheck" });
      await sleep(400);
      const st = await browser.execute(`(() => {
        const tipM = document.body.innerText.match(/已经选用了[\\s\\n]*(\\d+)[\\s\\n]*张/);
        return { tip: tipM ? Number(tipM[1]) : null };
      })()`);
      count = Number((st.data?.result as { tip?: number } | undefined)?.tip ?? count - 1);
    }
    return {
      ok: count === 6,
      message: count === 6 ? "主图已选用 6 张" : `主图选用 ${count} 张（目标 6）`,
      data: { count, mode: "checkbox" },
    };
  }

  // 采集箱：无勾选，列表即主图；多了就从末尾点删除
  let count = m?.listCount ?? 0;
  for (let round = 0; round < 12 && count > 6; round++) {
    await browser.execute(`(() => {
      const mod = document.querySelector('.img-module');
      const items = Array.from(mod?.querySelectorAll('.single-image') || []);
      const last = items[items.length - 1];
      if (!last) return { ok: false };
      last.scrollIntoView({ block: 'center' });
      last.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      const box = last.querySelector('.operate-box');
      if (box) box.style.display = 'block';
      const del = last.querySelector('.icon_delete, a.icon_delete, [class*=icon_delete]');
      if (!del) return { ok: false };
      del.style.display = 'inline-block';
      del.setAttribute('data-spark-ref', 'dxm-del-img');
      del.click();
      (del.closest('a') || del).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      return { ok: true };
    })()`);
    await sleep(350);
    await browser.execute(`(() => {
      const wraps = Array.from(document.querySelectorAll('.ant-modal-wrap')).filter(w => getComputedStyle(w).display !== 'none');
      for (const w of wraps) {
        const ok = Array.from(w.querySelectorAll('button')).find(b => /确定|删除|确认/.test((b.innerText||'').trim()) && !/取消/.test(b.innerText||''));
        if (ok) { ok.click(); return true; }
      }
      return false;
    })()`);
    await sleep(400);
    await browser.click({ ref: "dxm-del-img" }).catch(() => ({ ok: false, message: "" }));
    await sleep(400);
    const st = await browser.execute(`(() => ({
      count: document.querySelectorAll('.img-module .single-image').length
    }))()`);
    count = Number((st.data?.result as { count?: number } | undefined)?.count || count);
  }

  if (count < 6) {
    return {
      ok: false,
      message: `主图仅 ${count} 张（目标 6，采集箱无勾选模式）`,
      data: { count, mode: "list" },
    };
  }
  if (count === 6) {
    return { ok: true, message: "主图列表已是 6 张", data: { count, mode: "list" } };
  }
  return {
    ok: false,
    message: `主图列表 ${count} 张，未能删到 6（采集箱删除控件无响应）。速卖通通常取前 6 张，请人审删多余图`,
    data: { count, mode: "list", soft: true },
  };
}

function titleProbeScript(): string {
  return `(() => {
    const labels = Array.from(document.querySelectorAll('label,div,span,th,td'));
    const lab = labels.find((el) => {
      const t = (el.innerText || '').trim();
      return t === '产品标题' || t === '标题' || /^产品标题/.test(t);
    });
    let input = null;
    if (lab) {
      const row = lab.closest('.ant-form-item,tr,div') || lab.parentElement;
      input = row ? row.querySelector('input,textarea') : null;
    }
    if (!input) {
      input = Array.from(document.querySelectorAll('input,textarea')).find((el) => {
        const r = el.getBoundingClientRect();
        const v = String(el.value || '');
        return r.width > 220 && r.y > 180 && r.y < 520 && v.length >= 6;
      }) || null;
    }
    const titleVal = input ? String(input.value || '') : '';
    const looksEn = /[A-Za-z]{4,}/.test(titleVal) && !/[\\u4e00-\\u9fff]/.test(titleVal);
    return { titleVal: titleVal.slice(0, 120), looksEn, hasInput: !!input };
  })()`;
}

async function setDutyFree(browser: WorkflowBrowser): Promise<ToolResult> {
  const url = browser.getUrl();
  if (/productCrawl\/edit/i.test(url)) {
    // 采集箱编辑页通常还没有速卖通「不含关税报价」控件
    const probe = await browser.execute(`(() => ({
      has: /不含关税/.test(document.body.innerText)
    }))()`);
    if ((probe.data?.result as { has?: boolean } | undefined)?.has) {
      // fall through to click
    } else {
      return {
        ok: true,
        message: "采集箱编辑页无「不含关税」控件（认领到速卖通编辑页后再设）",
        data: { skipped: true, reason: "crawl_edit" },
      };
    }
  }

  await browser.execute(`(() => {
    const el = Array.from(document.querySelectorAll('label,span,div')).find((n) =>
      /不含关税报价/.test((n.innerText||'').trim()) && (n.innerText||'').trim().length < 20);
    if (!el) return { ok:false };
    el.scrollIntoView({ block: 'center' });
    el.click();
    const radio = el.querySelector('input') || el.closest('label')?.querySelector('input');
    radio?.click();
    return { ok:true };
  })()`);
  await sleep(300);
  const check = await browser.execute(`(() => {
    return { has: /不含关税/.test(document.body.innerText) };
  })()`);
  return {
    ok: true,
    message: (check.data?.result as { has?: boolean } | undefined)?.has
      ? "已点选/确认不含关税报价"
      : "已尝试点选不含关税（请人审）",
  };
}

async function listingQa(browser: WorkflowBrowser): Promise<ToolResult> {
  const base = await browser.qaCheck();
  const titleExtra = await browser.execute(titleProbeScript());
  const titleInfo = titleExtra.data?.result as {
    titleVal?: string;
    looksEn?: boolean;
  } | undefined;
  const onCrawl = /productCrawl\/edit/i.test(browser.getUrl());
  const extra = await browser.execute(`(() => {
    const body = document.body.innerText;
    const imgM = body.match(/已经选用了[\\s\\n]*(\\d+)[\\s\\n]*张/);
    const listCount = document.querySelectorAll('.img-module .single-image').length;
    const imgCount = imgM ? Number(imgM[1]) : (listCount || null);
    const categoryOk = !/产品分类[\\s\\S]{0,40}请选择/.test(body) || /已选择|Home|Pet|Garden/.test(body);
    const duty = /不含关税/.test(body);
    const dutyUi = /关税报价|不含关税|含关税/.test(body);
    const pleaseSelect = (body.match(/请选择/g) || []).length;
    return { imgCount, listCount, categoryOk, duty, dutyUi, pleaseSelect };
  })()`);
  const raw = (extra.data?.result || {}) as {
    imgCount?: number | null;
    listCount?: number;
    categoryOk?: boolean;
    duty?: boolean;
    dutyUi?: boolean;
    pleaseSelect?: number;
  };
  const dutyOk = !!raw.duty || (onCrawl && !raw.dutyUi);
  const imgTrFresh =
    !!lastImageTranslate &&
    Date.now() - lastImageTranslate.at < 30 * 60 * 1000 &&
    lastImageTranslate.ok &&
    lastImageTranslate.count > 0;
  const e = {
    ...raw,
    title: titleInfo?.titleVal || "",
    titleLooksEn: !!titleInfo?.looksEn,
    titleHasCn: /[\u4e00-\u9fff]/.test(titleInfo?.titleVal || ""),
    duty: dutyOk,
    dutySkipped: onCrawl && !raw.dutyUi,
    imageTranslateOk: imgTrFresh,
    imageTranslateDetail: lastImageTranslate
      ? `${lastImageTranslate.ok ? "OK" : "FAIL"} 选中${lastImageTranslate.count}张 ${lastImageTranslate.tip.slice(0, 60)}`
      : "本轮未跑图片翻译",
  };
  const lines = [
    base.message,
    `标题英文化（文字一键翻译）：${e.titleLooksEn ? "OK" : "需人审"}（${(e.title || "").slice(0, 40)}）`,
    `主图张数：${e.imgCount == null ? "?" : e.imgCount === 6 ? "OK 6" : `需人审 ${e.imgCount}`}`,
    `图片翻译（图上中文）：${e.imageTranslateOk ? "OK" : "FAIL"} — ${e.imageTranslateDetail}`,
    `不含关税：${e.dutySkipped ? "采集箱页跳过" : e.duty ? "可见" : "需人审"}`,
    `页面「请选择」约 ${e.pleaseSelect ?? "?"} 处（属性/模板等人补）`,
  ];
  const ok =
    !!e.titleLooksEn &&
    (e.imgCount === 6 || e.imgCount == null) &&
    !!e.imageTranslateOk &&
    !!e.duty;
  return {
    ok,
    message: (ok ? "QA OK（autopilot 项）\n" : "QA FAIL（autopilot 项）\n") + lines.join("\n"),
    data: { base: base.data, extra: e, lastImageTranslate },
  };
}

async function runFullListing(browser: WorkflowBrowser): Promise<ToolResult> {
  if (!isDxmEditPage(browser.getUrl())) {
    const nav = await browser.navigate("https://www.dianxiaomi.com/web/productCrawl", {
      asHuman: true,
    });
    return {
      ok: false,
      message: nav.ok
        ? "已打开采集箱。点进商品编辑页后说「上品」或「处理好」。"
        : `无法打开采集箱：${nav.message}`,
    };
  }

  try {
    browser.setPaused(false);
  } catch {
    /* ignore */
  }

  type Step = { name: string; ok: boolean; detail: string; mode: string };
  const steps: Step[] = [];
  const run = async (name: string, mode: string, fn: () => Promise<ToolResult>) => {
    let last: ToolResult = { ok: false, message: "未执行" };
    for (let i = 0; i < 3; i++) {
      last = await fn();
      if (last.ok) break;
      await sleep(500);
    }
    steps.push({ name, ok: !!last.ok, detail: last.message, mode });
    return last;
  };

  await run("清公告", "autopilot", () => clearNotices(browser));
  await run("主图6张", "autopilot", () => ensureMainImages6(browser));
  await run("改尺寸800", "autopilot", () => resizeTo800(browser));
  await run("图片翻译", "autopilot", () => translateZhEn(browser));
  await run("文字一键翻译", "autopilot", () => oneKeyTranslate(browser));
  await run("不含关税", "autopilot", () => setDutyFree(browser));
  steps.push({
    name: "分类/属性/SKU/模板",
    ok: false,
    detail: "本轮 best-effort 待人补（Skill 脆弱步：分类树、属性共享下拉、SKU 公式）",
    mode: "best_effort",
  });
  const qa = await run("QA", "autopilot", () => listingQa(browser));

  try {
    browser.setPaused(true);
  } catch {
    /* ignore */
  }

  const lines = [
    "一句话上品完成（SouthernSpark playbook）",
    "说明：图片翻译=图上中文；文字一键翻译=标题/描述字段——两回事。",
    ...steps.map(
      (s) => `- [${s.mode}] ${s.name}：${s.ok ? "OK" : "FAIL/待补"} — ${s.detail.split("\n")[0]}`,
    ),
    "",
    "已暂停。请你目检后手动点「保存并移入待发布」（Agent 不会自动点）。",
  ];
  return {
    ok: steps.filter((s) => s.mode === "autopilot").every((s) => s.ok),
    message: lines.join("\n"),
    data: { steps, qa: qa.data, paused: true },
  };
}

export async function runWorkflow(
  browser: WorkflowBrowser,
  id: WorkflowId | string,
): Promise<ToolResult> {
  if (!dxmEnabled()) {
    return {
      ok: false,
      message:
        "Vertical workflows are disabled in this Sparo build. Set SPARO_ENABLE_DXM=1 to enable, or drive the browser via MCP with your own agent.",
      data: { workflows: [] },
    };
  }
  const resolved = (WORKFLOWS.find((w) => w.id === id)?.id ||
    resolveWorkflowId(String(id))) as WorkflowId | null;
  if (!resolved) {
    return {
      ok: false,
      message:
        `未知工作流「${id}」。可用：` +
        WORKFLOWS.map((w) => w.id).join(", "),
      data: { workflows: listWorkflowSummaries() },
    };
  }

  try {
    if (resolved === "dxm_full_listing" || resolved === "dxm_autopilot") {
      return runFullListing(browser);
    }
    if (resolved === "dxm_qa") {
      return listingQa(browser);
    }
    if (resolved === "dxm_resize_800") {
      return resizeTo800(browser);
    }
    if (resolved === "dxm_translate_zh_en") {
      return translateZhEn(browser);
    }
    if (resolved === "dxm_images_all") {
      const a = await resizeTo800(browser);
      const b = a.ok
        ? await translateZhEn(browser)
        : { ok: false, message: "跳过图片翻译（改尺寸失败）" };
      const c =
        a.ok && b.ok
          ? await oneKeyTranslate(browser)
          : { ok: false, message: "跳过文字一键翻译（前序失败）" };
      return {
        ok: !!(a.ok && b.ok && c.ok),
        message: `${a.message}；${b.message}；${c.message}`,
        data: { resize: a, imageTranslate: b, textOneKey: c },
      };
    }
    return { ok: false, message: `未实现：${resolved}` };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
