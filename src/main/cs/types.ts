/** Customer-service (半自动) types — any-site chat assist */

export type CsIntent =
  | "inquiry"
  | "price"
  | "discount"
  | "after_sale"
  | "docs"
  | "shipping"
  | "greeting"
  | "spam"
  | "other";

export type CsMessageRole = "customer" | "agent" | "system" | "unknown";

export type CsMessage = {
  role: CsMessageRole;
  text: string;
};

export type CsComposerHit = {
  ref: string;
  selector?: string;
  placeholder?: string;
  tag?: string;
};

export type CsScanData = {
  ok: boolean;
  looksLikeChat: boolean;
  score: number;
  url: string;
  title: string;
  messages: CsMessage[];
  lastCustomerText?: string;
  composer?: CsComposerHit | null;
  sendButtonLabel?: string | null;
  hints: string[];
};

export type CsIntentResult = {
  intent: CsIntent;
  label: string;
  confidence: number;
  reason: string;
  lastCustomerText: string;
};

export type CsDraftData = {
  intent: CsIntentResult;
  draft: string;
  source: "template" | "llm" | "provided";
  filled: boolean;
  composerRef?: string;
  /** Never auto-send in C1 */
  sendBlocked: true;
  scan: CsScanData;
};

export const CS_INTENT_LABELS: Record<CsIntent, string> = {
  inquiry: "询价/咨询商品",
  price: "比价/问价",
  discount: "要优惠/砍价",
  after_sale: "售后/投诉",
  docs: "要资料/规格",
  shipping: "物流/发货",
  greeting: "寒暄",
  spam: "无效/骚扰",
  other: "其他",
};
