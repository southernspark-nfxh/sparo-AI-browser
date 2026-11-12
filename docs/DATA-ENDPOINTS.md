# 四平台数据与评论接口（P0b 探针）

> 2026-11-12 只读实测。头条、百家已抓到接口；大鱼、搜狐按要求未抓。没有实测到的不填地址。延迟和分页看不出，写「单次快照无法判定」。

| 平台 | 数据页 URL | 数据接口 | 评论接口 | 字段名 | 分页上限 | 延迟 | 额外头 | 实测状态 |
|---|---|---|---|---|---|---|---|---|
| 头条 | `https://mp.toutiao.com/profile_v4/analysis/works-overall/all` | `GET /mp/agw/statistic/v2/content_stat?type=0&app_id=1231` 200；粉丝 `GET /mp/agw/statistic/v2/fans/latest_stat` 200；收益 `GET /mp/agw/income/overview/income/details` 200 | `GET /comment/author_receive_comment/?offset=0&count=10&scene=11&feature=0&user_relation=0&app_id=1231` 200 | 展现 `impression_count`，阅读 `go_detail_count`，点赞 `digg_count`，评论 `comment_count`，粉丝变化 `fans_stat.change_count`，收益 `data.detail[].total`（元，列名创作收益）。转发、收藏这次没有 | 单次快照无法判定 | 单次快照无法判定。页面写「每日 14:00 前更新前一日数据」，这次就绪日 `2026-11-11` | 未确认 | 已登录。单篇列表 `GET /api/feed/mp_provider/v1/` 200，计数在 `itemCounter.showCount/readCount/diggCount/commentCount`，文章号用 `gidStr`。回复框打开后是 `.comment-item-reply-box-showed textarea.byte-textarea` |
| 百家 | `https://baijiahao.baidu.com/builder/rc/analysiscontent` | `GET /author/eco/statistics/appStatisticV3` 200；收益 `GET /author/eco/income4/overviewhome?period_type=1` 200 | `GET /pcui/comment/list?reply_type=0&relation_type=0&size=20&page=1` 200 | 阅读 `view_count`，点赞 `likes_count`，评论 `comment_count`，分享 `share_count`，收藏 `collect_count`，涨粉 `fans_increase`，昨日收入 `yesterday_income`（元）。账号导出对照里没有推荐量，`disp_pv` 是百度搜索量 | 单次快照无法判定 | 单次快照无法判定。分析页写更新至 2026-11-10；按 20261111 请求时 `latest_event_day` 与 `list.event_day` 都是 20261111，阅读 2284 与首页「昨日 +2284」一致。收入页写「数据次日更新」 | 未确认 | 已登录创作者后台。单篇 `GET /author/eco/statistics/articleListStatistic` 200，`rec_count` 对上页面推荐量，`view_count` 对上阅读量。回复框是 `textarea[placeholder="请输入回复的内容"]` |
| 大鱼 | 未打开 | 未确认 | 未确认 | 无 | 单次快照无法判定 | 单次快照无法判定 | 未确认 | 登录态缺失：按你的要求这次不抓 |
| 搜狐 | 未打开 | 未确认 | 未确认 | 无 | 单次快照无法判定 | 单次快照无法判定 | 未确认 | 登录态缺失：按你的要求这次不抓 |

头条、百家的 `dataUrl`、`commentUrl`、`metricsMap` 已按上表写回。大鱼、搜狐仍留空。原始结果在 `%APPDATA%\sparo-store\probe\<platform>-data.json` 和 `<platform>-comments.json`。
