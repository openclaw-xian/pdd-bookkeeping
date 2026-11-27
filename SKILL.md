---
name: pdd-bookkeeping
description: 拼多多多店铺「记账四件套」总控。按店铺 × 期间依次调用 pdd-bills（货款账单）、pdd-promo-cost（推广花费）、pdd-order-export（订单导出）、pdd-kefu-performance（客服绩效截图），统一归档到 <root>/<店铺>/<期间>/，校验四类产物并汇总 report.json。Use when 用户要一键跑完拼多多记账、月度账单+推广+订单+客服绩效一起归档，或不想分别跑四个 skill。
---

# pdd-bookkeeping — 记账四件套总控

> 只做调度：生成四份子配置 → 依次调用四个子 skill → 校验产物 → 汇总。
> **不直接操作浏览器**，浏览器操作由子 skill 负责。

## 前置条件

- 四个模块已内置在 `modules/`：`bills` / `promo` / `orders` / `kefu`
- 只需安装 `pdd-bookkeeping` 一个 skill；独立仓库保留给单模块调试
- 模块格式、字段、默认值、校验规则沿用原 skill
- Windows + ego-browser；各店 profile 已登录
- Node.js
- 账单根目录（config `root`）

## 用法

```bash
node <skill目录>/run.mjs suite-config.json
```

```json
{
  "root": "D:/pdd-bills",
  "from": "2026-10-01",
  "to": "2026-10-31",
  "shops": [
    { "shop": "<店铺A>", "profile": "<profile-A>" }
  ],
  "modules": ["bills", "promo", "orders", "kefu"]
}
```

- `modules` 默认四件套；可只跑部分
- `only`：只跑指定店铺
- `periodDir` / `label`：部分月份并到同月目录时覆盖（四件套统一）
- `concurrency`：各模块默认并发数；也可 `bills/promo/orders/kefu` 各自配
- `skillsRoot`：子 skill 目录，默认 `~/.agents/skills`

## 执行顺序

**模块优先、顺序执行**：

1. `bills` 货款账单
2. `promo` 推广花费
3. `orders` 订单
4. `kefu` 客服绩效

- 某模块失败/needs 不阻断后面模块
- 最后汇总，exit 取最严重状态

## 子配置

| 模块 | 子配置要点 |
|---|---|
| bills | `period/from/to/root/concurrency/shops(店铺名)/maxWaitSec/autoCreateRoot` |
| promo | `from/to/root/concurrency/shops` |
| orders | `from/to/root/concurrency/retries/shops`；内部结束日 +1 |
| kefu | `from/to/root/concurrency/retentionDays/shops/periodDir/label`；不 +1 |

## 输出

四类产物落在同一个：

```
<root>/<店铺>/<期间>/
├─ <店铺>-对账中心-*.csv + 账单信息.md
├─ <店铺>-推广-*.png + 推广花费.md
├─ <店铺>-订单-*.csv + 订单信息.md
└─ <店铺>-客服绩效-*.png + 客服绩效.md
```

总控产物：

```
<root>/_runs/bookkeeping-<时间>/
├─ report.json        # 按模块/店铺汇总
├─ summary.txt
├─ configs/           # 生成的子配置
└─ logs/              # 子 skill stdout/stderr
```

## 状态/退出码

- `done`：子 skill exit 0 且四类产物齐全
- `skipped`：kefu 早于 62 天保留期
- `missing`：exit 0 但产物缺
- `needs`：子 skill 返回 4（未登录/滑块等）
- `preflight`：子 skill 返回 3
- `failed`：子 skill 返回 5/超时/未知
- 总控退出码：4 needs / 3 preflight / 5 failed / 0 全 done（skipped 不算失败）

## 边界

- `orders` 只支持近 3 个月
- `kefu` 只保留 62 天；更早会标 skipped，不阻塞其他模块
- `bills` 已有完整产物会 skipped（幂等）
- `promo` 近 180 天总览 + 月账单核对，较慢
- 模块顺序执行，不并发跑四个浏览器任务

## 红线

1. 不直接操作浏览器、不代登录
2. 不改子 skill 产物格式
3. 某模块失败不隐藏，report 必须记录
4. 四类产物必须校验存在
5. kefu 超保留期只 skipped，不错算日期

## 执行前必须问用户

缺少 `modules` 时返回 `modules_missing`，不要默认全跑。先问：

1. 这次导出什么：账单 / 订单 / 推广费用 / 客服绩效 / 全部
2. 哪些店铺
3. 时间范围（用户指定）
4. 输出根目录

确认后再生成 `modules` 列表并执行；模块串行，一个店跑完再下一个店。

## 首次使用

必须询问用户运营日志目录并配置 `ledgerRoot`；未配置返回 `ledger_root_required`，不默认 C 盘，不创建目录。
