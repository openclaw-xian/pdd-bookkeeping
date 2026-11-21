# Changelog

## 0.1.0 — 2026-11-21

- 新增记账四件套总控：bills → promo → orders → kefu，模块顺序执行。
- 自动生成四份子配置，校验四类产物，汇总 report.json / summary.txt。
- 支持 `modules/only/concurrency/periodDir/label/kefu retention`。
- 单店 10 月实测：bills skipped（已有产物）、promo 5.9s、orders 29.6s、kefu 14.2s，全部产物齐全。
