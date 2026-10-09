/** 回落到自己的 Key 时，补上模型名，避免把空 model 发给 DeepSeek。 */
export function withJsonModel(body: BodyInit | null | undefined, model: string): BodyInit | undefined {
  const name = String(model || "").trim();
  if (!name || typeof body !== "string") return body === null ? undefined : body ?? undefined;
  try {
    const json = JSON.parse(body) as Record<string, unknown>;
    if (!String(json.model || "").trim()) json.model = name;
    return JSON.stringify(json);
  } catch {
    return body;
  }
}
