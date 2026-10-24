/**
 * 上一份是阅读页时，这句是改写上一页，还是要开新单。
 * 只解析模型给出的一个词。不在用户原话上做关键词清单。
 * 拿不准、没模型、超时，都当 open：去开单，不再吞进改写。
 */

export function rewriteVerdictPrompt(userText: string, priorTitle: string): string {
  return [
    "上一份助手产物是阅读页。",
    `阅读页标题：${priorTitle || "（无标题）"}`,
    `用户这句：${userText}`,
    "判断这句是在改写上一页，还是需要新数据、新页面、采集、研究或别的新动作。",
    "只回答一个词：rewrite 或 open。",
    "rewrite = 只改上一页的写法，不需要新数据。",
    "open = 需要新数据或新动作。",
    "拿不准就回答 open。",
  ].join("\n");
}

export function parseRewriteVerdict(raw: string): "rewrite" | "open" {
  const token = String(raw || "")
    .trim()
    .toLowerCase()
    .split(/\s+/)[0]
    ?.replace(/[^a-z]/g, "");
  return token === "rewrite" ? "rewrite" : "open";
}
