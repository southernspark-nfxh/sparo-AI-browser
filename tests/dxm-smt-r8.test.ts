import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  READ_CLAIM_DIALOG_SCRIPT,
  claimDialogIssue,
  claimProofIssue,
  claimSelectorsReady,
  pickClaimShop,
  planClaim,
  readClaimDialogFromHtml,
} from "../src/main/workflows/dxm-smt-claim.js";
import { replayOrders } from "../src/main/workflows/dxm-smt-journal.js";
import { resetDxmSmtRuntime, runDxmSmtWorkflow } from "../src/main/workflows/dxm-smt-listing.js";
import { createLiveDxmSmtPort } from "../src/main/workflows/dxm-smt-live.js";
import { basePort, editProbe, tempDir } from "./dxm-smt-helpers.js";

const dirName = dirname(fileURLToPath(import.meta.url));
const dialogHtml = readFileSync(join(dirName, "fixtures", "dxm-smt-claim-dialog.html"), "utf8");
const emptyHtml = readFileSync(join(dirName, "fixtures", "dxm-smt-claim-empty.html"), "utf8");
const secret = /PetLifeGlobal|Charmify|zuhae|sibae|nicae|挂腰风扇|167842582613033710/;
const consent = { claimConsent: "认领这条到示例店铺A" };

function unclaimedProbe() {
  return { ...editProbe(), draftId: undefined, draftShopId: undefined };
}

describe("R8 认领授权与选店", () => {
  it("弹窗里唯一精确命中目标店时，计划只点保存并认领、该店和确认", () => {
    expect(dialogHtml).not.toMatch(secret);
    expect(emptyHtml).not.toMatch(secret);
    expect(READ_CLAIM_DIALOG_SCRIPT).not.toContain(".click(");
    const read = readClaimDialogFromHtml(dialogHtml);
    const plan = planClaim(read, { shopName: "示例店铺A" });
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.shop).toMatchObject({ name: "示例店铺A", shopId: "" });
      expect(plan.clicks).toEqual(["保存并认领", "示例店铺A", "确定"]);
    }
    expect(claimProofIssue(
      { draftId: "D1", shopId: "9001", recordId: "sample-record" },
      { shopId: "9001", recordId: "sample-record" },
    )).toBeUndefined();
  });

  it("没有匹配到目标店时停等并列出候选，不点确认", () => {
    const read = readClaimDialogFromHtml(dialogHtml);
    const plan = planClaim(read, { shopId: "0000", shopName: "没有这家" });
    expect(plan.ok).toBe(false);
    if (!plan.ok) {
      expect(plan.reason).toContain("示例店铺A");
      expect(plan.reason).toContain("示例店铺B");
      expect(plan.clicks).not.toContain("确定");
    }
  });

  it("多家同名时停等列候选，不默认第一家", () => {
    const picked = pickClaimShop(
      [
        { name: "示例店铺A", shopId: "9001" },
        { name: "示例店铺A", shopId: "9002" },
      ],
      { shopName: "示例店铺A" },
    );
    expect(picked.ok).toBe(false);
    if (!picked.ok) {
      expect(picked.reason).toContain("匹配了多家");
      expect(picked.reason).toContain("示例店铺A");
    }
  });

  it("弹窗没出现时停等，工作单不写草稿号", async () => {
    const issue = claimDialogIssue(readClaimDialogFromHtml(emptyHtml));
    expect(issue).toContain("认领弹窗");
    const dir = tempDir();
    let writes = 0;
    const result = await runDxmSmtWorkflow({
      id: "dxm_smt_prepare",
      params: { sourceRecordId: "R1", shopId: "S1", ...consent },
      port: basePort(dir, {
        readProbe: async () => unclaimedProbe(),
        lookupDraft: async () => ({ status: "absent" }),
        claim: async () => ({ ok: false, blocker: "entry", message: issue || "点保存并认领后没有出现认领弹窗，已停等" }),
        writeField: async () => {
          writes += 1;
          return { ok: false, readback: "" };
        },
      }),
    });
    expect(String(result.message)).toContain("认领弹窗");
    expect(replayOrders(dir)[0]?.claimedDraftId).toBeUndefined();
    expect(writes).toBe(0);
  });

  it("确认后读回缺草稿号时不进入编辑", async () => {
    const dir = tempDir();
    let writes = 0;
    const result = await runDxmSmtWorkflow({
      id: "dxm_smt_prepare",
      params: { sourceRecordId: "R1", shopId: "S1", ...consent },
      port: basePort(dir, {
        readProbe: async () => unclaimedProbe(),
        lookupDraft: async () => ({ status: "absent" }),
        claim: async () => ({ ok: true, shopId: "S1", recordId: "R1", message: "缺草稿号" }),
        writeField: async () => {
          writes += 1;
          return { ok: false, readback: "" };
        },
      }),
    });
    expect(String(result.message)).toContain("读回不到草稿");
    expect(replayOrders(dir)[0]?.claimedDraftId).toBeUndefined();
    expect(writes).toBe(0);
    expect(claimProofIssue({ shopId: "S1", recordId: "R1" }, { shopId: "S1", recordId: "R1" })).toContain("读回不到草稿");
  });

  it("没有认领原话时零调用，页面零点击", async () => {
    const dir = tempDir();
    let claims = 0;
    const result = await runDxmSmtWorkflow({
      id: "dxm_smt_prepare",
      params: { sourceRecordId: "R1", shopId: "S1" },
      port: basePort(dir, {
        readProbe: async () => unclaimedProbe(),
        lookupDraft: async () => ({ status: "absent" }),
        claim: async () => {
          claims += 1;
          return { ok: true, draftId: "D1", shopId: "S1", recordId: "R1", message: "不应执行" };
        },
      }),
    });
    expect(claims).toBe(0);
    expect(String(result.message)).toContain("认领需要你当场确认");
    expect(String(result.message)).toContain("没有点保存并认领");
  });

  it("确认后本地没落账时，再查不到草稿也不二次认领", async () => {
    const dir = tempDir();
    let claims = 0;
    const port = () => basePort(dir, {
      readProbe: async () => unclaimedProbe(),
      lookupDraft: async () => ({ status: "absent" as const }),
      claim: async () => {
        claims += 1;
        return { ok: true, draftId: "D1", shopId: "S1", recordId: "R1", message: "已点确认" };
      },
      afterClaim: () => {
        throw new Error("local-crash");
      },
    });
    await expect(runDxmSmtWorkflow({
      id: "dxm_smt_prepare",
      params: { sourceRecordId: "R1", shopId: "S1", ...consent },
      port: port(),
    })).rejects.toThrow(/local-crash/);
    resetDxmSmtRuntime();
    const again = await runDxmSmtWorkflow({
      id: "dxm_smt_prepare",
      params: { sourceRecordId: "R1", shopId: "S1", ...consent },
      port: port(),
    });
    expect(claims).toBe(1);
    expect(String(again.message)).toContain("不会再次认领");
    expect(replayOrders(dir).at(-1)?.claimedDraftId).toBeUndefined();
  });

  it("写字段、翻译、保存、发布和选分类仍然拒绝", async () => {
    expect(claimSelectorsReady()).toBe(true);
    const port = createLiveDxmSmtPort({
      tabId: "edit",
      isPaused: () => false,
      journalDir: tempDir(),
      getUrl: () => "https://www.dianxiaomi.com/web/productCrawl/edit?id=sample-record",
      listTabs: () => [],
      execute: async () => ({ ok: true, data: { result: {} } }),
    });
    expect((await port.claim({ tabId: "edit", shopId: "9001" })).ok).toBe(false);
    expect((await port.writeField("edit", "title", "示例")).ok).toBe(false);
    expect((await port.translateText("edit")).ok).toBe(false);
    expect((await port.translateImages("edit", "main", "图片翻译")).ok).toBe(false);
    expect((await port.saveDraft("edit")).ok).toBe(false);
    expect((await port.clickPublish("edit")).ok).toBe(false);
    expect((await port.selectCategory?.("edit", "1"))?.ok).toBe(false);
  });

  it("带认领原话并读回三证后，不再停在判重或认领入口", async () => {
    const dir = tempDir();
    const result = await runDxmSmtWorkflow({
      id: "dxm_smt_prepare",
      params: { sourceRecordId: "R1", shopId: "S1", shopName: "店铺甲", ...consent },
      port: basePort(dir, {
        readProbe: async () => unclaimedProbe(),
        lookupDraft: async () => ({ status: "absent" }),
        claim: async () => ({ ok: true, draftId: "D1", shopId: "S1", recordId: "R1", shopName: "店铺甲", message: "已认领" }),
      }),
    });
    const saved = replayOrders(dir).at(-1);
    expect(saved?.claimedDraftId).toBe("D1");
    expect(saved?.state === "claimed" || saved?.checkpoint?.reliableState === "claimed" || saved?.state === "draft_ready").toBe(true);
    expect(String(result.message)).not.toContain("无法判重");
    expect(String(result.message)).not.toContain("认领入口没有已核对标记");
  });

  it("认领后编辑页地址没有草稿号就停等，并记下草稿号", async () => {
    const dir = tempDir();
    const result = await runDxmSmtWorkflow({
      id: "dxm_smt_prepare",
      params: { sourceRecordId: "R1", shopId: "S1", ...consent },
      port: basePort(dir, {
        readProbe: async () => unclaimedProbe(),
        lookupDraft: async () => ({ status: "absent" }),
        listTabs: async () => [{ id: "edit-1", url: "https://www.dianxiaomi.com/web/productCrawl/edit?id=sample-record" }],
        claim: async () => ({ ok: true, draftId: "D9", shopId: "S1", recordId: "R1", message: "已点确认" }),
      }),
    });
    expect(String(result.message)).toContain("没有进入草稿编辑页");
    expect(replayOrders(dir).at(-1)?.claimedDraftId).toBe("D9");
  });
});
