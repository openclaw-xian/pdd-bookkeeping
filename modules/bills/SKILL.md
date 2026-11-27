---
name: pdd-bills
description: 拼多多多店铺「货款账单」批量导出与归档。按店铺 × 期间，在商家后台对账中心查询货款明细并导出，文件落到账单根目录下的 <店铺>\<期间>\（zip + GBK CSV + 账单信息.md），自动校验收支合计与页面汇总一致。支持并发跑几十家店、幂等跳过已完成、慢任务挂 pending 后续收取。Use when 用户要导出拼多多货款账单、对账数据、月账单，或要把多家店的账单整理归档。
---

# pdd-bills — 拼多多货款账单批量导出

> 本 skill 文件**不含本机路径、账号或店铺名**：路径自动探测或由配置传入，真实店铺清单放在用户数据目录。
>
> **实现细节 / 踩坑 / 测试记录都在 `references/`（维护前必读）：**
> - `references/dom-contract.md` — 页面结构、所有选择器、日期日历、12 个月限制、下载、文件格式、实测坑
> - `references/implementation.md` — 代码结构、每个方法的实现（日期选择算法、寻店、下载、解压校验）、改版维护指南
> - `references/testing.md` — 测试矩阵、数字结果、性能与已知限制

## 前置条件

- Windows + ego-browser（已登录各店铺 profile）
- Node.js（DSH 自带或系统安装均可）
- 账单根目录：默认 `D:/对账账单`，可在配置里用 `root` 指定；**默认拒绝 C 盘**（机器只有 C 盘时可显式 `"allowC": true`）
- 店铺清单：`<root>/_stores.json`（店铺名 ↔ ego profileName），属于用户数据，不在 skill 内

```json
{
  "version": 1,
  "root": "D:/对账账单",
  "stores": [
    { "shop": "<店铺A>", "profile": "<profile-A>", "enabled": true },
    { "shop": "<店铺B>", "profile": "<profile-B>", "enabled": true }
  ]
}
```

- `shop` 必须与商家后台页面左上角店铺名**完全一致**（worker 会回读校验，不一致直接失败，绝不串账）。
- `profile` 必须与 ego space 的 `profileName` 一致（ego 重启后 spaceId 会变，所以只认 profileName）。

## 用法

```bash
node <skill目录>/batch-run.mjs <config.json>
```

> `<skill目录>` 指本 skill 所在目录（如 `%USERPROFILE%\.agents\skills\pdd-bills`）。skill 内没有写死任何本机绝对路径。

配置示例（除 `period/from/to` 外都可选）：

```json
{
  "period": "2026-08",
  "from": "2026-08-01",
  "to": "2026-08-31",
  "concurrency": 3,
  "mode": "auto",
  "maxWaitSec": 45
}
```

默认值：`root` = `D:/对账账单`（或环境变量 `PDD_BILLS_ROOT`）；`storesConfig` = `<root>/_stores.json`；`runRoot` = `<root>/_runs`；`ego` 自动探测（`~/.local/share/ego` → `~/.local/bin` → PATH，或环境变量 `PDD_EGO_BROWSER`）；临时运行目录 = 系统 temp。

可选字段：

| 字段 | 说明 |
|---|---|
| `only` | 只跑指定店铺，例 `["<店铺A>"]` |
| `shops` | 同 `only`（按店铺名筛选），二选一即可 |
| `mode` | `auto`（默认：该期已 done 则跳过，pending 则收取，否则导出）/ `collect`（只收不提交）/ `doctor`（只读自检） |
| `doctor` | `true` 等价于 `mode:"doctor"`：只检查环境与一次查询，不导出 |
| `force` | `true` 强制重跑，忽略已完成标记 |
| `concurrency` | 并发数，默认 3；店铺几十家时建议 4~6 |
| `maxWaitSec` | 单店提交后最多等多少秒出现「下载账单」，默认 45；超时记 pending 并立即返回，不干等 |
| `root` | 账单根目录（默认 D 盘；C 盘需 `allowC:true`） |
| `allowC` | 允许根目录在 C 盘（默认 false） |
| `autoCreateRoot` | 用户确认后允许自动创建根目录（默认 false） |
| `discover` | 是否自动扫描 ego 建/修 `_stores.json`（默认 true） |
| `ego` / `worker` / `storesConfig` / `runRoot` / `runtimeDir` | 覆盖自动探测值，一般不用填 |

## 自检 doctor（只读，不导出）

```bash
node <skill目录>/batch-run.mjs <doctor.json>
```

```json
{ "doctor": true, "from": "2026-08-01", "to": "2026-08-31", "only": ["<店铺A>"] }
```

- 检查：ego 可用、根目录存在、店铺清单（缺则自动扫描生成）、店铺能登录并打开对账中心、日期能选中、查询能出汇总；
- **不提交导出、不写账单目录、不改 `.tasks.json`**；
- 正常区间会真实查询一次并回显汇总；老区间（>12 个月）只验证导出页能选日期、不提交；
- 输出 `DOCTOR_RESULT` JSON；全部通过退出码 0，否则 1（报告文件在系统 temp）。

## 版本与分发

- 版本：`VERSION`；变更记录：`CHANGELOG.md`（分发多份副本时先看这两个再排查问题）。
- 安装：把本目录复制/联接成 `~/.agents/skills/pdd-bills` 即可（就是个普通 skill 目录，无需额外脚本）。

## 输出

```
<账单根目录>\
├─ _stores.json
├─ _batch-config.json
├─ _runs\<runId>\report.json           # 机器可读报表
├─ _runs\<runId>\summary.txt
├─ _runs\<runId>\results\<店铺>.json
└─ <店铺>\
   ├─ .tasks.json                      # 该店每期的状态
   └─ <期间>\
      ├─ 货款明细_<期间>_<导出时间>.zip
      ├─ <店铺>-对账中心-<月>月.csv  # 例：<店铺A>-对账中心-10月.csv（GBK；前 4 行说明，第 5 行列名）
      └─ 账单信息.md              # 含平台原始 CSV 文件名
```

CSV 命名规则（方便人看）：

- 整月：`<店铺>-对账中心-<月>月.csv`，例 `<店铺A>-对账中心-10月.csv`
- 任意区间：`<店铺>-对账中心-<起>月<日>-<止>月<日>.csv`，例 `<店铺A>-对账中心-3月15日-4月10日.csv`
- 平台原始文件名记录在 `账单信息.md` 的「平台原始文件名」行

`report.json` 每家店：

```json
{ "shop": "<店铺A>", "status": "done|skipped|pending|expired|missing|mismatch|failed",
  "ok": true, "income": 12345.67, "expense": -5432.10,
  "rows": 1000, "matched": true, "zip": "...", "error": null, "needs": null, "wallSec": 19.3 }
```

## 自动找店（不需要用户改映射）

- `_stores.json` 里 `profile` **可省略**，只写 `shop` 即可；`shop` 也可不填（整份清单由 skill 自动生成）。
- 清单缺失 → 先自动扫描 ego 所有 profiles（后台首页读店铺名）→ 生成 `_stores.json` → 再跑。
- `profile` 写错 / 打开后店铺名不符 → worker 自动扫描并**修正清单**，然后继续跑。
- 只有「扫描所有 profile 都没找到目标店铺」时，才提示用户：该店可能还没登录 ego，登录后重跑。
- 配置 `discover:false` 可关闭自动扫描（默认开启）。

## 日期选择规则（worker 已内置，agent 不需要手写）

- **时间固定整日**：输入框格式恒为 `YYYY-MM-DD 00:00:00 ~ YYYY-MM-DD 23:59:59`，不做自定义时间。
- **双月日历是两个独立面板**：每个面板有自己的年份下拉（2018–2037）和 ◀ ▶ 箭头；面板相邻时中间箭头会隐藏，worker 会自动把另一个面板挪开再点。
- **先摆面板，再点日期**：起月放左面板、止月放右面板；摆位时按「目标月 ≥ 当前月点 ▶，否则点 ◀」，每步回读月份+年份校验。
- **两次点击之间不能翻月**：翻面板会清掉已选起点（确认按钮变灰）。所以必须面板到位后再连点起点、终点。
- **单点一天后确认按钮是灰的**属正常，点完第二天才回填完整区间并恢复。
- **跨月**：起点点左表、终点点右表；**跨年**：先摆月份，再用年份下拉把左右面板年份分别改对（改年不动月）。
- **12 个月限制**：起始日 ≤ 今天 − 12 个月时，查询页点「确认」会弹「仅支持查询最近12个月 / 去导出 / 取消」。worker 对老区间**直接跳过查询**、切到导出页签提交导出；导出不受该限制。
- **老区间等待**：默认最多等 12 秒拿「下载账单」，超时直接 pending（下一次 collect），不会卡几十分钟。
- **最后必做回读校验**：点完日期回读输入框必须等于目标区间，否则报错停下，不带错日期去查询/导出。

## 预检：缺东西就停下问用户（不悄悄创建/不硬跑）

运行前会做预检，**任何一项缺失都不会自动乱来**，而是输出：

```
PREFLIGHT=needs_user_input
{ "status": "needs_user_input", "issues": [ { "code": "...", "question": "..." } ] }
PREFLIGHT_FILE=<temp>/pdd-bills-preflight.json
```

agent 看到后必须**把 `question` 转述给用户并等确认**，不要自己猜。预检项：

| code | 场景 | 要问用户什么 |
|---|---|---|
| `root_missing` | 账单根目录不存在 | 是否创建？还是换目录？确认后加 `autoCreateRoot:true` 或手动建 |
| `root_on_c_drive` | 根目录在 C 盘 | 换非系统盘，还是确认允许（`allowC:true`） |
| `stores_config_missing` | 清单不存在且**自动发现也没找到店** | 请确认 ego 至少登录一家店；无需用户填映射（skill 会自己扫） |
| `stores_config_invalid` | JSON 不合法 | 请用户修正 |
| `no_store_selected` | 清单为空或 `only`/`shops` 对不上 | 返回可选店铺名，请用户确认 |
| `ego_not_found` | ego-browser 不可用 | 请安装/启动，或配置 `ego` / `PDD_EGO_BROWSER` |
| `period_invalid` / `range_invalid` / `range_reversed` / `range_in_future` | 日期参数不合法 | 返回当前值，请用户给正确起止日 |

运行中缺项同样会问：

- 所有 profile 里都找不到目标店铺 → `needsUser` 带 `availableProfiles`，提示用户登录该店（**不问映射**）；
- 打开页面店铺名最终仍不符 → `needsUser` 带 `actualShop`，建议重跑让 skill 重新发现。

`report.json` 顶层有 `needsUser` 数组（含每家店的问题），`summary.txt` 末尾直接列出「需要用户确认」。预检通过前不会提交任何导出。

## 行为规则

- **自动找店**：profile 缺失/写错时 worker 自己扫 ego profiles 找到正确店铺并修正 `_stores.json`，不需要用户改映射；只有所有 profile 都找不到该店才提示用户登录。
- **幂等**：`<期间>` 已 done 且文件在 → 直接 `skipped`（约 2 秒/店）。
- **两段式**：提交后等 `maxWaitSec` 仍不见「下载账单」→ 记 `pending` 立即返回；下次运行自动走 collect（默认 2~5 秒/店）。
- **失败隔离**：单店失败只影响该店；其他店继续，最后统一报表。
- **并发**：worker pool + 随机错峰 0~350ms；每家店独占 `.lock`，30 分钟内不允许同店并行。
- **校验闸门**：CSV 收支合计必须与页面查询汇总一致才记 `done`；不一致记 `mismatch` 并保留文件供人工核对。
- **12 个月限制**：起始日必须 > 今天 − 12 个月；超出的走导出（平台慢队列，通常 pending）。

## 红线

1. **不落 C 盘**（默认拒绝；机器只有 C 盘时用户显式 `allowC:true` 才允许）。
2. **不代登录**：profile 未登录时停下报错，不猜账号密码。
3. **不点保存/提交**：只做查询与导出，不碰商品/订单操作。
4. **下载只点一次**：签名 URL 通过 hook `window.open` 获取，失败不重复点。
5. **一店一目录、一期一目录**，绝不混放；同期间重复导出不覆盖（文件名带导出时间）。
6. 校验不过（`mismatch`）不得声称成功，必须报告差异。

## 移植 / 换机

- skill 文件（SKILL.md / batch-run.mjs / worker-export.mjs）可整目录复制，**无需改路径**：
  - ego 自动探测，或环境变量 `PDD_EGO_BROWSER`；
  - 账单根目录由 `root` 配置或 `PDD_BILLS_ROOT` 指定；
  - worker 默认用 skill 同目录的 `worker-export.mjs`。
- 换机后只需准备两样用户数据：`<root>/_stores.json`（店铺 ↔ profile）和已登录的 ego profiles。
- 不含任何账号密码、cookie、token；下载签名 URL 只在内存中使用，不落盘。

## 排障

| 现象 | 原因 / 处理 |
|---|---|
| `space_not_found_for:<profile>` | profileName 与 ego 不一致，或店铺未登录；核对 `_stores.json` |
| `shop_mismatch:…` | profile 登的是别的店；改 profile 或店铺名，不要强跑 |
| `bill_not_ready_yet` / `pending` | 平台生成慢（老账单常见）；属正常，隔一会儿再跑 collect |
| `expired` | 文件过期（约 24h）；重新提交（`force` 或删除该期 task 后重跑） |
| `download_url_not_captured` | 下载按钮行为变化；先看 `_runs/.../logs/<店>.log` 再调 worker |
| `root_on_c_drive` | 根目录在 C 盘；换非系统盘，或显式 `allowC:true` |
| 页面停在 `/main/auth?ticket=` | 一次性跳转；worker 已做等待，如超时重跑一次 |

## 维护

- PDD 后台改版导致选择器/文案失效时：按 `references/implementation.md` 第 11 节「维护指南」定位要改的函数（日历类名、年份下拉、箭头阈值、历史卡片、下载接口、CSV 列顺序等）。
- 改完先拿 **1 家店 + 1 个正常月份** 跑，确认 `report.json` 里 `matched=true`，再扩到多店/并发。
- 本 skill 的页面知识（DOM 契约）与测试证据分别在 `references/dom-contract.md`、`references/testing.md`，改版比对时以它们为基线。
