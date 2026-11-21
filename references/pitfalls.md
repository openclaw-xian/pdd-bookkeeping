# 踩坑（pdd-bookkeeping）

| 现象 | 根因 | 正确做法 |
|---|---|---|
| bills 报 `no_store_selected` | bills 的 `shops` 只接受店铺名字符串 | 总控已把 `{shop,profile}` 映射成 shop 名数组 |
| 子 skill 找不到 | 未安装到 `~/.agents/skills` | 先装四个子 skill，或用 `skillsRoot` 指向实际目录 |
| 订单子 skill 间隔不足 | 同账号 5 分钟限频 | 总控每次跑都会触发子 skill 的 cooldown/reuse；不要短时间重复跑整批 |
| kefu 子 skill 报 `date_before_retention` | 早于 62 天 | 总控直接标 skipped；其他模块继续 |
| bills 显示 skipped 但总控 done | bills 已有完整产物，幂等跳过 | 产物校验通过即 done；含义是“已完整” |
| 某模块 exit 0 但产物缺 | 子 skill 内部异常但未非零退出 | 总控标 `missing`，exit 5；看 `logs/<module>.log` |
| 总控慢 | 四模块顺序执行 | 正常；bills/promo 本身较重。想快可先单独跑缺失模块 |
| 页面预算/滑块 | 子 skill 自己的页面问题 | 总控看子 skill 的 needs；按子 skill 提示处理 |
