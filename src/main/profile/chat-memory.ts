/**
 * Persists the last few chat turns across restarts, so Sparo does not greet
 * the user as a stranger every launch. Kept small (40 turns) and separate
 * from the profile so it can be cleared independently.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type ChatDoc = { title: string; path: string; kind?: string };

export type ChatTurn = {
  role: "user" | "assistant";
  text: string;
  doc?: ChatDoc;
  images?: string[];
  /** Cortex 停问 / 出思路，侧栏出按钮。 */
  cortex?: { mode: "ask" | "propose" | "loop"; need?: string; approach?: string };
};

const CAP = 40;

function chatMemoryPath(configDir: string): string {
  return join(configDir, "chat-memory.json");
}

export function loadChatMemory(configDir: string): ChatTurn[] {
  const p = chatMemoryPath(configDir);
  if (!existsSync(p)) return [];
  try {
    const raw = JSON.parse(readFileSync(p, "utf8"));
    if (!Array.isArray(raw)) return [];
    return raw
      .filter(
        (t: unknown): t is ChatTurn =>
          typeof t === "object" &&
          t !== null &&
          ((t as ChatTurn).role === "user" || (t as ChatTurn).role === "assistant") &&
          typeof (t as ChatTurn).text === "string",
      )
      .map((t) => {
        const { images: _imgs, ...base } = t as ChatTurn;
        const doc = base.doc;
        if (
          doc &&
          typeof doc.title === "string" &&
          typeof doc.path === "string"
        ) {
          return base;
        }
        const { doc: _drop, ...rest } = base;
        return rest;
      })
      .slice(-CAP);
  } catch {
    return [];
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

export function saveChatMemory(configDir: string, log: ChatTurn[]): void {
    const trimmed = log.slice(-CAP).map((t) => {
      const { images: _drop, ...rest } = t;
      return rest;
    });
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      mkdirSync(configDir, { recursive: true });
      writeFileSync(
        chatMemoryPath(configDir),
        JSON.stringify(trimmed, null, 2),
        "utf8",
      );
    } catch {
      /* best-effort */
    }
  }, 800);
}

export function clearChatMemory(configDir: string): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  try {
    mkdirSync(configDir, { recursive: true });
    writeFileSync(chatMemoryPath(configDir), "[]", "utf8");
  } catch {
    /* best-effort */
  }
}
