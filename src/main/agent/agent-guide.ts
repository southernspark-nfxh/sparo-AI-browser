/** 给外部 Agent 读的说明。不写端口、Token、价格。 */

export const SPARO_AGENT_GUIDE = `你是大脑，Sparo 是浏览器。多步任务不要逐步遥控页面。

工具分层：
- 整任务：用 submit_task 一次交完整目标和素材（标题、正文、图片路径都放进 text）。然后用 get_task 轮询。多步任务建议 execMode 为 auto。
- 原语：navigate、click、fill 只用来读状态和做轻量校验，不要连着点完一整条发布或采集。
- 技能：对人、对你都说「技能」。用 run_skill 或 match_skill。发帖不要循环 fill。客服回复只填草稿，发送由真人点。submit_task 的 text 用自然指令即可，命中技能会自动走剧本。

任务状态：running 进行中，queued 无 clientId 时排在当前侧栏任务后面，done 已结束，interrupted 被打断，failed 失败，pool_full 后台池已满 3 个，你稍后重试。done 的 result.closeReason 只用底账里的 done、blocked、interrupted。

护栏：支付、删除、客服发送仍由真人点，你不要代点确认。跑到 32 轮只在侧栏提醒并继续，每 8 轮再提醒，100 轮才停。素材只存本机：单张 10MB，单任务 20 张，库容 500MB，满了如实说，不自动删。

标签：带 clientId 时，不带 tabId 的操作落在你自己的标签上，不要抢用户当前页。调研要出报告页，不要把对照表堆进聊天。`;

export function agentInstructions(clientId: string): string {
  return `clientId=${clientId}。多步任务（发布、采集、调研）用 submit_task 一次交完整目标和素材，再用 get_task 轮询。navigate、click、fill 只用来读状态和做轻量校验。支付、删除、客服发送仍由真人点。详细用法读 prompt sparo_agent_guide。不带 tabId 的页面操作落在这个 client 自己的标签上，不要抢用户当前页。后台池满返回 pool_full。`;
}

type PromptHost = {
  prompt: (
    name: string,
    description: string,
    cb: () => Promise<{ messages: Array<{ role: "user"; content: { type: "text"; text: string } }> }>,
  ) => unknown;
};

export function registerSparoPrompt(server: PromptHost): void {
  server.prompt(
    "sparo_agent_guide",
    "How you should drive Sparo: hand a whole task to submit_task, poll get_task, and leave payment, deletion, and customer-service send to the human.",
    async () => ({
      messages: [{ role: "user", content: { type: "text", text: SPARO_AGENT_GUIDE } }],
    }),
  );
}
