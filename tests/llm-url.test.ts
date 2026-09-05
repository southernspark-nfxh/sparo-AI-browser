import { describe, expect, it } from "vitest";
import { chatCompletionsUrl } from "../src/main/settings/llm-url.js";

describe("chatCompletionsUrl", () => {
  it("joins DeepSeek host without /v1", () => {
    expect(chatCompletionsUrl("https://api.deepseek.com")).toBe(
      "https://api.deepseek.com/chat/completions",
    );
  });

  it("keeps OpenAI /v1", () => {
    expect(chatCompletionsUrl("https://api.openai.com/v1")).toBe(
      "https://api.openai.com/v1/chat/completions",
    );
  });

  it("does not double the path", () => {
    expect(chatCompletionsUrl("https://api.openai.com/v1/chat/completions")).toBe(
      "https://api.openai.com/v1/chat/completions",
    );
  });

  it("strips trailing slashes", () => {
    expect(chatCompletionsUrl("https://openrouter.ai/api/v1/")).toBe(
      "https://openrouter.ai/api/v1/chat/completions",
    );
  });
});
