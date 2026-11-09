/** 认领弹窗只读。选择器没经采样回填时，live 认领必须停等，这里不点任何按钮。 */

export const SMT_CLAIM_TEXT = {
  saveAndClaim: "保存并认领",
  dialogTitle: "选择店铺-认领到采集箱",
  confirm: "确定",
  cancel: "关闭",
};

/** 附录 A 已核对的弹窗结构。shopId 不在 DOM 里。 */
export const SMT_CLAIM_DOM = {
  container: ".ant-modal-wrap .ant-modal",
  option: "label.ant-checkbox-wrapper",
  selectedCount: "span.inline-block.p-left5.h16",
  shopName: "div.flex.w-145",
};

export function claimSelectorsReady(): boolean {
  return Boolean(
    SMT_CLAIM_TEXT.dialogTitle
    && SMT_CLAIM_TEXT.confirm
    && SMT_CLAIM_DOM.container
    && SMT_CLAIM_DOM.option,
  );
}

export type ClaimShopOption = {
  name: string;
  shopId: string;
  selected?: boolean;
};

export type ClaimDialogRead = {
  opened: boolean;
  title: string;
  options: ClaimShopOption[];
  selected: string;
  confirmPresent: boolean;
  confirmText: string;
  cancelText: string;
  selectedLabel?: string;
  error: string;
};

export type ClaimProof = {
  draftId?: string;
  shopId?: string;
  recordId?: string;
};

/** 只读弹窗。不点确定、关闭或店铺。隐藏勾选不读。 */
export const READ_CLAIM_DIALOG_SCRIPT = `(() => {
  const dialog = document.querySelector(${JSON.stringify(SMT_CLAIM_DOM.container)});
  const titleNode = dialog && dialog.querySelector(".ant-modal-title");
  const textOf = (node) => ((node && node.innerText) || "").trim();
  const visible = (el) => {
    if (!el || el.offsetParent === null) return false;
    const style = window.getComputedStyle(el);
    return style.display !== "none" && style.visibility !== "hidden";
  };
  const options = dialog ? [...dialog.querySelectorAll(${JSON.stringify(SMT_CLAIM_DOM.option)})].filter(visible).map((label) => {
    const input = label.querySelector("input");
    const nameNode = label.querySelector(${JSON.stringify(SMT_CLAIM_DOM.shopName)});
    return {
      name: textOf(nameNode),
      shopId: "",
      selected: Boolean(input && input.checked),
    };
  }).filter((item) => item.name) : [];
  const buttons = dialog ? [...dialog.querySelectorAll("button")].filter(visible) : [];
  const confirmLabel = ${JSON.stringify(SMT_CLAIM_TEXT.confirm)};
  const cancelLabel = ${JSON.stringify(SMT_CLAIM_TEXT.cancel)};
  const confirm = buttons.find((button) => textOf(button) === confirmLabel);
  const closeButton = buttons.find((button) => textOf(button) === cancelLabel);
  const countNode = dialog && dialog.querySelector(${JSON.stringify(SMT_CLAIM_DOM.selectedCount)});
  const alert = dialog && dialog.querySelector(".ant-alert, .ant-form-item-explain-error");
  return {
    opened: textOf(titleNode) === ${JSON.stringify(SMT_CLAIM_TEXT.dialogTitle)},
    title: textOf(titleNode),
    options,
    selected: (options.find((item) => item.selected) || {}).name || "",
    confirmPresent: Boolean(confirm),
    confirmText: textOf(confirm),
    cancelText: textOf(closeButton),
    selectedLabel: textOf(countNode),
    error: textOf(alert),
  };
})()`;

export const CLICK_SAVE_AND_CLAIM_SCRIPT = `(() => {
  const label = ${JSON.stringify(SMT_CLAIM_TEXT.saveAndClaim)};
  const button = [...document.querySelectorAll("button")].find((el) => (el.innerText || "").trim() === label && !el.closest("tr"));
  if (!button) return { marker: "sparo-claim-open", clicked: false };
  button.click();
  return { marker: "sparo-claim-open", clicked: true };
})()`;

export function clickClaimShopScript(name: string): string {
  return `(() => {
    const name = ${JSON.stringify(name)};
    const visible = (el) => el && el.offsetParent !== null;
    const labels = [...document.querySelectorAll(${JSON.stringify(SMT_CLAIM_DOM.option)})].filter(visible);
    const label = labels.find((el) => {
      const node = el.querySelector(${JSON.stringify(SMT_CLAIM_DOM.shopName)});
      return ((node && node.innerText) || "").trim() === name;
    });
    if (!label) return { marker: "sparo-claim-shop", clicked: false };
    const input = label.querySelector("input");
    if (input && input.checked) return { marker: "sparo-claim-shop", clicked: false, already: true };
    label.click();
    return { marker: "sparo-claim-shop", clicked: true };
  })()`;
}

export const CLICK_CLAIM_CONFIRM_SCRIPT = `(() => {
  const label = ${JSON.stringify(SMT_CLAIM_TEXT.confirm)};
  const button = [...document.querySelectorAll("button.ant-btn-primary")].find((el) => el.offsetParent !== null && (el.innerText || "").trim() === label);
  if (!button) return { marker: "sparo-claim-confirm", clicked: false };
  button.click();
  return { marker: "sparo-claim-confirm", clicked: true };
})()`;

/** 三证只认 data 属性和速卖通编辑页 URL 上的草稿号。读不到就空着，不猜。 */
export const READ_CLAIM_PROOF_SCRIPT = `(() => {
  const dialog = document.querySelector(${JSON.stringify(SMT_CLAIM_DOM.container)});
  const titleNode = dialog && dialog.querySelector(".ant-modal-title");
  const titleText = ((titleNode && titleNode.innerText) || "").trim();
  const errorNode = dialog && dialog.querySelector(".ant-alert, .ant-form-item-explain-error");
  const marked = document.querySelector("[data-draft-id]");
  const attr = (node, key) => (node && node.getAttribute && node.getAttribute(key)) || "";
  let draftFromUrl = "";
  try {
    const parsed = new URL(location.href);
    if (/\\/web\\/smt\\/edit/i.test(parsed.pathname)) draftFromUrl = parsed.searchParams.get("id") || "";
  } catch (error) {
    draftFromUrl = "";
  }
  return {
    marker: "sparo-claim-proof",
    dialogOpen: titleText === ${JSON.stringify(SMT_CLAIM_TEXT.dialogTitle)},
    error: ((errorNode && errorNode.innerText) || "").trim(),
    draftId: attr(marked, "data-draft-id") || draftFromUrl,
    shopId: attr(marked, "data-draft-shop-id"),
    recordId: attr(marked, "data-record-id"),
    url: location.href || "",
  };
})()`;

export function readClaimDialogFromHtml(html: string): ClaimDialogRead {
  const start = html.search(/<div\b[^>]*class="[^"]*ant-modal[^"]*"/i);
  const block = start >= 0 ? html.slice(start) : "";
  const title = /<div class="ant-modal-title">([^<]*)<\/div>/i.exec(block)?.[1]?.trim() || "";
  const options = [...block.matchAll(/<label\b[^>]*class="[^"]*ant-checkbox-wrapper[^"]*"[^>]*>([\s\S]*?)<\/label>/gi)].flatMap((match) => {
    const raw = match[0] || "";
    const inner = match[1] || "";
    if (/style="[^"]*display\s*:\s*none/i.test(raw)) return [];
    const name = /<div class="flex w-145">([^<]*)<\/div>/i.exec(inner)?.[1]?.trim() || "";
    if (!name) return [];
    const selected = /<input\b[^>]*\bchecked\b/i.test(inner);
    return [{ name, shopId: "", selected }];
  });
  const confirm = /<button\b[^>]*class="[^"]*ant-btn-primary[^"]*"[^>]*>\s*([^<]*?)\s*<\/button>/i.exec(block)?.[1]?.trim() || "";
  const cancel = /<button\b[^>]*class="[^"]*ant-btn-default[^"]*"[^>]*>\s*([^<]*?)\s*<\/button>/i.exec(block)?.[1]?.trim() || "";
  const selectedLabel = /<span class="inline-block p-left5 h16">([^<]*)<\/span>/i.exec(block)?.[1]?.trim() || "";
  const error = /<div class="(?:ant-alert|ant-form-item-explain-error)">([^<]*)<\/div>/i.exec(block)?.[1]?.trim() || "";
  return {
    opened: title === SMT_CLAIM_TEXT.dialogTitle,
    title,
    options,
    selected: options.find((item) => item.selected)?.name || "",
    confirmPresent: confirm === SMT_CLAIM_TEXT.confirm,
    confirmText: confirm === SMT_CLAIM_TEXT.confirm ? confirm : "",
    cancelText: cancel === SMT_CLAIM_TEXT.cancel ? cancel : "",
    selectedLabel,
    error,
  };
}

export function claimDialogIssue(read: ClaimDialogRead): string | undefined {
  if (!read.opened) return "点保存并认领后没有出现认领弹窗，已停等";
  if (!read.options.length) return "认领弹窗读不到候选店铺，已停等";
  if (!read.confirmPresent) return "认领弹窗找不到确定按钮，已停等";
  return undefined;
}

/** shopId 精确优先，其次店名精确。0 条或多条都停等，不默认第一家。 */
export function pickClaimShop(
  options: ClaimShopOption[],
  target: { shopId?: string; shopName?: string },
): { ok: true; shop: ClaimShopOption } | { ok: false; reason: string } {
  const shops = options.filter((item) => item.shopId || item.name);
  const names = shops.map((item) => item.name || item.shopId).join("、");
  const byId = target.shopId ? shops.filter((item) => item.shopId === target.shopId) : [];
  if (byId.length === 1 && byId[0]) return { ok: true, shop: byId[0] };
  if (byId.length > 1) return { ok: false, reason: `目标店铺匹配了多家，候选：${names}` };
  const byName = target.shopName ? shops.filter((item) => item.name === target.shopName) : [];
  if (byName.length === 1 && byName[0]) return { ok: true, shop: byName[0] };
  if (byName.length > 1) return { ok: false, reason: `目标店铺匹配了多家，候选：${names}` };
  return { ok: false, reason: `没有匹配到目标店铺，候选：${names || "无"}` };
}

export function planClaim(
  read: ClaimDialogRead,
  target: { shopId?: string; shopName?: string },
): { ok: true; clicks: string[]; shop: ClaimShopOption } | { ok: false; clicks: string[]; reason: string } {
  const openClick = [SMT_CLAIM_TEXT.saveAndClaim];
  const issue = claimDialogIssue(read);
  if (issue) return { ok: false, clicks: openClick, reason: issue };
  const picked = pickClaimShop(read.options, target);
  if (!picked.ok) return { ok: false, clicks: openClick, reason: picked.reason };
  const extra = extraCheckedIssue(read.options, picked.shop);
  if (extra) return { ok: false, clicks: openClick, reason: extra };
  const clicks = picked.shop.selected
    ? [...openClick, read.confirmText]
    : [...openClick, picked.shop.name, read.confirmText];
  return { ok: true, clicks, shop: picked.shop };
}

/** 目标店以外还有可见勾选就停等。不代用户取消。shopId 不在弹窗里时按店名比。 */
export function extraCheckedIssue(options: ClaimShopOption[], shop: ClaimShopOption): string | undefined {
  const same = (item: ClaimShopOption) => (item.shopId && shop.shopId ? item.shopId === shop.shopId : item.name === shop.name);
  const others = options.filter((item) => item.selected && !same(item));
  if (!others.length) return undefined;
  const selectedCount = options.filter((item) => item.selected).length;
  return `认领弹窗里有其他店铺被勾选（已选 ${selectedCount}），已停等`;
}

export function claimProofIssue(
  proof: ClaimProof,
  target: { shopId?: string; recordId?: string },
): string | undefined {
  if (!proof.draftId || !proof.shopId || !proof.recordId) return "认领后读回不到草稿，不得进入编辑完成";
  if (target.shopId && proof.shopId !== target.shopId) return "认领返回的店铺和目标不一致，不会进入编辑";
  if (target.recordId && proof.recordId !== target.recordId) return "认领后来源关系没有读回，不会把草稿写成已认领";
  return undefined;
}
