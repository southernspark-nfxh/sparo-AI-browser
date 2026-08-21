import {
  CS_INTENT_LABELS,
  type CsIntent,
  type CsIntentResult,
  type CsMessage,
} from "./types.js";

const RULES: Array<{ intent: CsIntent; re: RegExp; weight: number }> = [
  { intent: "spam", re: /加微信|点击领取|免费色情|代开发票|刷单/, weight: 0.95 },
  { intent: "after_sale", re: /退款|退货|换货|坏了|破损|投诉|售后|质量问题|假货/, weight: 0.9 },
  { intent: "shipping", re: /发货|物流|快递|到哪了|几天到|运费|包邮/, weight: 0.85 },
  { intent: "discount", re: /便宜|优惠|打折|便宜点|少点|砍价|券|满减/, weight: 0.85 },
  { intent: "price", re: /多少钱|报价|价格|单价|怎么卖|什么价/, weight: 0.8 },
  { intent: "docs", re: /资料|规格|参数|说明书|证书|检测报告|样品/, weight: 0.8 },
  { intent: "inquiry", re: /有货|现货|能不能|可以做|定制|起订|最小订购|MOQ|咨询/, weight: 0.75 },
  { intent: "greeting", re: /你好|在吗|亲|您好|hello|hi\b/i, weight: 0.7 },
];

export function classifyIntent(
  messages: CsMessage[],
  lastCustomerText?: string,
): CsIntentResult {
  const text =
    (lastCustomerText ||
      [...messages].reverse().find((m) => m.role === "customer" || m.role === "unknown")
        ?.text ||
      "")
      .trim()
      .slice(0, 800);

  if (!text) {
    return {
      intent: "other",
      label: CS_INTENT_LABELS.other,
      confidence: 0.2,
      reason: "无客户文本",
      lastCustomerText: "",
    };
  }

  let best: { intent: CsIntent; weight: number; reason: string } | null = null;
  for (const rule of RULES) {
    if (rule.re.test(text)) {
      if (!best || rule.weight > best.weight) {
        best = { intent: rule.intent, weight: rule.weight, reason: `匹配 /${rule.re.source}/` };
      }
    }
  }

  if (!best) {
    return {
      intent: "inquiry",
      label: CS_INTENT_LABELS.inquiry,
      confidence: 0.45,
      reason: "未命中强规则，默认咨询",
      lastCustomerText: text,
    };
  }

  return {
    intent: best.intent,
    label: CS_INTENT_LABELS[best.intent],
    confidence: best.weight,
    reason: best.reason,
    lastCustomerText: text,
  };
}
