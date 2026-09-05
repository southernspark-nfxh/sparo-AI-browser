import { describe, expect, it } from "vitest";
import { detectLocale, t, tx, setLocale, normalizeLocale } from "../src/shared/i18n.js";

describe("locale detect", () => {
  it("maps OS tags", () => {
    expect(detectLocale("zh-CN")).toBe("zh");
    expect(detectLocale("en-US")).toBe("en");
    expect(detectLocale("ja-JP")).toBe("ja");
    expect(detectLocale("ko")).toBe("ko");
    expect(detectLocale("es-MX")).toBe("es");
    expect(detectLocale("pt-BR")).toBe("pt");
    expect(detectLocale("de-DE")).toBe("de");
    expect(detectLocale("fr")).toBe("fr");
    expect(detectLocale("it-IT")).toBe("it");
    expect(detectLocale("sv-SE")).toBe("en");
  });
});

describe("tx", () => {
  it("returns Chinese and English", () => {
    expect(tx("zh", "agent.copy")).toBe("复制给 Agent");
    expect(tx("en", "agent.copy")).toBe("Copy for Agent");
    expect(tx("ja", "lang.label")).toBe("言語");
  });

  it("interpolates", () => {
    expect(tx("en", "bookmark.moreTitle", { n: 3 })).toBe("3 more bookmarks");
  });

  it("falls back to en then zh", () => {
    expect(tx("de", "goal.summarize")).toBe("Summarize this page");
  });

  it("English drafting and need-key copy", () => {
    expect(tx("en", "act.replyBusy")).toBe("Drafting…");
    expect(tx("en", "llm.needKey")).toMatch(/own key|cloud models/i);
    expect(tx("en", "llm.needKey")).not.toMatch(/membership/i);
    expect(tx("en", "chat.hello")).not.toMatch(/Xiaohongshu|小红书/);
    expect(tx("en", "chat.copyAll")).toBe("Copy all");
    expect(tx("zh", "chat.clear")).toBe("清空对话");
    expect(tx("zh", "act.replyBusy")).toBe("起草中…");
    expect(tx("en", "mem.slept", { n: 3 })).toMatch(/3/);
  });
});

describe("setLocale + t", () => {
  it("switches current locale", () => {
    setLocale("ko");
    expect(normalizeLocale(undefined)).toBe("en");
    expect(t("lang.label")).toBe("언어");
    setLocale("zh");
  });
});
