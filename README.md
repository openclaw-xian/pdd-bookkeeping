# pdd-bookkeeping

拼多多多店铺「记账四件套」总控 —— DeepSeek Harness (DSH) skill。

按店铺 × 期间，依次调用：

1. `pdd-bills` 货款账单
2. `pdd-promo-cost` 推广花费
3. `pdd-order-export` 订单导出
4. `pdd-kefu-performance` 客服绩效截图

四类产物统一落在 `<账单根目录>/<店铺>/<期间>/`，总控校验产物并写 `report.json`。

## 安装

复制/联接到 `~/.agents/skills/pdd-bookkeeping`，并确保四个子 skill 也已安装。

## 用法

```bash
node run.mjs suite-config.json
```

```json
{
  "root": "D:/pdd-bills",
  "from": "2026-10-01",
  "to": "2026-10-31",
  "shops": [{ "shop": "<店铺A>", "profile": "<profile-A>" }],
  "modules": ["bills", "promo", "orders", "kefu"]
}
```

## 输出

- `<root>/<店铺>/<期间>/`：四类业务产物
- `<root>/_runs/bookkeeping-<时间>/report.json`：模块/店铺状态
- `summary.txt`、`configs/`、`logs/`

## 状态

`done` / `skipped` / `missing` / `needs` / `preflight` / `failed`；exit 4 needs / 3 preflight / 5 failed / 0 done。

详细规则、边界、踩坑见 [SKILL.md](SKILL.md) 和 [references/](references/)。
