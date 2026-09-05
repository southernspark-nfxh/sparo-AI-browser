import type { SparoSettings } from "../settings/store.js";
import type { CsIntentResult, CsMessage } from "./types.js";

const TEMPLATES: Record<string, string> = {
  inquiry:
    "您好，收到您的咨询。请稍候，我这边帮您确认现货与交期，马上回复具体方案。",
  price:
    "您好，关于价格：请告知规格/数量，我按您的需求给出准确报价（含是否含税/运费）。",
  discount:
    "您好，优惠这块我帮您看看当前活动与批量价。您方便说下大概采购数量吗？数量合适我尽量给到更好条件。",
  after_sale:
    "非常抱歉给您带来不便。请把订单号和问题照片发我，我立刻帮您走售后处理，优先给您一个明确方案。",
  docs: "好的，资料/规格我这边整理后发您。请补充一下您需要的具体型号或用途，避免发错版本。",
  shipping:
    "收到，物流信息我帮您查一下。请提供订单号；若已发货我会把单号和预计到达时间同步给您。",
  greeting: "您好，在的～请问需要了解哪款产品或帮您报价呢？",
  spam: "您好，这边主要处理正常采购咨询。如有具体商品需求请直接说明型号与数量。",
  other:
    "您好，已收到您的消息。我先确认一下细节，请补充关键信息（型号/数量/交期），以便准确答复。",
};

export function templateDraft(intent: CsIntentResult): string {
  const base = TEMPLATES[intent.intent] || TEMPLATES.other;
  if (intent.lastCustomerText && intent.intent !== "greeting") {
    return `${base}\n\n（针对您刚才提到的：「${intent.lastCustomerText.slice(0, 40)}${intent.lastCustomerText.length > 40 ? "…" : ""}」）`;
  }
  return base;
}

/** Optional one-shot LLM draft; fails soft → null */
export async function llmDraft(input: {
  settings: SparoSettings;
  intent: CsIntentResult;
  messages: CsMessage[];
  persona?: string;
}): Promise<string | null> {
  const apiKey = (input.settings.apiKey || "").trim();
  if (!apiKey) return null;
  const baseUrl = (input.settings.baseUrl || "https://api.deepseek.com").replace(/\/$/, "");
  const model = input.settings.model || "deepseek-v4-flash";
  const transcript = input.messages
    .slice(-12)
    .map((m) => `${m.role}: ${m.text}`)
    .join("\n");
  const system = `你是网页回复助手。根据当前页面的聊天记录或评论/留言，写一条即将填进回复框的中文草稿（2～5句）。
场景可能是客服会话，也可能是帖子评论区。
规则：贴合对方最后一句话；不承诺无法核实的价格/交期；不索要无关隐私；不下单；不假装已经发出。
当前动机标签：${input.intent.label}（${input.intent.intent}）。
${input.persona ? `人设：${input.persona}` : ""}
只输出回复正文，不要前缀标题，不要「草稿：」字样。`;

  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.4,
        messages: [
          { role: "system", content: system },
          {
            role: "user",
            content: `最近会话：\n${transcript || "(空)"}\n\n客户最后一句：${input.intent.lastCustomerText || "(无)"}`,
          },
        ],
      }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = json.choices?.[0]?.message?.content?.trim();
    return text || null;
  } catch {
    return null;
  }
}

export async function buildDraft(input: {
  settings: SparoSettings;
  intent: CsIntentResult;
  messages: CsMessage[];
  provided?: string;
  preferLlm?: boolean;
}): Promise<{ draft: string; source: "template" | "llm" | "provided" }> {
  if (input.provided?.trim()) {
    return { draft: input.provided.trim(), source: "provided" };
  }
  if (input.preferLlm !== false) {
    const llm = await llmDraft(input);
    if (llm) return { draft: llm, source: "llm" };
  }
  return { draft: templateDraft(input.intent), source: "template" };
}
