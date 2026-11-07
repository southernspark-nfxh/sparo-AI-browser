export type SeqTurn = { seq?: number };

/** 给还没有序号的对话补上单调序号。已有序号不动，新序号从现有最大号往后排。 */
export function stampChatSeq<T extends SeqTurn>(turns: T[], nextSeq: number): { turns: T[]; nextSeq: number } {
  let seq = Math.max(1, nextSeq || 1);
  for (const turn of turns) {
    const current = Number(turn.seq) || 0;
    if (current >= seq) seq = current + 1;
  }
  for (const turn of turns) {
    if (!turn.seq) {
      turn.seq = seq;
      seq += 1;
    }
  }
  return { turns, nextSeq: seq };
}

function seqHigh(turns: SeqTurn[]): number {
  let high = 0;
  for (const turn of turns) {
    const seq = Number(turn.seq) || 0;
    if (seq > high) high = seq;
  }
  return high;
}

export type ChatFrame<T> = {
  chatSync: "full" | "delta";
  chat: T[];
  chatBase: number;
  chatSeq: number;
  why: "resync" | "session" | "cursor0" | "empty" | "gap" | "delta";
};

/**
 * 决定这一拍发全量还是增量。
 * 换会话、壳层重载、序号对不上、或还没发过，都发全量。
 */
export function planChatFrame<T extends SeqTurn>(input: {
  turns: T[];
  cursor: number;
  sessionChanged: boolean;
  resync: boolean;
}): ChatFrame<T> {
  const turns = input.turns;
  const high = seqHigh(turns);
  const first = turns.reduce((min, turn) => {
    const seq = Number(turn.seq) || 0;
    return seq > 0 && seq < min ? seq : min;
  }, Number.POSITIVE_INFINITY);
  const gap = input.cursor > 0 && first > input.cursor + 1;
  const why = input.resync
    ? "resync"
    : input.sessionChanged
      ? "session"
      : input.cursor === 0
        ? "cursor0"
        : !turns.length
          ? "empty"
          : gap
            ? "gap"
            : "delta";
  const full = why !== "delta";
  if (full) {
    return { chatSync: "full", chat: turns.slice(), chatBase: 0, chatSeq: high, why };
  }
  return {
    chatSync: "delta",
    chat: turns.filter((turn) => Number(turn.seq) > input.cursor),
    chatBase: input.cursor,
    chatSeq: high,
    why,
  };
}

export function formatPushFrame(input: {
  key: string;
  sync: string;
  chatN: number;
  chatBytes: number;
  totalBytes: number;
  cursor: number;
  why?: string;
}): string {
  const why = input.why ? ` why=${input.why}` : "";
  return `[push-frame] key=${input.key} sync=${input.sync} chatN=${input.chatN} chatBytes=${input.chatBytes} totalBytes=${input.totalBytes} cursor=${input.cursor}${why}`;
}

export type ShellChatState = { key: string; seq: number; texts: string[] };

/** 壳层合并一帧。基线对不上就请求全量，先不改本地对话。 */
export function applyChatFrame(
  state: ShellChatState,
  frame: { selectedSession?: string; chatSync?: string; chat?: Array<{ text?: string; seq?: number }>; chatBase?: number; chatSeq?: number },
): { state: ShellChatState; requestFull: boolean } {
  const key = frame.selectedSession || "user";
  let next = state.key === key ? state : { key, seq: 0, texts: [] };
  if (frame.chatSync === "delta") {
    if (Number(frame.chatBase) !== next.seq) return { state: next, requestFull: true };
    next = {
      key,
      seq: Number(frame.chatSeq) || next.seq,
      texts: next.texts.concat((frame.chat || []).map((turn) => turn.text || "")),
    };
    return { state: next, requestFull: false };
  }
  next = {
    key,
    seq: Number(frame.chatSeq) || 0,
    texts: (frame.chat || []).map((turn) => turn.text || ""),
  };
  return { state: next, requestFull: false };
}
