/** 给外部 Agent 读的说明。不写端口、Token、价格。 */

export const SPARO_AGENT_GUIDE = `你是大脑，Sparo 是浏览器。多步任务不要逐步遥控页面。

工具分层：
- 整任务：用 submit_task 一次交完整目标和素材（标题、正文、图片路径都放进 text）。然后用 get_task 轮询。多步任务建议 execMode 为 auto。
- 原语：navigate、click、fill 只用来读状态和做轻量校验，不要连着点完一整条发布或采集。
- 技能：对人、对你都说「技能」。用 run_skill 或 match_skill。发帖不要循环 fill。客服回复只填草稿，发送由真人点。submit_task 的 text 用自然指令即可，命中技能会自动走剧本。

任务状态：running 进行中，queued 在排队（带 clientId 时后台池满也是 queued，不再返回 pool_full，空出来自动开跑；无 clientId 时排在当前侧栏任务后面），done 已结束，interrupted 被打断，failed 失败。done 的 result.closeReason 只用底账里的 done、blocked、interrupted。

护栏：支付、删除、客服发送仍由真人点，你不要代点确认。跑到 32 轮只在侧栏提醒并继续，每 8 轮再提醒，100 轮才停。素材只存本机：单张 10MB，单任务 20 张，库容 500MB，满了如实说，不自动删。

标签：带 clientId 时，不带 tabId 的操作落在你自己的标签上，不要抢用户当前页。调研要出报告页，不要把对照表堆进聊天。

多账号：同一个站点可以同时登录多个号。先 list_envs 看本机已保存的账号环境；用户点名「A 号 / 第二个号 / 另一个百家号」时，拿 envId 传给 navigate({ url, envId }) 或 new_tab({ url, envId })，技能则放 run_skill({ query, params: { envId } })。每个环境一套独立 Cookie / localStorage，互不串号；不传 envId 就是默认登录态。环境里还没登录时如实告诉用户「在这个环境里登录一次」，不要反复重试或换号硬试。`;

export function agentInstructions(clientId: string, docsDir?: string): string {
  const at = docsDir
    ? `完整说明在 ${docsDir}\\AGENTS.md（怎么连、怎么用技能）与 ${docsDir}\\MCP-API.md（全部工具）。安装目录里、和 Sparo.exe 同一层，也有一份 AGENTS.md。`
    : "";
  return `clientId=${clientId}。${at}第一次连接先调 sparo_info，一次拿到能力边界、全部技能 id 与最快路径。有技能走 list_skills → get_skill → run_skill，没有技能再用原语。多步任务（发布、采集、调研）用 submit_task 一次交完整目标和素材，再 get_task 轮询；navigate、click、fill 只用来读状态与轻量校验。支付、删除、客服发送由真人点。不带 tabId 的操作落在自己的标签上，不抢用户当前页。同一个站点要登录多个号时，先 list_envs 拿 envId，再传给 navigate / new_tab（技能放 params.envId），每个环境一套独立 Cookie。后台池满不再返回 pool_full，改为 queued，空出来自动开跑。详细用法读 prompt sparo_agent_guide。`;
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
