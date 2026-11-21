# pdd-bookkeeping

拼多多多店铺「记账四件套」总控 —— DeepSeek Harness (DSH) skill。

按店铺 × 期间，依次调用：

1. `pdd-bills` 货款账单
2. `pdd-promo-cost` 推广花费
3. `pdd-order-export` 订单导出
4. `pdd-kefu-performance` 客服绩效截图

四类产物统一落在 `<账单根目录>/<店铺>/<期间>/`，总控校验产物并写 `report.json`。

## 安装清单（5 个，缺一不可）

总控**不包含**四个子 skill，必须单独安装到 `~/.agents/skills/`：

| 目录 | 作用 | 入口 | 仓库 |
|---|---|---|---|
| `pdd-bills` | 货款账单 | `batch-run.mjs` | https://github.com/openclaw-xian/pdd-bills |
| `pdd-promo-cost` | 推广花费 | `run.mjs` | https://github.com/openclaw-xian/pdd-promo-cost |
| `pdd-order-export` | 订单导出 | `run.mjs` | https://github.com/openclaw-xian/pdd-order-export |
| `pdd-kefu-performance` | 客服绩效截图 | `run.mjs` | https://github.com/openclaw-xian/pdd-kefu-performance |
| `pdd-bookkeeping` | 本总控 | `run.mjs` | https://github.com/openclaw-xian/pdd-bookkeeping |

### 安装命令（示例）

```bash
mkdir -p ~/.agents/skills
git clone https://github.com/openclaw-xian/pdd-bills.git ~/.agents/skills/pdd-bills
git clone https://github.com/openclaw-xian/pdd-promo-cost.git ~/.agents/skills/pdd-promo-cost
git clone https://github.com/openclaw-xian/pdd-order-export.git ~/.agents/skills/pdd-order-export
git clone https://github.com/openclaw-xian/pdd-kefu-performance.git ~/.agents/skills/pdd-kefu-performance
git clone https://github.com/openclaw-xian/pdd-bookkeeping.git ~/.agents/skills/pdd-bookkeeping
```

Windows 也可以直接用目录联接：

```bat
mklink /J %USERPROFILE%\.agents\skills\pdd-bills <pdd-bills路径>
mklink /J %USERPROFILE%\.agents\skills\pdd-promo-cost <pdd-promo-cost路径>
mklink /J %USERPROFILE%\.agents\skills\pdd-order-export <pdd-order-export路径>
mklink /J %USERPROFILE%\.agents\skills\pdd-kefu-performance <pdd-kefu-performance路径>
mklink /J %USERPROFILE%\.agents\skills\pdd-bookkeeping <pdd-bookkeeping路径>
```

### 装完自检

```bash
dir %USERPROFILE%\.agents\skills /b
```

应看到 5 个目录。总控默认从 `~/.agents/skills` 找；放在别处时配置：

```json
{ "skillsRoot": "D:/pdd-skills" }
```

**只装 `pdd-bookkeeping` 会报 `child_not_found`，这是预期行为。**

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
