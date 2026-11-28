# pdd-bookkeeping

拼多多多店铺「记账四件套」总控 —— DeepSeek Harness (DSH) skill。

按店铺 × 期间，依次调用：

1. `pdd-bills` 货款账单
2. `pdd-promo-cost` 推广花费
3. `pdd-order-export` 订单导出
4. `pdd-kefu-performance` 客服绩效截图

四类产物统一落在 `<账单根目录>/<店铺>/<期间>/`，总控校验产物并写 `report.json`。

## 内置模块

总控**已内置**四个模块到 `modules/`，不需要单独安装；独立仓库只保留给单模块调试：

| 目录 | 作用 | 入口 | 仓库 |
|---|---|---|---|
| `pdd-bills` | 货款账单 | `batch-run.mjs` | https://github.com/openclaw-xian/pdd-bills |
| `pdd-promo-cost` | 推广花费 | `run.mjs` | https://github.com/openclaw-xian/pdd-promo-cost |
| `pdd-order-export` | 订单导出 | `run.mjs` | https://github.com/openclaw-xian/pdd-order-export |
| `pdd-kefu-performance` | 客服绩效截图 | `run.mjs` | https://github.com/openclaw-xian/pdd-kefu-performance |
| `pdd-bookkeeping` | 唯一入口（含 modules） | `run.mjs` | https://github.com/world-geniuses/pdd-bookkeeping |

### 安装命令（示例）

```bash
mkdir -p ~/.agents/skills
git clone https://github.com/world-geniuses/pdd-bookkeeping.git ~/.agents/skills/pdd-bookkeeping
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
{ "modulesRoot": "<模块目录>" }
```

**只装 `pdd-bookkeeping` 即可；`modules/` 已随包分发，独立模块仓库仅供单模块调试。**

## 用法

```bash
node run.mjs suite-config.json
```

```json
{
  "root": "<记账根目录>",
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

## 执行前先问用户

`run.mjs` 不再默认跑全部模块。缺少 `modules` 时返回 `modules_missing`，先问用户：

- 账单 / 订单 / 推广费用 / 客服绩效 / 全部
- 哪些店铺
- 时间范围（用户指定，不默认）
- 输出根目录

模块的格式、字段、默认值、校验规则完全沿用原 skill，总控只负责编排、串行执行、校验产物和汇总。

## 首次使用

必须询问用户运营日志目录并配置 `ledgerRoot`；未配置返回 `ledger_root_required`，不默认 C 盘，不创建目录。

## 共享账本配置

首次指定 `ledgerRoot` 后会写入共享配置（默认 `%USERPROFILE%/.config/pdd/ledger.json`，可用 `PDD_LEDGER_CONFIG` 覆盖）。其他 skill 自动读取，不再重复询问；配置里只存目录指针，不存业务数据。

## 边界与模块 root

- `orders` 只支持近 3 个月；`kefu` 只保留 62 天。
- 单跑模块时 `root` 由配置决定；总控会统一传 `root`，模块文档默认值只用于单跑。
