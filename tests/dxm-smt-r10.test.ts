import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BOX_POLL_BUDGET_MS,
  BOX_SETTLE_CONFIRM_MS,
  SMT_BOX_URL,
  advanceBoxWindow,
  boxPollExhausted,
  sameBoxRead,
  type BoxListRead,
  type BoxWindow,
} from "../src/main/workflows/dxm-smt-box.js";
import { createLiveDxmSmtPort, pollBox } from "../src/main/workflows/dxm-smt-live.js";
import { tempDir } from "./dxm-smt-helpers.js";

const crawlUrl = "https://www.dianxiaomi.com/web/productCrawl/edit?id=sample-record";
const secret = /PetLifeGlobal|Charmify|zuhae|sibae|nicae|挂腰风扇|167842582613033710/;

function sample(count: number, searchValue = "", loaded = count > 0, emptyRendered = false): BoxListRead {
  return {
    loaded,
    emptyRendered,
    searchValue,
    rows: Array.from({ length: count }, (_, index) => ({
      title: `示例草稿${index + 1}`,
      productId: String(1_000_000 + index),
    })),
  };
}

function scripted(samples: BoxListRead[]) {
  const reads: BoxListRead[] = [];
  return {
    reads,
    surface: {
      tabId: "box-tab",
      isPaused: () => false,
      journalDir: tempDir(),
      getUrl: () => SMT_BOX_URL,
      listTabs: () => [],
      execute: async (script: string) => {
        expect(script).toContain("sparo-box-list");
        const next = samples[Math.min(reads.length, samples.length - 1)] || sample(0);
        reads.push(next);
        return { ok: true, data: { result: next } };
      },
    },
  };
}

async function finish<T>(work: Promise<T>): Promise<T> {
  const done = work;
  await vi.runAllTimersAsync();
  return done;
}

describe("R10 判重稳定窗", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("抖动序列要第三次一致才返回 8 行", async () => {
    vi.useFakeTimers();
    const eight = sample(8);
    const blank = sample(0, "", false, false);
    const run = scripted([blank, eight, blank, eight, eight, eight]);
    const result = await finish(pollBox(run.surface, "box-tab"));
    expect(result.settled).toBe(true);
    expect(result.read.rows).toHaveLength(8);
    expect(run.reads).toHaveLength(6);
    expect(run.reads[1]?.rows).toHaveLength(8);
  });

  it("true 之后立刻翻转就不提前返回", async () => {
    vi.useFakeTimers();
    const run = scripted([sample(8), sample(0, "", false, false)]);
    const result = await finish(pollBox(run.surface, "box-tab"));
    expect(result.settled).toBe(false);
    expect(run.reads.length).toBeGreaterThan(2);
    expect(result.gaveUp.status).toBe("unknown");
    expect(result.gaveUp.reason).toBe(boxPollExhausted(["ready"]).reason);
    expect(result.gaveUp.reason).not.toMatch(/absent|没有草稿/);
  });

  it("稳定空表三次一致后判 absent", async () => {
    vi.useFakeTimers();
    const empty = sample(0, "", true, true);
    let reads = 0;
    const port = createLiveDxmSmtPort({
      tabId: "edit",
      isPaused: () => false,
      journalDir: tempDir(),
      getUrl: () => crawlUrl,
      listTabs: () => [],
      openTab: async () => "box-tab",
      closeTab: () => undefined,
      execute: async () => {
        reads += 1;
        return { ok: true, data: { result: empty } };
      },
    });
    const result = await finish(port.lookupDraft?.({
      recordId: "sample-record",
      shopId: "S1",
      tabId: "edit",
      title: "示例夹子风扇草稿",
    }) ?? Promise.resolve(undefined));
    expect(result?.status).toBe("absent");
    expect(reads).toBe(3);
    expect(JSON.stringify(empty)).not.toMatch(secret);
  });

  it("预算内反复翻转且出现过表体时停 unknown", async () => {
    vi.useFakeTimers();
    expect(BOX_POLL_BUDGET_MS).toBe(30_000);
    const flipping = [sample(8), sample(0, "", false, false)];
    let reads = 0;
    const port = createLiveDxmSmtPort({
      tabId: "edit",
      isPaused: () => false,
      journalDir: tempDir(),
      getUrl: () => crawlUrl,
      listTabs: () => [],
      openTab: async () => "box-tab",
      closeTab: () => undefined,
      execute: async () => {
        const next = flipping[reads % 2] || sample(0, "", false, false);
        reads += 1;
        return { ok: true, data: { result: next } };
      },
    });
    const result = await finish(port.lookupDraft?.({
      recordId: "sample-record",
      shopId: "S1",
      tabId: "edit",
      title: "示例夹子风扇草稿",
    }) ?? Promise.resolve(undefined));
    expect(result?.status).toBe("unknown");
    expect(result?.status).not.toBe("absent");
    expect(result?.reason).toBe(boxPollExhausted(["ready"]).reason);
    expect(result?.reason).not.toMatch(/absent|没有草稿/);
    expect(reads).toBeGreaterThan(2);
  });

  it("行数相同但搜索词不同不算稳定", async () => {
    vi.useFakeTimers();
    const titled = sample(8, "示例标题");
    const run = scripted([sample(8, ""), titled, titled, titled]);
    const result = await finish(pollBox(run.surface, "box-tab"));
    expect(result.settled).toBe(true);
    expect(result.read.searchValue).toBe("示例标题");
    expect(run.reads).toHaveLength(4);
    expect(sameBoxRead(sample(8, ""), titled)).toBe(false);
  });

  it("sameBoxRead 要四项全等，行数按数量比", () => {
    const left = sample(2, "示例");
    const sameCount = {
      ...sample(2, "示例"),
      rows: [
        { title: "另一条示例", productId: "2000001" },
        { title: "再一条示例", productId: "2000002" },
      ],
    };
    expect(JSON.stringify(sameCount)).not.toMatch(secret);
    expect(sameBoxRead(left, sameCount)).toBe(true);
    expect(sameBoxRead(left, sample(1, "示例"))).toBe(false);
    expect(sameBoxRead(left, sample(2, "别的词"))).toBe(false);
    expect(sameBoxRead(left, { ...left, loaded: false })).toBe(false);
    expect(sameBoxRead(left, { ...left, emptyRendered: true })).toBe(false);
    const start: BoxWindow = { streak: 0, sawLoaded: false };
    const once = advanceBoxWindow(start, left);
    const twice = advanceBoxWindow(once.window, left);
    expect(twice.stable).toBe(false);
    expect(twice.waitMs).toBe(BOX_SETTLE_CONFIRM_MS);
    expect(advanceBoxWindow(twice.window, left).stable).toBe(true);
  });
});
