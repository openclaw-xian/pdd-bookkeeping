# 实现说明（pdd-bookkeeping）

## 结构

```
run.mjs   普通 Node，总控
```

总控**不直接操作浏览器**，只：
1. 读总控 config
2. 生成四份子配置
3. spawn 子 skill 的 Node 入口
4. 收集 exit code / 日志
5. 按模块校验 `<root>/<店铺>/<期间>/` 产物
6. 写 `report.json` / `summary.txt`

## 子 skill 入口

| 模块 | 默认路径 | 入口 |
|---|---|---|
| bills | `~/.agents/skills/pdd-bills` | `batch-run.mjs` |
| promo | `~/.agents/skills/pdd-promo-cost` | `run.mjs` |
| orders | `~/.agents/skills/pdd-order-export` | `run.mjs` |
| kefu | `~/.agents/skills/pdd-kefu-performance` | `run.mjs` |

可用 config `skillsRoot` 覆盖根目录。

## 生成子配置

- bills：`period/from/to/root/concurrency/shops(店铺名数组)/mode:auto/maxWaitSec/autoCreateRoot`
- promo：`from/to/root/concurrency/shops`
- orders：`from/to/root/concurrency/retries/shops`
- kefu：`from/to/root/concurrency/retentionDays/shops/periodDir/label`

注意：**bills 的 `shops` 只接受店铺名字符串数组**，不能传 `{shop,profile}` 对象；总控已做映射。

## 产物校验

每店每模块检查：

| 模块 | 必须存在 |
|---|---|
| bills | `账单信息.md` + 文件名含 `-对账中心` 的 CSV |
| promo | `推广花费.md` + 文件名含 `-推广` 的 PNG |
| orders | `订单信息.md` + 文件名含 `-订单` 的 CSV |
| kefu | `客服绩效.md` + 文件名含 `-客服绩效` 的 PNG |

## 状态映射

- child exit 0 + 产物齐 → `done`
- child exit 4 → `needs`
- child exit 3 → `preflight`
- child exit 5/超时 → `failed`
- exit 0 但缺产物 → `missing`
- kefu 早于 62 天 → `skipped`（不调 child）

总控退出码：needs 4 / preflight 3 / failed/missing 5 / 其他 0。

## 扩展

- 新增模块：在 `CHILD` + `childConfig` + 产物 checks 三处加。
- 想改顺序：`modules` 数组顺序即执行顺序。
- 想一店四件套串行：可后续加 `mode:"per-store"`；当前是模块优先。
