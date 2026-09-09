# 云订阅 — 给后续 Agent（v4 点数）

> 2026-09-07 按反馈收紧试用、拉开入门/包月单价、订阅点有明确有效期。  
> 产品叙事：[PRODUCT.md](./PRODUCT.md) · 货架：[PRICING.md](./PRICING.md) · 任务书：`D:\Hermes\sparo-pricing-task.md` v4

---

## 30 秒

| 事实 | 不要搞反 |
|---|---|
| 免费永远自备 Key（`llmMode: "byok"`） | 不要阉割 BYOK |
| 订阅 = 可选云端模型；Key 只在独立代理 | 不要把云端真 Key 写入 settings |
| 1 次任务 = 一次 `handleChatJob` | 不要按每次 HTTP 扣 |
| 1 点 = **1 万**加权 token；约 N 次 = **剩余点** | — |
| 登录送 **10** 点，**7 天**作废 | 不是 20 点不过期 |
| 入门 50 / 月 400 / 季 1000 / 年 4000 / 加购 100 | 入门·订阅有期限；加购不过期 |
| 扣点：有期限池 → 订阅池 → 永久 bonus | — |
| 用尽才露档位；系统浏览器付款 | `msft` 不写 ¥ |

---

## 计量

1. `/tasks/start` → 多轮 HTTP 同 `task_id` → settle 折点  
2. 订阅到期：订阅点清零；永久加购仍在  
3. 试用/入门到期：timed 清零  

## 验收

1. 登录 10 点；用完拒开新任务  
2. 订酒店只 1 个 `task_id`  
3. `msft` 搜不到 ¥ / 19.9  
4. 自备 Key 看不见价目表  

`listings/` **未改**。Skill 社区是 M2，方案见 [SKILL-COMMUNITY-M2.md](./SKILL-COMMUNITY-M2.md)，M1 人测过完再开。
