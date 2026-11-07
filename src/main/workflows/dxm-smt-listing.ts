/** 店小秘到速卖通新链路。准备和发布分开。收费和发布都不在本地记布尔值。 */
import type { ToolResult } from "../../shared/types.js";
import {
  applyStatusEvidence,
  applyTransition,
  bindTabs,
  createWorkOrder,
  hasOpenPublishAttempt,
  isClosedOrder,
  openOrderMatch,
  parkFailed,
  parkHuman,
  stateLabel,
  type DxmListingState,
  type DxmListingWorkOrder,
  type FieldProvenance,
} from "./dxm-smt-contract.js";
import {
  acceptBusinessValue,
  alignSkus,
  textReadbackIssues,
  translationRisks,
  type FieldDef,
  type FieldSnapshot,
  type ImageGroupName,
  type ImageSlot,
} from "./dxm-smt-fields.js";
import { fingerprintFromSnapshot } from "./dxm-smt-fingerprint.js";
import {
  consumePaidConfirm,
  decidePaidAction,
  dismissMayCancel,
  imageEvidenceStatus,
  resetPaidConfirms,
} from "./dxm-smt-images.js";
import { commitOrder, loadOrder, replayOrders } from "./dxm-smt-journal.js";
import { classifyPage, editTabWritable, entersSmtQa, publishIdentityMatches, resolveIdentity, type PageProbe } from "./dxm-smt-page.js";
import { isDxmSmtWorkflowId } from "./dxm-smt-preview.js";
import { evaluateQa, prepareSummary, qaStillValid } from "./dxm-smt-qa.js";

export type DraftLookup = {
  status: "found" | "absent" | "ambiguous" | "unknown";
  draftId?: string;
  shopId?: string;
};

export type DxmSmtPort = {
  tabId: string;
  sourceTabId?: string;
  signal?: AbortSignal;
  isPaused?: () => boolean;
  journalDir: string;
  /** 页面上当前可读的收费金额。和确认句柄里的费用不一致就不执行。 */
  quotedFee?: string;
  /** 测试用：准备持锁后、写回前暂停。 */
  hold?: () => Promise<void>;
  beforeClick?: () => void;
  readProbe: (tabId: string) => Promise<PageProbe>;
  listTabs: () => Promise<Array<{ id: string; url: string; closed?: boolean }>>;
  lookupDraft?: (input: { recordId?: string; shopId?: string; tabId: string }) => Promise<DraftLookup>;
  claim: (input: { recordId?: string; shopId?: string; shopName?: string; tabId: string }) => Promise<{
    ok: boolean;
    draftId?: string;
    shopId?: string;
    shopName?: string;
    message: string;
    blocker?: "auth" | "entry" | "timeout" | "not_found";
  }>;
  readFields: (tabId: string) => Promise<FieldSnapshot>;
  writeField: (tabId: string, key: string, value: string) => Promise<{ ok: boolean; readback?: string }>;
  translateText: (tabId: string) => Promise<{ ok: boolean; verified: boolean }>;
  translateImages: (
    tabId: string,
    group: ImageGroupName,
    feature: "图片翻译" | "图片白底",
  ) => Promise<{ ok: boolean; verified: boolean }>;
  dismissPopups: (tabId: string, imageBusy: boolean) => Promise<{ cancelled: boolean }>;
  saveDraft: (tabId: string) => Promise<{
    ok: boolean;
    message: string;
    readback?: string;
    receipt?: { kind: "draft"; text?: string };
  }>;
  clickPublish: (tabId: string) => Promise<{
    ok: boolean;
    message: string;
    receipt?: DxmListingWorkOrder["receipt"];
  }>;
  queryStatus: (order: DxmListingWorkOrder) => Promise<{
    submitRecord?: { text: string; productId?: string };
    failureRecord?: { text: string; field?: string };
    platformProductId?: string;
    online?: { productId: string; shopId: string; url: string };
  }>;
  selectCategory?: (tabId: string, categoryId: string) => Promise<{ ok: boolean; message: string }>;
};

const tails = new Map<string, Promise<void>>();
const publishBusy = new Set<string>();

export function resetDxmSmtRuntime(): void {
  tails.clear();
  publishBusy.clear();
  resetPaidConfirms();
}

export async function runDxmSmtWorkflow(input: {
  id: string;
  params?: Record<string, unknown>;
  port: DxmSmtPort;
}): Promise<ToolResult> {
  const params = input.params || {};
  if (!isDxmSmtWorkflowId(input.id)) {
    return { ok: false, message: "Free Soul 只接受店小秘速卖通白名单工作流", data: { refused: true } };
  }
  if (input.id === "dxm_smt_probe") return runProbe(input.port);
  if (input.id === "dxm_smt_prepare") return runPrepare(input.port, params);
  if (input.id === "dxm_smt_status") return runStatus(input.port, params);
  return runPublish(input.port, params);
}

function withOrder<T>(id: string, job: () => Promise<T>): Promise<T> {
  const prev = tails.get(id) ?? Promise.resolve();
  const run = prev.then(job, job);
  tails.set(id, run.then(() => undefined, () => undefined));
  return run;
}

async function runProbe(port: DxmSmtPort): Promise<ToolResult> {
  const probe = await port.readProbe(port.tabId);
  const page = classifyPage(probe);
  const identity = resolveIdentity(probe, {});
  const state = page.blocker || !identity.ok ? "waiting_human" : "observed";
  const reason = !identity.ok ? identity.reason : page.reason;
  return {
    ok: true,
    message: reason,
    data: { state, pageKind: page.kind, blocker: page.blocker, entersQa: entersSmtQa(page) },
  };
}

async function runPrepare(port: DxmSmtPort, params: Record<string, unknown>): Promise<ToolResult> {
  const sourceRecordId = text(params.sourceRecordId);
  const shopId = text(params.shopId);
  const requestedId = text(params.workOrderId);
  let id = requestedId;
  if (!id) {
    const match = openOrderMatch(replayOrders(port.journalDir), sourceRecordId, shopId);
    if (match.kind === "ambiguous") {
      return {
        ok: true,
        message: "同一来源和店铺有多个未关工作单，已停等，不会新建",
        data: { state: "waiting_human", ambiguous: true },
      };
    }
    if (match.kind === "one") id = match.order.id;
  }
  if (!id) id = `dxm-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`;
  return withOrder(id, () => prepareLocked(port, params, id));
}

async function prepareLocked(port: DxmSmtPort, params: Record<string, unknown>, id: string): Promise<ToolResult> {
  await port.hold?.();
  const sourceRecordId = text(params.sourceRecordId);
  const shopId = text(params.shopId);
  const shopName = text(params.shopName);
  let loaded = loadOrder(port.journalDir, id);
  let base = loaded?.revision ?? 0;
  let order = loaded || createWorkOrder({
    id,
    source: { crawlRecordId: sourceRecordId || undefined, productId: sourceRecordId || undefined },
    target: { platform: "aliexpress", shopId: shopId || undefined, shopNameSnapshot: shopName || undefined },
  });
  if (!loaded) base = 0;
  if (isClosedOrder(order)) return done(order, "该商品已上线，不会重复执行");
  if (order.state === "waiting_human" || order.state === "failed") {
    const back = order.checkpoint?.reliableState;
    if (!back) return finishStop(port, order, base, "没有可靠断点，不能续跑", `先查看工作单 ${order.id}`);
    const restored = applyTransition(order, back);
    if (!restored.ok) return finishStop(port, order, base, restored.reason || "断点不能恢复", `工作单 ${order.id} 先处理断点`);
    order = { ...restored.order, qa: undefined, draftFingerprint: undefined };
  }
  order = bindTabs(order, { sourceTabId: port.sourceTabId, editTabId: port.tabId });
  if (order.tabs.editTabId && port.tabId !== order.tabs.editTabId) {
    return finishStop(port, order, base, "当前执行标签不是工作单的编辑标签，已停等，不会在新标签继续", `回到工作单 ${order.id} 的原编辑标签`);
  }
  if (halted(port)) return finishStop(port, order, base, "任务已取消或暂停", `从工作单 ${order.id} 的断点续跑，不继续副作用`);

  const probe = await port.readProbe(port.tabId);
  const page = classifyPage(probe);
  if (page.kind === "not_dianxiaomi" || (page.blocker && page.blocker !== "fields_missing")) {
    return finishStop(port, order, base, page.reason, `处理页面后从工作单 ${order.id} 续跑`);
  }
  const identity = resolveIdentity(probe, {
    sourceRecordId: sourceRecordId || order.source.crawlRecordId,
    shopId: shopId || order.target.shopId,
    shopName: shopName || order.target.shopNameSnapshot,
    useCurrentEditPage: Boolean(params.useCurrentEditPage),
  });
  if (!identity.ok) return finishStop(port, order, base, identity.reason, `工作单 ${order.id}：请明确唯一商品和唯一店铺`);
  order = {
    ...order,
    source: { ...order.source, crawlRecordId: order.source.crawlRecordId || identity.recordId, productId: order.source.productId || identity.recordId },
    target: {
      ...order.target,
      shopId: order.target.shopId || identity.shopId,
      shopNameSnapshot: order.target.shopNameSnapshot || identity.shopName,
    },
  };

  const knownDraft = order.claimedDraftId || probe.draftId;
  if (!knownDraft) {
    const looked = await lookupClaim(port, order, identity.recordId, identity.shopId);
    if (looked.status === "ambiguous" || looked.status === "unknown") {
      return finishStop(port, order, base, "目标采集箱无法判重，已停等，不会认领", `工作单 ${order.id} 先确认是否已有同源草稿`);
    }
    if (looked.status === "found" && looked.draftId) {
      if (looked.shopId && identity.shopId && looked.shopId !== identity.shopId) {
        return finishStop(port, order, base, "查到的草稿店铺和目标不一致，不会进入编辑", `工作单 ${order.id} 先核对店铺`);
      }
      order = {
        ...order,
        claimedDraftId: looked.draftId,
        claim: { startedAt: order.claim?.startedAt, resolved: true, draftId: looked.draftId },
      };
      order = evidence(order, "claim", looked, { draftId: looked.draftId }, true);
    } else if (order.claim?.startedAt && !order.claim.resolved) {
      return finishStop(port, order, base, "上次认领结果未落账，目标箱也查不到草稿，不会再次认领", `工作单 ${order.id} 先到采集箱核对`);
    } else {
      if (halted(port)) return finishStop(port, order, base, "认领前已取消或暂停", `从工作单 ${order.id} 续跑，不继续副作用`);
      order = {
        ...evidence(order, "claim_attempt_started", { recordId: identity.recordId, shopId: identity.shopId }, { started: true }, false),
        claim: { startedAt: Date.now(), resolved: false },
      };
      const started = await persist(port, order, base);
      if (started.stale) return latestResult(started.order);
      order = started.order;
      base = started.base;
      const claimed = await port.claim({
        recordId: identity.recordId,
        shopId: identity.shopId,
        shopName: identity.shopName,
        tabId: port.tabId,
      });
      if (claimed.draftId) order = { ...order, claimedDraftId: claimed.draftId };
      const shopOk = Boolean(claimed.shopId && identity.shopId && claimed.shopId === identity.shopId);
      order = evidence(order, "claim", { recordId: identity.recordId, shopId: identity.shopId }, claimed, Boolean(claimed.ok && claimed.draftId && shopOk));
      if (halted(port)) return finishStop(port, order, base, "认领后已取消或暂停", `从工作单 ${order.id} 续跑，不继续保存或发布`);
      if (!claimed.ok || claimed.blocker) {
        return finishStop(port, order, base, claimed.message || "认领停等", `工作单 ${order.id}：排除授权、入口或超时后再续跑`);
      }
      if (!claimed.draftId) {
        return finishStop(port, order, base, "认领后读回不到草稿，不得进入编辑完成", `工作单 ${order.id}：先确认草稿是否出现`);
      }
      if (!shopOk) {
        return finishStop(port, order, base, "认领返回的店铺和目标不一致，不会进入编辑", `工作单 ${order.id} 先核对店铺`);
      }
      order = { ...order, claim: { startedAt: order.claim?.startedAt, resolved: true, draftId: claimed.draftId } };
    }
  } else {
    order = { ...order, claimedDraftId: knownDraft };
  }

  const tabs = await port.listTabs();
  const tabOk = editTabWritable(order, tabs);
  if (!tabOk.ok) return finishStop(port, order, base, tabOk.reason, `工作单 ${order.id}：不要刷新编辑页`);
  if (halted(port)) return finishStop(port, order, base, "编辑前已取消或暂停", `从工作单 ${order.id} 续跑，不继续副作用`);

  let snapshot = await port.readFields(port.tabId);
  const categoryId = text(params.categoryId);
  if (categoryId && snapshot.categoryId !== categoryId) {
    if (halted(port)) return finishStop(port, order, base, "选择分类前已取消", `从工作单 ${order.id} 续跑`);
    if (!port.selectCategory) {
      return finishStop(port, order, base, "没有分类选择入口，已停等", `工作单 ${order.id} 先确认分类控件`);
    }
    const selected = await port.selectCategory(port.tabId, categoryId);
    order = evidence(order, "select_category", { categoryId }, selected, false);
    if (!selected.ok) {
      return finishStop(port, order, base, selected.message || "分类选择失败，已停止后续写操作", `工作单 ${order.id} 先重选分类`);
    }
    snapshot = await port.readFields(port.tabId);
    const categoryOk = snapshot.categoryId === categoryId;
    order = evidence(order, "select_category_readback", { categoryId }, { categoryId: snapshot.categoryId }, categoryOk);
    if (!categoryOk) {
      return finishStop(port, order, base, "分类读回和目标不一致，已停止后续写操作", `工作单 ${order.id} 先核对分类`);
    }
  }

  const fields = snapshot.fields.map((field) => ({ ...field }));
  const missing = humanMissing(snapshot);
  for (const write of asWrites(params.writes)) {
    const accepted = acceptBusinessValue(write);
    if (!accepted.accepted) {
      missing.push({ field: write.key, reason: accepted.reason || "业务值不能采用", action: "请提供可靠来源或用户明确值" });
      order = evidence(order, "write_field", write, { accepted: false, reason: accepted.reason }, false);
      continue;
    }
    if (halted(port)) return finishStop(port, order, base, "写字段前已取消或暂停", `从工作单 ${order.id} 续跑`);
    const written = await port.writeField(port.tabId, write.key, write.value);
    const verified = Boolean(written.ok && written.readback === write.value);
    order = evidence(order, "write_field", write, written, verified);
    const provenance = asProvenance(write.provenance);
    const index = fields.findIndex((field) => field.key === write.key);
    const nextField: FieldDef = {
      key: write.key,
      group: index >= 0 ? fields[index]!.group : "基本信息",
      required: index >= 0 ? fields[index]!.required : true,
      value: write.value,
      verified,
      provenance,
    };
    if (index >= 0) fields[index] = nextField;
    else fields.push(nextField);
  }

  if (halted(port)) return finishStop(port, order, base, "文字翻译前已取消或暂停", `从工作单 ${order.id} 续跑`);
  const translated = await port.translateText(port.tabId);
  const reread = await port.readFields(port.tabId);
  const issues = textReadbackIssues({
    title: reread.title,
    description: reread.description,
    skuTokens: reread.skus.flatMap((row) => Object.values(row.specs)),
  });
  const textOk = Boolean(translated.ok && translated.verified && !issues.length && String(reread.title || "").trim());
  order = evidence(order, "translate_text", { ok: translated.ok }, { title: reread.title, description: reread.description, issues }, textOk);
  for (const field of fields) {
    const live = reread.fields.find((item) => item.key === field.key);
    if (!field.verified) continue;
    if (live && live.value !== undefined) field.value = live.value;
  }
  if (!textOk) {
    missing.push({
      field: "文字翻译",
      reason: issues[0] || "文字翻译没有读回",
      action: "请重新翻译并读回标题、属性和描述。文字翻译失败不能用图片翻译抵消。",
    });
  }
  const residue = translationRisks(reread.title || snapshot.title || "", [reread.brand || snapshot.brand || ""]);

  let images = cloneImages(reread.images.main.length || reread.images.variant.length || reread.images.description.length ? reread.images : snapshot.images);
  let paidNote = "";
  const consent = asConsent(params.paidConsent);
  if (consent) {
    const decision = decidePaidAction({
      feature: consent.feature,
      text: consent.text,
      workOrderId: order.id,
      scope: consent.scope,
      fee: consent.fee,
      confirmId: consent.confirmId,
      quotedFee: port.quotedFee,
    });
    const group = groupFromScope(consent.scope);
    if (!decision.execute || !decision.confirmId) {
      images = markGroup(images, group, "pending");
      paidNote = `工作单 ${order.id}：收费图片未确认或范围已变化，对应图片项未完成`;
      order = evidence(order, "translate_images", consent, { executed: false, reason: decision.reason }, false);
    } else if (consent.feature === "图片翻译" || consent.feature === "图片白底") {
      if (halted(port)) return finishStop(port, order, base, "收费动作前已取消", `工作单 ${order.id} 不扣费，图片项保持未完成`);
      consumePaidConfirm(decision.confirmId);
      if (!dismissMayCancel(true)) await port.dismissPopups(port.tabId, true);
      const doneImages = await port.translateImages(port.tabId, group, consent.feature);
      const verified = Boolean(doneImages.ok && doneImages.verified);
      images = markGroup(images, group, verified ? "verified" : imageEvidenceStatus(false));
      order = evidence(order, "translate_images", { feature: consent.feature, scope: consent.scope }, doneImages, verified);
      if (!verified) paidNote = `工作单 ${order.id}：图片处理已发起，尚未读回验证`;
    }
  }

  const skuAlign = alignSkus(reread.skus.length ? reread.skus : snapshot.skus);
  if (!skuAlign.ok) missing.push({ field: "SKU", reason: skuAlign.reason, action: "请核对规格、价格和库存，不能串行" });
  const view: FieldSnapshot = {
    ...reread,
    ...snapshot,
    title: reread.title || snapshot.title,
    description: reread.description || snapshot.description,
    categoryId: reread.categoryId || snapshot.categoryId,
    fields,
    images,
    skus: skuAlign.ok ? skuAlign.rows : snapshot.skus,
    freightTemplate: reread.freightTemplate ?? snapshot.freightTemplate,
    brand: reread.brand ?? snapshot.brand,
  };
  const fingerprint = fingerprintFromSnapshot({
    shopId: order.target.shopId,
    shopName: order.target.shopNameSnapshot,
    title: view.title,
    categoryId: view.categoryId,
    draftId: order.claimedDraftId,
    recordId: order.source.crawlRecordId,
    pageUrl: probe.url,
    snapshot: view,
  });
  const qa = evaluateQa({ identityOk: true, fields, images, missing });
  order = {
    ...order,
    draftFingerprint: fingerprint,
    qa: { result: qa.result, checkedAt: Date.now(), draftFingerprint: fingerprint },
    missing,
    fields: Object.fromEntries(fields.map((field) => [field.key, {
      value: field.value,
      provenance: storeProvenance(field.provenance),
      verified: field.verified,
    }])),
  };
  const summary = prepareSummary({
    shop: order.target.shopNameSnapshot || order.target.shopId || "未知",
    title: view.title || order.source.titleSnapshot || "未知",
    category: view.categoryId || "未知",
    priceRange: priceRange(view),
    stockTotal: stockTotal(view),
    images: imagesPassText(images),
    translation: textOk ? "文字翻译已读回" : "文字翻译失败",
    risks: [...missing.map((item) => item.action), ...residue.risks, paidNote].filter(Boolean).join("；") || "无",
  });
  if (qa.result !== "pass") {
    const parked = parkHuman(order, "发布前 QA 未通过", `工作单 ${order.id}：补齐缺项或读回后再准备`);
    const saved = await persist(port, parked, base);
    if (saved.stale) return latestResult(saved.order);
    return {
      ok: true,
      message: [summary, paidNote].filter(Boolean).join("\n"),
      data: { state: saved.order.state, workOrderId: saved.order.id, qa: saved.order.qa, draftFingerprint: fingerprint },
    };
  }

  let ready = climb(order, "draft_ready");
  if (ready.state !== "draft_ready" && ready.state !== "saved_draft") {
    return finishStop(port, ready, base, "还不能进入草稿就绪", `工作单 ${ready.id} 先完成认领和编辑`);
  }
  if (params.saveDraft) {
    if (halted(port)) return finishStop(port, ready, base, "保存前已取消或暂停", `工作单 ${ready.id} 不保存，不发布`);
    const savedDraft = await port.saveDraft(port.tabId);
    const verified = Boolean(savedDraft.ok && (savedDraft.readback || savedDraft.receipt));
    ready = evidence(ready, "save_draft", { requested: true }, savedDraft, verified);
    if (!savedDraft.ok) return finishStop(port, ready, base, savedDraft.message || "保存草稿失败", `工作单 ${ready.id} 先确认草稿仍在`);
    if (verified) {
      const moved = applyTransition(ready, "saved_draft");
      ready = moved.ok ? { ...moved.order, receipt: savedDraft.receipt || { kind: "draft", text: savedDraft.readback || savedDraft.message } } : ready;
    }
  }
  const saved = await persist(port, ready, base);
  if (saved.stale) return latestResult(saved.order);
  return {
    ok: true,
    message: [summary, stateLabel(saved.order.state), paidNote].filter(Boolean).join("\n"),
    data: { state: saved.order.state, workOrderId: saved.order.id, qa: saved.order.qa, draftFingerprint: fingerprint },
  };
}

async function runStatus(port: DxmSmtPort, params: Record<string, unknown>): Promise<ToolResult> {
  const id = text(params.workOrderId);
  if (!id || !loadOrder(port.journalDir, id)) return { ok: false, message: "找不到工作单", data: { refused: true } };
  return withOrder(id, async () => {
    const order = loadOrder(port.journalDir, id);
    if (!order) return { ok: false, message: "找不到工作单", data: { refused: true } };
    return queryUnlocked(port, order, order.revision ?? 0);
  });
}

async function runPublish(port: DxmSmtPort, params: Record<string, unknown>): Promise<ToolResult> {
  const id = text(params.workOrderId);
  const fingerprint = text(params.draftFingerprint);
  if (!id || !fingerprint) return { ok: false, message: "发布需要工作单和草稿指纹", data: { refused: true } };
  if (publishBusy.has(id)) {
    return { ok: true, message: "发布正在进行，返回当前尝试状态", data: { state: loadOrder(port.journalDir, id)?.state, refused: true, attempt: "in_flight" } };
  }
  if (!loadOrder(port.journalDir, id)) return { ok: false, message: "找不到工作单", data: { refused: true } };
  return withOrder(id, () => publishLocked(port, id, fingerprint));
}

async function publishLocked(port: DxmSmtPort, id: string, fingerprint: string): Promise<ToolResult> {
  if (publishBusy.has(id)) {
    return { ok: true, message: "发布正在进行，返回当前尝试状态", data: { refused: true, attempt: "in_flight" } };
  }
  publishBusy.add(id);
  try {
    const loaded = loadOrder(port.journalDir, id);
    if (!loaded) return { ok: false, message: "找不到工作单", data: { refused: true } };
    const base = loaded.revision ?? 0;
    if (loaded.receipt?.kind === "rejected" && fingerprint === loaded.publish?.fingerprint) {
      return { ok: true, message: "平台已拒绝，旧指纹不能直接重发", data: { state: loaded.state, refused: true } };
    }
    if (loaded.state === "published_online" || loaded.state === "submitted_pending_review" || hasOpenPublishAttempt(loaded)) {
      return queryUnlocked(port, loaded, base);
    }
    if (loaded.state !== "draft_ready" && loaded.state !== "saved_draft") {
      return { ok: true, message: "工作单还没准备好，不能发布", data: { state: loaded.state, refused: true } };
    }
    if (!qaStillValid(loaded, fingerprint)) {
      return { ok: true, message: "草稿指纹或 QA 已失效，请重新准备", data: { state: loaded.state, refused: true } };
    }
    const probe = await port.readProbe(port.tabId);
    const tabs = await port.listTabs();
    const identity = publishIdentityMatches(loaded, port.tabId, tabs, probe);
    if (!identity.ok) return refuse(identity.reason, loaded.state);
    if (probe.shops.length && loaded.target.shopId && !probe.shops.some((shop) => shop.id === loaded.target.shopId)) {
      return refuse("页面店铺已改变，请重新准备", loaded.state);
    }
    const fields = await port.readFields(port.tabId);
    const live = fingerprintFromSnapshot({
      shopId: loaded.target.shopId,
      shopName: loaded.target.shopNameSnapshot,
      title: fields.title,
      categoryId: fields.categoryId,
      draftId: loaded.claimedDraftId,
      recordId: loaded.source.crawlRecordId,
      pageUrl: probe.url,
      snapshot: fields,
    });
    const missing = humanMissing(fields);
    const qa = evaluateQa({ identityOk: true, fields: fields.fields, images: fields.images, missing });
    if (qa.result !== "pass") return refuse("点击前重新 QA 未通过，请重新准备", loaded.state);
    if (live !== fingerprint) return refuse("当前草稿和确认指纹不一致，请重新准备", loaded.state);
    if (halted(port)) return finishStop(port, loaded, base, "发布前已取消或暂停", "不会点击发布");

    const started: DxmListingWorkOrder = {
      ...evidence(loaded, "publish_attempt_started", { fingerprint }, { shopId: loaded.target.shopId }, false),
      publish: { startedAt: Date.now(), fingerprint, shopId: loaded.target.shopId || "" },
    };
    const wrote = await persist(port, started, base);
    if (wrote.stale) return latestResult(wrote.order);
    port.beforeClick?.();
    const clicked = await port.clickPublish(port.tabId);
    let withClick: DxmListingWorkOrder = {
      ...evidence(wrote.order, "publish", { fingerprint }, clicked, Boolean(clicked.receipt)),
      publish: { ...wrote.order.publish!, clickedAt: Date.now() },
    };
    if (!clicked.receipt) {
      return finishStop(port, withClick, wrote.base, "提交结果未知，只允许状态查询，不会再次点击", "先查回执，不能再次点击");
    }
    if (clicked.receipt.kind === "rejected") {
      const failed = parkFailed(
        { ...withClick, receipt: clicked.receipt, publish: { ...withClick.publish!, resolved: true } },
        clicked.receipt.text || "平台拒绝",
        "修改资料后重新准备，旧指纹不能直接重发",
      );
      const saved = await persist(port, failed, wrote.base);
      return { ok: true, message: clicked.receipt.text || "平台拒绝", data: { state: (saved.order || failed).state, workOrderId: id } };
    }
    if (clicked.receipt.kind === "submitted") {
      const moved = applyTransition(withClick, "submitted_pending_review", { receipt: clicked.receipt });
      if (!moved.ok) return finishStop(port, withClick, wrote.base, "提交结果未知，只允许状态查询", "先查回执，不能再次点击");
      const doneOrder = { ...moved.order, publish: { ...withClick.publish!, resolved: true } };
      const saved = await persist(port, doneOrder, wrote.base);
      const current = saved.order;
      return { ok: true, message: stateLabel(current.state), data: { state: current.state, workOrderId: id } };
    }
    return finishStop(port, withClick, wrote.base, "提交结果未知，只允许状态查询，不会再次点击", "先查回执，不能再次点击");
  } finally {
    publishBusy.delete(id);
  }
}

async function queryUnlocked(port: DxmSmtPort, order: DxmListingWorkOrder, base: number): Promise<ToolResult> {
  const found = await port.queryStatus(order);
  const next = applyStatusEvidence(order, found);
  const saved = await persist(port, next, base);
  const current = saved.order;
  return {
    ok: true,
    message: statusMessage(current, found),
    data: { state: current.state, workOrderId: current.id, checked: ["submit_record", "platform_product", "online_list"] },
  };
}

function statusMessage(order: DxmListingWorkOrder, found: { submitRecord?: unknown; platformProductId?: string; online?: { url?: string }; failureRecord?: unknown }): string {
  const empty = !found.submitRecord && !found.platformProductId && !found.online && !found.failureRecord;
  const unknown = hasOpenPublishAttempt(order) || Boolean(order.checkpoint?.reason?.includes("未知"));
  if (order.state === "published_online" && found.online && "url" in found.online && found.online.url) {
    return `${stateLabel(order.state)} ${found.online.url}`;
  }
  if (!empty) return stateLabel(order.state);
  return `${unknown ? "提交结果未知，只允许状态查询。" : `${stateLabel(order.state)}。`}查询不到结果，不推断成败`;
}

async function lookupClaim(port: DxmSmtPort, order: DxmListingWorkOrder, recordId?: string, shopId?: string): Promise<DraftLookup> {
  if (!port.lookupDraft) {
    if (order.claim?.startedAt && !order.claim.resolved) return { status: "unknown" };
    return { status: "absent" };
  }
  return port.lookupDraft({ recordId, shopId, tabId: port.tabId });
}

async function persist(
  port: DxmSmtPort,
  order: DxmListingWorkOrder,
  base: number,
): Promise<{ order: DxmListingWorkOrder; base: number; stale: boolean }> {
  const saved = commitOrder(port.journalDir, order, base);
  if (!saved.ok) return { order: saved.order || order, base: saved.order?.revision ?? base, stale: true };
  return { order: saved.order, base: saved.order.revision ?? base + 1, stale: false };
}

async function finishStop(port: DxmSmtPort, order: DxmListingWorkOrder, base: number, reason: string, nextAction: string): Promise<ToolResult> {
  const parked = parkHuman(order, reason, nextAction);
  const saved = await persist(port, parked, base);
  if (saved.stale) return latestResult(saved.order);
  return done(saved.order, reason);
}

function latestResult(order: DxmListingWorkOrder): ToolResult {
  return {
    ok: true,
    message: `${stateLabel(order.state)}。工作单已有更新，返回最新状态，不会用旧快照覆盖`,
    data: { state: order.state, workOrderId: order.id, stale: true, checkpoint: order.checkpoint },
  };
}

function refuse(message: string, state: DxmListingState): ToolResult {
  return { ok: true, message, data: { state, refused: true } };
}

function done(order: DxmListingWorkOrder, message: string): ToolResult {
  return { ok: true, message, data: { state: order.state, workOrderId: order.id, checkpoint: order.checkpoint } };
}

function halted(port: DxmSmtPort): boolean {
  return Boolean(port.signal?.aborted || port.isPaused?.());
}

function evidence(order: DxmListingWorkOrder, action: string, observed: unknown, changed: unknown, verified: boolean): DxmListingWorkOrder {
  return {
    ...order,
    evidence: [...order.evidence, { at: Date.now(), action, observed, changed, verified }],
  };
}

function climb(order: DxmListingWorkOrder, target: DxmListingState): DxmListingWorkOrder {
  const ladder: DxmListingState[] = ["observed", "claimed", "editing", "draft_ready", "saved_draft"];
  let current = order;
  const targetIndex = ladder.indexOf(target);
  while (ladder.indexOf(current.state) >= 0 && ladder.indexOf(current.state) < targetIndex) {
    const next = ladder[ladder.indexOf(current.state) + 1];
    if (!next) break;
    const moved = applyTransition(current, next);
    if (!moved.ok) return current;
    current = moved.order;
  }
  return current;
}

function humanMissing(snapshot: FieldSnapshot): Array<{ field: string; reason: string; action: string }> {
  const missing: Array<{ field: string; reason: string; action: string }> = [];
  if (!String(snapshot.freightTemplate || "").trim()) {
    missing.push({
      field: "运费模板",
      reason: "没有运费模板",
      action: "缺少运费模板。请到店铺后台指定已有模板，本流程不会新建模板。",
    });
  }
  if (!String(snapshot.brand || "").trim()) {
    missing.push({
      field: "品牌资质",
      reason: "没有品牌或类目资质",
      action: "请到资质中心补充品牌或类目资质后再继续。",
    });
  }
  for (const field of snapshot.fields) {
    if (!field.required || String(field.value || "").trim()) continue;
    if (field.key === "freightTemplate" || field.key === "brand") continue;
    missing.push({ field: field.key, reason: "必填为空", action: `请补齐${field.key}` });
  }
  return missing;
}

function asWrites(value: unknown): Array<{ key: string; value: string; provenance: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    return [{ key: text(row.key), value: text(row.value), provenance: text(row.provenance) }];
  });
}

function asConsent(value: unknown): { feature: string; scope: string; text: string; fee: string; confirmId: string } | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  return { feature: text(row.feature), scope: text(row.scope), text: text(row.text), fee: text(row.fee), confirmId: text(row.confirmId) };
}

function asProvenance(value: string): FieldDef["provenance"] {
  if (value === "source" || value === "user" || value === "approved_rule" || value === "readback" || value === "suggestion") return value;
  return "suggestion";
}

function storeProvenance(value: FieldDef["provenance"]): FieldProvenance {
  if (value === "source" || value === "user" || value === "approved_rule" || value === "readback" || value === "suggestion") return value;
  return "suggestion";
}

function groupFromScope(scope: string): ImageGroupName {
  if (scope.includes("变种")) return "variant";
  if (scope.includes("描述")) return "description";
  return "main";
}

function cloneImages(images: FieldSnapshot["images"]): FieldSnapshot["images"] {
  return {
    main: images.main.map((item) => ({ ...item })),
    variant: images.variant.map((item) => ({ ...item })),
    description: images.description.map((item) => ({ ...item })),
  };
}

function markGroup(images: FieldSnapshot["images"], group: ImageGroupName, status: ImageSlot["status"]): FieldSnapshot["images"] {
  const next = cloneImages(images);
  if (!next[group].length) next[group] = [{ src: group, status }];
  else next[group] = next[group].map((item) => ({ ...item, status }));
  return next;
}

function priceRange(snapshot: FieldSnapshot): string {
  const prices = snapshot.skus.map((row) => Number(row.price)).filter((price) => Number.isFinite(price));
  if (!prices.length) return "未知";
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  return min === max ? String(min) : `${min}-${max}`;
}

function stockTotal(snapshot: FieldSnapshot): string {
  if (!snapshot.skus.length) return "未知";
  return String(snapshot.skus.reduce((sum, row) => sum + (Number(row.stock) || 0), 0));
}

function imagesPassText(images: FieldSnapshot["images"]): string {
  const groups = (["main", "variant", "description"] as const).filter((group) => images[group].length);
  if (!groups.length) return "无图片";
  const failed = groups.filter((group) => images[group].some((item) => item.status !== "verified"));
  return failed.length ? `未完成：${failed.join("、")}` : "已验证";
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}
