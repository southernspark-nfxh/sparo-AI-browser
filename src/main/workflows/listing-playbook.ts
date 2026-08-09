/**
 * 店小蜜速卖通上品 Playbook —— 吸收自 SouthernSpark aliexpress-auto-listing-skill
 * 代码执行只依赖本结构化数据；原文在 strategies/skills/
 *
 * 关键：一键翻译 ≠ 图片翻译
 * - 一键翻译 = 文字字段（标题/属性/描述）
 * - 图片翻译 = 图上中文 OCR 译英（独立步骤）
 */

export type PlaybookStep = {
  id: string;
  module: string;
  goal: string;
  how: string;
  /** autopilot | best_effort | human_only | skip */
  mode: "autopilot" | "best_effort" | "human_only" | "skip";
};

export const LISTING_IRON_RULES = [
  "编辑页绝不刷新/重开（禁止 navigate 离开再回来丢草稿）",
  "不要问用户下一步——playbook 里全有",
  "能填的全填；单步最多 3 次失败就记报告继续",
  "所有星号必填才算完成；缺一写进 QA",
  "绝不自动点「保存并移入待发布」（对该按钮全免疫，人审后手动）",
  "开始前清公告弹窗（.ant-modal-wrap / notice）",
  "图片翻译 ≠ 一键翻译：图翻走 编辑图片→图片翻译→弹窗内一键翻译点两次；文字走页顶一键翻译 dropdown（普通翻译→中文→英文）",
  "改尺寸走 编辑图片→批量改图片尺寸，小边 800",
  "主图必须 6 张；6 张主图都必须做图片翻译",
  "属性 ant-select 共享池脆弱：逐字段、关旧下拉；失败不死磕",
];

export const LISTING_STEPS: PlaybookStep[] = [
  {
    id: "clear_notices",
    module: "启动",
    goal: "清除登录后公告/拦截弹窗",
    how: "移除或关闭 .ant-modal-wrap / notice 类遮罩",
    mode: "autopilot",
  },
  {
    id: "main_images_6",
    module: "产品图片",
    goal: "主图选用恰好 6 张（白底多角度优先）",
    how: "产品信息→产品图片，勾选至「已经选用了 6 张」",
    mode: "autopilot",
  },
  {
    id: "resize_800",
    module: "产品图片",
    goal: "批量改图片尺寸小边 800",
    how: "编辑图片→批量改图片尺寸→等比例/小边→800→生成JPG，等处理完",
    mode: "autopilot",
  },
  {
    id: "image_translate_zh_en",
    module: "产品图片",
    goal: "图片翻译：图上中文→英文（主图必做）",
    how: "编辑图片→图片翻译→选择全部→弹窗「一键翻译」caret→阿里翻译「中文→英文」→再点提交→等已翻译成功N张，禁点取消",
    mode: "autopilot",
  },
  {
    id: "page_onekey_text_translate",
    module: "基本信息",
    goal: "页顶一键翻译：标题/属性/描述等文字英文化",
    how: "scrollTo(0,0)→点页顶「一键翻译」→dropdown 普通翻译「中文→英文」→长等标题英文化",
    mode: "autopilot",
  },
  {
    id: "duty_free",
    module: "其他信息",
    goal: "报价不含关税（SMT 编辑页；采集箱页可跳过）",
    how: "点「不含关税报价」radio；采集箱无控件则跳过",
    mode: "autopilot",
  },
  {
    id: "basic_category",
    module: "基本信息",
    goal: "选择产品分类叶子节点",
    how: "选择分类→categories-box 四列→确认",
    mode: "best_effort",
  },
  {
    id: "attributes",
    module: "属性信息",
    goal: "星号属性填齐（产地/品牌等）",
    how: "逐字段 ant-select；脆弱则记 FAIL 继续",
    mode: "best_effort",
  },
  {
    id: "sku_pricing",
    module: "产品信息",
    goal: "SKU 零售价/货值/库存/重量/物流",
    how: "公式 (成本+5)×1.02÷0.413；本轮 best-effort 读表",
    mode: "best_effort",
  },
  {
    id: "packaging",
    module: "包装信息",
    goal: "包装后重量",
    how: "填 kg",
    mode: "best_effort",
  },
  {
    id: "templates",
    module: "模板信息",
    goal: "运费/服务模板已选",
    how: "非请选择",
    mode: "best_effort",
  },
  {
    id: "qa",
    module: "审核",
    goal: "提交前 QA",
    how: "标题英文、主图6、图片翻译已提交、关税（SMT）、星号提示等——缺一不得 PASS",
    mode: "autopilot",
  },
  {
    id: "human_review",
    module: "发布",
    goal: "人审后手动「保存并移入待发布」",
    how: "Agent 暂停；禁止自动点发布",
    mode: "human_only",
  },
];

export function playbookForAgent(): string {
  return [
    "【职业技能：店小蜜速卖通一句话上品】来源 SouthernSpark listing skills。",
    "用户说 上品/上架/处理好/上架准备 → 立刻 run_workflow(dxm_full_listing)，禁止念菜单。",
    "铁律：",
    ...LISTING_IRON_RULES.map((r, i) => `${i + 1}. ${r}`),
    "步骤（autopilot 必做，best_effort 尽力，human_only 只报告）：",
    ...LISTING_STEPS.map(
      (s) => `- [${s.mode}] ${s.id}「${s.module}」${s.goal} — ${s.how}`,
    ),
  ].join("\n");
}
