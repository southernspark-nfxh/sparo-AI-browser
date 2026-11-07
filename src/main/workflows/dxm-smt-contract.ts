/** 店小秘到速卖通商品工作单。决策点 #35–#39 的数据合同。 */

export type DxmListingState =
  | "observed"
  | "claimed"
  | "editing"
  | "draft_ready"
  | "saved_draft"
  | "submitted_pending_review"
  | "published_online"
  | "waiting_human"
  | "failed";

export type FieldProvenance = "source" | "user" | "approved_rule" | "readback" | "suggestion";

export type DxmListingWorkOrder = {
  id: string;
  source: {
    productId?: string;
    crawlRecordId?: string;
    sourceUrl?: string;
    titleSnapshot?: string;
  };
  target: {
    platform: "aliexpress";
    shopId?: string;
    shopNameSnapshot?: string;
  };
  claimedDraftId?: string;
  platformProductId?: string;
  state: DxmListingState;
  tabs: { sourceTabId?: string; editTabId?: string };
  checkpoint?: { reliableState: DxmListingState; reason: string; nextAction: string; at: number };
  qa?: { result: "pass" | "waiting_human" | "fail"; checkedAt: number; draftFingerprint: string };
  draftFingerprint?: string;
  fields: Record<string, { value?: unknown; provenance: FieldProvenance; verified: boolean }>;
  missing: Array<{ field: string; reason: string; action: string }>;
  evidence: Array<{
    at: number;
    action: string;
    observed?: unknown;
    changed?: unknown;
    verified?: unknown;
    url?: string;
  }>;
  receipt?: {
    kind: "draft" | "submitted" | "rejected" | "online";
    text?: string;
    productId?: string;
    url?: string;
  };
  /** 发布尝试。有开始或点击、但没有最终回执时，禁止再次点击。 */
  publish?: {
    startedAt?: number;
    clickedAt?: number;
    fingerprint: string;
    shopId: string;
    resolved?: boolean;
  };
  /** 认领尝试。副作用前先落账，恢复时先查目标箱。 */
  claim?: { startedAt?: number; resolved?: boolean; draftId?: string };
  /** 追加保存时的版本。旧版本不能覆盖较新的发布尝试或回执。 */
  revision?: number;
};

export type OnlineProof = { productId: string; shopId: string; url: string };

export type TransitionProof = {
  receipt?: DxmListingWorkOrder["receipt"];
  online?: OnlineProof;
};

const LADDER: DxmListingState[] = ["observed", "claimed", "editing", "draft_ready", "saved_draft"];

export function createWorkOrder(seed: Partial<DxmListingWorkOrder> = {}): DxmListingWorkOrder {
  return {
    id: seed.id || `dxm-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`,
    source: seed.source || {},
    target: seed.target || { platform: "aliexpress" },
    claimedDraftId: seed.claimedDraftId,
    platformProductId: seed.platformProductId,
    state: seed.state || "observed",
    tabs: seed.tabs ? { ...seed.tabs } : {},
    checkpoint: seed.checkpoint ? { ...seed.checkpoint } : undefined,
    qa: seed.qa ? { ...seed.qa } : undefined,
    draftFingerprint: seed.draftFingerprint,
    fields: seed.fields ? { ...seed.fields } : {},
    missing: seed.missing ? [...seed.missing] : [],
    evidence: seed.evidence ? [...seed.evidence] : [],
    receipt: seed.receipt ? { ...seed.receipt } : undefined,
    publish: seed.publish ? { ...seed.publish } : undefined,
    claim: seed.claim ? { ...seed.claim } : undefined,
    revision: seed.revision,
  };
}

export function stateLabel(state: DxmListingState): string {
  switch (state) {
    case "observed":
      return "已看到页面，尚未认领";
    case "claimed":
      return "已认领，尚未编辑完成";
    case "editing":
      return "编辑中，尚未准备完成";
    case "draft_ready":
      return "草稿已就绪，尚未发布";
    case "saved_draft":
      return "已保存草稿，尚未发布";
    case "submitted_pending_review":
      return "已提交，平台处理中，尚未上线";
    case "published_online":
      return "已上线";
    case "waiting_human":
      return "停等人工处理";
    case "failed":
      return "失败";
    default:
      return state;
  }
}

function copy(order: DxmListingWorkOrder): DxmListingWorkOrder {
  return createWorkOrder(order);
}

export function parkHuman(order: DxmListingWorkOrder, reason: string, nextAction: string): DxmListingWorkOrder {
  return park(order, "waiting_human", reason, nextAction);
}

export function parkFailed(order: DxmListingWorkOrder, reason: string, nextAction: string): DxmListingWorkOrder {
  return park(order, "failed", reason, nextAction);
}

function park(
  order: DxmListingWorkOrder,
  state: "waiting_human" | "failed",
  reason: string,
  nextAction: string,
): DxmListingWorkOrder {
  const reliable =
    order.state === "waiting_human" || order.state === "failed"
      ? order.checkpoint?.reliableState || "observed"
      : order.state;
  const next = copy(order);
  next.state = state;
  next.checkpoint = { reliableState: reliable, reason, nextAction, at: Date.now() };
  next.evidence = [
    ...next.evidence,
    { at: Date.now(), action: state, observed: reliable, changed: reason },
  ];
  return next;
}

export function bindTabs(
  order: DxmListingWorkOrder,
  update: { sourceTabId?: string; editTabId?: string },
): DxmListingWorkOrder {
  const next = copy(order);
  next.tabs = {
    sourceTabId: update.sourceTabId || order.tabs.sourceTabId,
    editTabId: order.tabs.editTabId || update.editTabId,
  };
  return next;
}

/** 来源记录 ID + 店铺 ID。缺任一 ID 时返回空，禁止只靠标题判重。 */
export function associateExisting(
  orders: DxmListingWorkOrder[],
  recordId?: string,
  shopId?: string,
): DxmListingWorkOrder | null {
  if (!recordId || !shopId) return null;
  const hits = orders.filter(
    (order) => order.source.crawlRecordId === recordId && order.target.shopId === shopId,
  );
  if (!hits.length) return null;
  const open = hits.filter((order) => order.state !== "published_online");
  if (open.length === 1) return open[0] || null;
  if (open.length > 1) return null;
  return hits[hits.length - 1] || null;
}

export function isClosedOrder(order: DxmListingWorkOrder): boolean {
  return order.state === "published_online";
}

export function applyTransition(
  order: DxmListingWorkOrder,
  to: DxmListingState,
  proof?: TransitionProof,
): { ok: boolean; order: DxmListingWorkOrder; reason?: string } {
  const current = copy(order);
  if (current.state === "published_online") {
    return { ok: false, order: current, reason: "已关单，不会重复执行" };
  }
  if (current.state === "waiting_human" || current.state === "failed") {
    const back = current.checkpoint?.reliableState;
    if (back && to === back) {
      current.state = back;
      return { ok: true, order: current };
    }
    return { ok: false, order: current, reason: "断点不能直接跳到该状态" };
  }

  const allowed = forwardFrom(current.state);
  if (!allowed.includes(to)) {
    return { ok: false, order: current, reason: "非法状态跳跃" };
  }
  if (to === "submitted_pending_review") {
    if (proof?.receipt?.kind !== "submitted") {
      return { ok: false, order: current, reason: "无提交回执，不能进入待审" };
    }
    current.state = to;
    current.receipt = { ...proof.receipt };
    if (proof.receipt.productId) current.platformProductId = proof.receipt.productId;
    return { ok: true, order: current };
  }
  if (to === "published_online") {
    const online = proof?.online;
    if (!online?.productId || !online.shopId || !online.url) {
      return { ok: false, order: current, reason: "无在线证据，不能进入上线" };
    }
    if (online.productId !== current.platformProductId || online.shopId !== current.target.shopId) {
      return { ok: false, order: current, reason: "在线证据和本工作单的商品或店铺不一致" };
    }
    current.state = to;
    current.receipt = { kind: "online", productId: online.productId, url: online.url, text: "在线商品读回" };
    return { ok: true, order: current };
  }
  current.state = to;
  return { ok: true, order: current };
}

function forwardFrom(state: DxmListingState): DxmListingState[] {
  if (state === "draft_ready") return ["saved_draft", "submitted_pending_review"];
  if (state === "saved_draft") return ["submitted_pending_review"];
  if (state === "submitted_pending_review") return ["published_online"];
  const index = LADDER.indexOf(state);
  const next = index >= 0 ? LADDER[index + 1] : undefined;
  return next ? [next] : [];
}

export function hasOpenPublishAttempt(order: DxmListingWorkOrder): boolean {
  if (!order.publish?.startedAt && !order.publish?.clickedAt) return false;
  if (order.publish.resolved) return false;
  const kind = order.receipt?.kind;
  if (kind === "submitted" || kind === "online" || kind === "rejected") return false;
  return true;
}

export type OrderMatch =
  | { kind: "none" }
  | { kind: "ambiguous" }
  | { kind: "one"; order: DxmListingWorkOrder };

/** 多个未关同源单是歧义，调用方不得把它当成没找到再新建。 */
export function openOrderMatch(orders: DxmListingWorkOrder[], recordId?: string, shopId?: string): OrderMatch {
  if (!recordId || !shopId) return { kind: "none" };
  const same = orders.filter((order) => order.source.crawlRecordId === recordId && order.target.shopId === shopId);
  const open = same.filter((order) => order.state !== "published_online");
  if (open.length > 1) return { kind: "ambiguous" };
  if (open.length === 1 && open[0]) return { kind: "one", order: open[0] };
  const closed = same[same.length - 1];
  return closed ? { kind: "one", order: closed } : { kind: "none" };
}

export type StatusEvidence = {
  submitRecord?: { text: string; productId?: string };
  failureRecord?: { text: string; field?: string };
  platformProductId?: string;
  online?: { productId: string; shopId: string; url: string };
};

/**
 * 用提交记录、失败记录和在线读回迁移工作单。
 * 平台商品 ID 只来自提交记录或平台 ID 读回，不把别的在线商品算到本单。
 */
export function applyStatusEvidence(order: DxmListingWorkOrder, found: StatusEvidence): DxmListingWorkOrder {
  if (order.state === "published_online") return order;
  let current = order;
  if (found.failureRecord?.text) {
    const base = unwrapPark(current);
    return parkFailed(
      {
        ...base,
        receipt: { kind: "rejected", text: found.failureRecord.text, productId: current.platformProductId },
        publish: current.publish ? { ...current.publish, resolved: true } : current.publish,
      },
      found.failureRecord.text,
      "修改资料后重新准备，旧指纹不能直接重发",
    );
  }

  const readId = nonempty(found.submitRecord?.productId) || nonempty(found.platformProductId);
  if (readId && current.platformProductId && readId !== current.platformProductId) {
    return parkIfUnknown(current);
  }
  if (readId && !current.platformProductId) current = { ...current, platformProductId: readId };

  if (found.submitRecord?.text && current.state !== "submitted_pending_review") {
    const base = unwrapPark(current);
    if (base.state === "draft_ready" || base.state === "saved_draft") {
      const moved = applyTransition(
        { ...base, platformProductId: current.platformProductId },
        "submitted_pending_review",
        { receipt: { kind: "submitted", text: found.submitRecord.text, productId: current.platformProductId } },
      );
      if (moved.ok) {
        current = {
          ...moved.order,
          platformProductId: current.platformProductId || moved.order.platformProductId,
          publish: current.publish ? { ...current.publish, resolved: true } : current.publish,
        };
      }
    }
  }

  const online = found.online;
  if (
    current.state === "submitted_pending_review" &&
    online?.productId &&
    online.shopId &&
    online.url &&
    current.platformProductId &&
    online.productId === current.platformProductId &&
    online.shopId === current.target.shopId
  ) {
    const moved = applyTransition(current, "published_online", { online });
    if (moved.ok) {
      return {
        ...moved.order,
        publish: current.publish ? { ...current.publish, resolved: true } : current.publish,
      };
    }
  }
  return parkIfUnknown(current);
}

function unwrapPark(order: DxmListingWorkOrder): DxmListingWorkOrder {
  if (order.state !== "waiting_human" && order.state !== "failed") return order;
  const back = order.checkpoint?.reliableState;
  if (!back) return order;
  const restored = applyTransition(order, back);
  return restored.ok ? restored.order : order;
}

function parkIfUnknown(order: DxmListingWorkOrder): DxmListingWorkOrder {
  if (
    hasOpenPublishAttempt(order) &&
    order.state !== "waiting_human" &&
    order.state !== "submitted_pending_review" &&
    order.state !== "published_online" &&
    order.state !== "failed"
  ) {
    return parkHuman(order, "提交结果未知", "只允许状态查询，不会再次点击");
  }
  return order;
}

function nonempty(value: string | undefined): string {
  return String(value || "").trim();
}
