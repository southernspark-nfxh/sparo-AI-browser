# 技能包格式（本机先用，社区以后接）

> 给后续 Agent。社区上线仍按 [SKILL-COMMUNITY-M2.md](./SKILL-COMMUNITY-M2.md)，**现在不上网。**  
> 本机已经能 `match_skill` / `run_skill`。打包格式先在仓库里定死，避免每人一套。

## 两套东西不要混

| | 存在哪 | 是什么 | 分享？ |
|---|---|---|---|
| **技能包** `strategies/skills/*.json` | 开机写入 `%APPDATA%\sparo-store\skills\` | 有名字、有步骤、能 `run_skill` | 人点分享后才可以（M2） |
| **本机经验** `lessons.json` | 只留这台电脑 | 「这站要先登录 / 先关弹窗」 | **不自动上传** |

上次 10 场景 QA **只写了报告**，没有落成技能。现在 10 个基础场景各有一个官方种子包。

## 命名

```
<族>-<事>
```

| 族 | 干什么 | 例 |
|---|---|---|
| `life-` | 用户一句话日常 | `life-compare-shop` |
| `research-` | 检索+读页，给手册 | `research-ai-browser` |
| 已有站点包 | 注入一次、人不点发送 | `xhs-longform-publish` `feishu-web-work` `cs-semi-auto-reply` `universal-form-fill` |

口语别名写在 `aliases`，给 `match_skill` 用。不要靠模型临场编步骤。

## 固定字段

```json
{
  "id": "life-compare-shop",
  "title": "人能看懂的一句",
  "kind": "life",
  "version": 1,
  "shareable": true,
  "source": "seeded",
  "platform": "multi",
  "aliases": ["比价"],
  "intent": "什么时候该调这条",
  "declared_domains": ["search.jd.com", "s.taobao.com", "mobile.yangkeduo.com"],
  "declared_actions": ["navigate", "wait_for", "page_text"],
  "human_gates": ["login", "pay", "captcha"],
  "params": { "query": { "type": "string", "required": true } },
  "steps": [{ "tool": "navigate", "args": { "url": "https://…{{queryEnc}}" } }],
  "fallbacks": ["第一站空列表就换备用站"],
  "knownGaps": ["技能解决不了、还要改产品的"],
  "agentPlaybook": ["run_skill({ query: \"比价\", params: { query } })"]
}
```

规则：

- `declared_domains` / `declared_actions` 缺了：本机还能跑；**以后上社区就不许发、不许跑**。
- `human_gates`：登录、验证码、付钱、发送，技能只停，不代做。
- URL 里中文用 `{{参数名Enc}}`（`run_skill` 会 `encodeURIComponent`）。
- 禁止：循环 `fill`、代付款、要验证码内容、把密码写进步骤。
- `knownGaps` 必须写。技能不是验收 100% 的保证书。

## 怎么调

```text
match_skill({ query: "比价" })
run_skill({ query: "比价", params: { query: "索尼WH-1000XM5" } })
```

有匹配技能就不要自己临场点城市弹层、不要直开京东/淘宝/点评首页。

## 10 个基础场景（官方种子）

见 [PRODUCT-TASKBOOK.md](./PRODUCT-TASKBOOK.md) §3.1 与 `strategies/skills/life-*.json`、`research-*.json`。  
QA 原文：[D:\Hermes\sparo-10-scenarios-qa-report.md](file:///D:/Hermes/sparo-10-scenarios-qa-report.md)

**版本**：格式 v1 · 2026-09-09
