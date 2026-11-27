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
