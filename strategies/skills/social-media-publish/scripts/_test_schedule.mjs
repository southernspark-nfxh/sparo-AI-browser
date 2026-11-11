// 最小化 runSchedule 测试
import { page, runSchedule } from "./page.mjs";

const ctx = { 
  tabId: "2abf3f71", 
  host: "baijiahao.baidu.com",
  schedule: { date: "2026-11-12", time: "10:00", text: "2026-11-12 10:00" }
};

// 先 dump 页面状态
console.log("=== 1. 初始状态 ===");
const init = await page(ctx, `(() => {
  const modals = document.querySelectorAll('[class*="cheetah-modal-wrap"], [class*="cheetah-modal-mask"]');
  const selects = Array.from(document.querySelectorAll('.cheetah-select')).filter(el => el.getBoundingClientRect().height > 0);
  return JSON.stringify({ href: location.href, modalCount: modals.length, selectCount: selects.length });
})()`);
console.log("init:", init.value);

// 直接调 runSchedule
console.log("\n=== 2. runSchedule ===");
const result = await runSchedule(ctx);
console.log("runSchedule result:", JSON.stringify(result, null, 2));

// 成功后确认
if (result.ok) {
  console.log("\n✅ 定时设置成功！");
} else {
  console.log("\n❌ 定时设置失败");
}
