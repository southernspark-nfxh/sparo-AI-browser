# Sparo 云端点数（v4 · 给后续 Agent）

任务书：`D:\Hermes\sparo-pricing-task.md` v4。服务端：[sparo-pay docs/PRICING.md](D:\Hermes\sparo-pay\docs\PRICING.md)。

**不要**在客户端写死价格数字。档位从 `GET /plans` 取。`STORE_CHANNEL=msft` 不拉货架。

## 已拍板

| 档 | 价格 | 点数 | 有效期 |
|---|---|---|---|
| 登录试用 | 0 | 10 | 7 天 |
| 入门 | 5 | 50 | 7 天 |
| 包月 | 19.9 | 400 | 30 天 |
| 包季 | 49.9 | 1000 | 90 天 |
| 包年 | 199 | 4000 | 365 天 |
| 加购 | 12 | 100 | 不过期 |

入门单价约为包月 2 倍；加购约为包月 1.4 倍。订阅一次注入，到期作废。

1 点 = 1 万加权 token。约 N 次 = 剩余点。
