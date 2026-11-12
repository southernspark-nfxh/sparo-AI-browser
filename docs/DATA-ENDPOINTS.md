# 四平台数据与评论接口（P0b 探针）

> 2026-11-12 一次只读探针。没有实测到的接口不填地址。延迟和分页都是单次快照，写「单次快照无法判定」。

| 平台 | 数据页 URL | 数据接口 | 评论接口 | 字段名 | 分页上限 | 延迟 | 额外头 | 实测状态 |
|---|---|---|---|---|---|---|---|---|
| 头条 | 打开的是 `https://mp.toutiao.com/profile_v4/manage/content/all?enter_from=left_menu`，不是数据页 | 未确认 | 未确认 | 无回包字段 | 单次快照无法判定 | 单次快照无法判定 | 未确认 | 不可用：创作者后台在作品管理页，资源列表里没有可确认的数据或评论接口，未额外发请求 |
| 百家 | 未打开创作者后台 | 未确认 | 未确认 | 无 | 单次快照无法判定 | 单次快照无法判定 | 未确认 | 登录态缺失：没有 `baijiahao.baidu.com/builder` 标签 |
| 大鱼 | 未打开 | 未确认 | 未确认 | 无 | 单次快照无法判定 | 单次快照无法判定 | 未确认 | 登录态缺失：没有 `mp.dayu.com/dashboard` 标签 |
| 搜狐 | 未打开 | 未确认 | 未确认 | 无 | 单次快照无法判定 | 单次快照无法判定 | 未确认 | 登录态缺失：没有 `mp.sohu.com` 创作者后台标签 |

规则表 `platforms/*.json` 的 `dataUrl`、`commentUrl`、`metricsMap` 保持留空。原始结果在 `%APPDATA%\sparo-store\probe\<platform>-data.json` 和 `<platform>-comments.json`。
