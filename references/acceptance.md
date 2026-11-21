# 验收清单

## 必须

- [x] 四个子 skill 路径可配
- [x] `modules` 可选/顺序执行
- [x] 生成子配置到 `configs/`
- [x] 子日志到 `logs/`
- [x] 四类产物按 `<root>/<店铺>/<期间>` 校验
- [x] report.json / summary.txt
- [x] needs/preflight/failed/missing/skipped 状态
- [x] kefu 62 天 skip 不阻塞
- [x] 无真实店铺名/个人路径
- [x] 单店 10 月实测通过

## 走查

1. 安装四子 skill
2. 写 suite-config
3. `node run.mjs suite-config.json`
4. 看 `_runs/bookkeeping-<时间>/report.json`
5. 检查每店 `<期间>` 四类产物
6. 只跑一个模块：`modules:["orders"]` 验证

## 记录

- 单店 10 月：bills 2.9s、promo 5.9s、orders 29.6s、kefu 14.2s，全部产物齐，exit 0
