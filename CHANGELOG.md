## 0.2.6 — 2026-11-27

- 店铺账本 outputs 按模块过滤，不再把整个期间目录所有文件都记到每个模块。
- bills/promo/orders/kefu 只记录本模块产物。

## 0.2.5 — 2026-11-27

- 读取共享账本配置；店铺账本自动复用同一目录。
- 未配置时仍返回 `ledger_root_required`。

## 0.2.4 — 2026-11-27

- 首次使用必须指定 `ledgerRoot`，未配置返回 `ledger_root_required`，不再默认 C 盘。
- 店铺账本不会在未配置时写入。

## 0.2.3 — 2026-11-27

- 新增店铺级账本 `shop-ledger.mjs`：`店铺/<店铺>/<模块>/<YYYY-MM>/操作记录.jsonl`。
- 总控每跑完一个模块，按店铺记录导出结果、产物、runId。
- 生成 `店铺/<店铺>/店铺档案.json`。

## 0.2.2 — 2026-11-27

- 修复订单模块日期：结束日不再用 `to+1`（今天不能选明天），改为选到 `to` 当天。
- 批量导出弹窗显式写入用户时间范围，避免默认“近90天”覆盖查询范围。
- 放宽报表列表匹配并延长等待，解决生成报表后找不到下载按钮。
- 实测订单：2026-11-01~2026-11-27，305 单，paySum=17074.92，recvSum=17286.17。
- 四模块完整跑通：bills done、promo done/no_data、orders done、kefu done。

## 0.2.1 — 2026-11-27

- 修复总控把模块 `no_data` 误判为 missing/failed：读取子模块 report，`no_data` 视为正常完成。
- 实测内置 `modules/promo`：鱼越贴饰 2026-11-01~2026-11-27，spend=3822.87，生成推广花费.md/截图/账单信息.md。
- 第一次 no_data、第二次有数据，确认总控两种情况都能处理。

## 0.2.0 — 2026-11-27

- `pdd-bookkeeping` 改为唯一入口；`bills/promo/orders/kefu` 四个 skill 原样内置到 `modules/`。
- 总控不再依赖 `~/.agents/skills` 外部路径，默认从本 skill `modules/` 调用。
- 缺少 `modules` 返回 `modules_missing`，先问用户导出内容；时间由用户指定。
- 模块格式/字段/默认值/校验规则完全沿用原 skill。

# Changelog

## 0.1.2 — 2026-11-21

- README 增加 5 个 skill 安装清单、仓库链接、git clone / mklink 示例和装完自检。
- 明确总控不包含子 skill；只装总控会报 child_not_found。

## 0.1.1 — 2026-11-21

- 3 店 10 月总控实测：bills 21.9s、promo 10.1s、orders 47.3s、kefu 15.1s，全部 done，exit 0。
- 一店已有账单时 bills 子 skill skipped，总控按产物校验仍记 done（含义为已完整）。

## 0.1.0 — 2026-11-21

- 新增记账四件套总控：bills → promo → orders → kefu，模块顺序执行。
- 自动生成四份子配置，校验四类产物，汇总 report.json / summary.txt。
- 支持 `modules/only/concurrency/periodDir/label/kefu retention`。
- 单店 10 月实测：bills skipped（已有产物）、promo 5.9s、orders 29.6s、kefu 14.2s，全部产物齐全。
