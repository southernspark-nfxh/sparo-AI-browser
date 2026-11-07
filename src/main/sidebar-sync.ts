export type SeqTurn = { seq?: number };

/** 给还没有序号的对话补上单调序号。已有序号不动。 */
export function stampChatSeq<T extends SeqTurn>(turns: T[], nextSeq: number): { turns: T[]; nextSeq: number } {
  let seq = nextSeq;
  for (const turn of turns) {
    if (!turn.seq) {
      turn.seq = seq;
      seq += 1;
    }
  }
  return { turns, nextSeq: seq };
}

export type ChatFrame<T> = {
  chatSync: "full" | "delta";
  chat: T[];
  chatBase: number;
  chatSeq: number;
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
  const last = turns.length ? Number(turns[turns.length - 1]?.seq) || 0 : 0;
  const first = turns.length ? Number(turns[0]?.seq) || 0 : 0;
  const gap = input.cursor > 0 && first > input.cursor + 1;
  const full = input.resync || input.sessionChanged || input.cursor === 0 || !turns.length || gap;
  if (full) {
    return { chatSync: "full", chat: turns.slice(), chatBase: 0, chatSeq: last };
  }
  return {
    chatSync: "delta",
    chat: turns.filter((turn) => Number(turn.seq) > input.cursor),
    chatBase: input.cursor,
    chatSeq: last,
  };
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
