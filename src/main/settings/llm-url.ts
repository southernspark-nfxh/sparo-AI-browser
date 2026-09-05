/** Join an OpenAI-compatible base URL with /chat/completions (no double path). */
export function chatCompletionsUrl(baseUrl: string): string {
  const b = String(baseUrl || "")
    .trim()
    .replace(/\/+$/, "");
  if (!b) return "https://api.deepseek.com/chat/completions";
  if (/\/chat\/completions$/i.test(b)) return b;
  return `${b}/chat/completions`;
}
