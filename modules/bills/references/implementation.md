# 实现说明（pdd-bills）

> 目的：把“怎么实现的、用什么方法”写清楚，换人或换 agent 维护时不用重新踩坑。
> 两个文件：`batch-run.mjs`（普通 Node 调度器，不依赖 ego）、`worker-export.mjs`（运行在 ego 进程内的单店执行器）。

## 1. 总体结构

```
batch-run.mjs
  ├─ 读配置 + 预检（缺项 → PREFLIGHT=needs_user_input，退出码 3）
  ├─ 缺店铺清单时先跑 discover（worker mode=discover）
  ├─ 按 _stores.json / shops / only 生成 jobs
  ├─ worker pool（concurrency，默认 3）+ 0~350ms 随机错峰
  ├─ 每个 job 生成 wrapper（含 globalThis.__JOB）→ spawn ego-browser nodejs
  ├─ job 结果写 _runs/<runId>/results/<shop>.json
  └─ 汇总 report.json / summary.txt（含 warnings、needsUser）
worker-export.mjs
  ├─ 解析 JOB（shop/profile/period/from/to/root/storesConfig/...）
  ├─ 单店锁 .lock（30 分钟）
  ├─ 找 space：profileName 精确匹配；失败 → 自动发现
  ├─ 打开账单页（精确 URL 判定 + auth 跳转等待）
  ├─ 有已完成的期 → skipped
  ├─ 有 pending → collect；否则 export
  ├─ export：设日期 → 查询（拿页面汇总）→ 切导出页签设日期 → 导出
  ├─ 打开导出历史 → 找卡片 → 下载（hook window.open + page.fetch）
  ├─ 解 ZIP（中央目录）→ 解 GBK CSV → 求和/日期校验 → 写 manifest
  └─ 更新 .tasks.json + 写 result JSON
```

## 2. 店铺寻址（不是靠用户配映射）

- `_stores.json` 只需要 `shop`；`profile` 可省略。
- `resolveSpace()`：`listTaskSpaces()` 取 space 列表，按 `profileName === JOB.profile` 精确匹配；再退化为按 `name === shop`。按 ownership 选 `claimTaskSpace / takeOverTaskSpace / taskSpace`。
- `discoverShops()`：对**每个唯一 profileName** 依次 claim/takeOver → `task.newPage()` → goto `https://mms.pinduoduo.com/home` → 读店铺名：
  1) `[class*='Header_header_name']`
  2) 正文正则 `返回商家后台 (.+?) 退出`
  3) 正则 `(\S{2,20})\s*主账号`
  然后 `finish({keep:[]})` 释放该 space。
- `main()` 逻辑：先按给定 profile 试；若打不开/店铺名不符，就 `discoverShops()` 扫一遍，找到目标店后重新 `resolveSpace()`，并把 `shop → profile` 写回 `_stores.json`（自动修映射）。
- 找不到才报 `shop_not_logged_in`，附带可用 profiles 列表（这是“让用户登录”，不是“让用户配映射”）。

## 3. 日期选择（完整算法）

见 `worker-export.mjs` 的 `setMonthRange` / `alignPanel` / `oneStep` / `setYearFor` / `clickCell`：

1. `ensurePicker`：点日期框；等 `div[class*=outerPickerWrapper]` 可见。
2. `readCal`：读左右月份（`span[class*=RPR_dateText]` 按 x 排序）、年份（`input` value 形如 `2026年` 按 x 排序）、当前 input value。
3. 同月区间：`alignPanel('left', 起月)` → `setYearFor('left', 起年)` → 点左表起日/止日。
4. 跨月/跨年：先 `alignPanel('right', 止月)`，再 `alignPanel('left', 起月)`，然后分别 `setYearFor` 左右；点**左表起日** + **右表止日**；再校验左右月份/年份，不满足就再循环（最多 8 轮）。
5. `alignPanel`：每步比较当前月与目标月，`cur > target` 点 ◀，否则点 ▶；每步重读。若内箭头缺失（面板相邻），`oneStep` 会先把另一面板往外挪一步（左▶缺→点右▶；右◀缺→点左◀）再重试。
6. `clickCell(tableIdx, day)`：取该 table 内**非 outOfMonth、非 disabled** 且文本等于 day 的 `td`，要求唯一命中，打 `data-ego-cell` 后真实点击。
7. 点完后 `waitForFunction` 等 input value == 目标区间；回读不等 → 报错停下。
8. 点「确认」后检测 12 个月气泡（正文含「仅支持查询最近12个月」）→ 若有，点「去导出」。

老区间（`from <= 今天-12个月`）：
- `runExportFlow` 里 **跳过查询**（查询页确认会弹窗且无效），直接切导出页签、设日期、导出；`pageSummary = null`，最终 `matched = null`。
- 调度器对老区间默认 `maxWaitSec = 12`（除非用户显式配置），避免空等 30 分钟。

## 4. 查询与汇总

- 点 `查询`；`waitQueryDone` 等表格出现一行日期以**结束月**开头（倒序首行在结束月）。
- `readSummary` 抓一段同时含四项指标的文本；`parseSummary` 正则：
  `收入金额（元）\s*\+?\s*([\d.]+).*?收入笔数（笔）\s*(\d+).*?支出金额（元）\s*-?\s*([\d.]+).*?支出笔数（笔）\s*(\d+)`
  数字去掉 `,` 和 `+`，支出取负。

## 5. 导出与导出历史

- 切页签：点击文本 `货款明细导出`。
- 导出页签日期若 != 期望值 → 再跑一次 `setMonthRange('export')`（导出页日期独立）。
- 点 `导出`（`loc=role:button[name='导出']`），记录 `clickedAt = Date.now()`。
- 点 `导出历史`（anchor），用 `page.waitForEvent("popup")` 抓新页；失败则从 `task.tabs()` 找最近的 `export-history` tab。
- `findCard(minApplyMs)`：只在 `div`（含「账单申请时间」+ `fromPrefix`、innerText<500）里找，按 top 排序取最上面；解析卡片里的 `账单申请时间` 与 `clickedAt-120000` 比较，避免拿到旧记录；卡片内找 `下载账单` 按钮并打 `data-ego-dl`。
- 轮询到 `maxWaitSec` 为止；仍未 ready → 写 `.tasks.json` 为 `pending` 并返回。

## 6. 下载

- `window.open` hook：`window.__egoOpenUrls = []`，包裹 `window.open` 记录 URL。
- 点 `[data-ego-dl]` 一次；等待 ~800ms；取 `downloadFile` URL。
- `page.fetch(url, { saveAs })` 存临时文件；从 `content-disposition` 解析服务端文件名与导出时间。
- 不再等 `download` 事件、不重复点击。

## 7. 解压 / 解析 / 校验

- `unzipCsv(buf)`：EOCD → CD 项 → `localOffset` → local header 长度 → 数据 → method 8 `inflateRawSync`。
- CSV：`new TextDecoder("gbk")`（Node 24 内置可用）；从 `商户订单号` 行取表头；逐行 split 求和；日期取第 2 列前 10 字符。
- 校验：`Math.abs(csvSum - pageSummary.sum) < 0.005`；日期范围 == `from/to`；不一致 status `mismatch`。

## 8. 归档

- 目录：`<root>/<店铺>/<期间>/`
- ZIP：`货款明细_<期间>_<导出时间>.zip`
- CSV：`<店铺>-对账中心-<月>月.csv`（整月）；`<店铺>-对账中心-<起>月<日>-<止>月<日>.csv`（区间）
- `账单信息.md`：店铺/期间/申请时间/zip/csv/平台原始文件名/行数/收支合计/日期核对/与页面汇总
- 截图：本模块**不生成截图**（货款数据以 ZIP/CSV 为准；截图只在 pdd-promo-cost 推广模块里做）
- `.tasks.json`：每期一条（status/applyTime/file/csvName/rows/income/expense/matched/pageSummary）
- 失败保留文件供人工核对（mismatch 不改 status 为 done）
- 与 `pdd-promo-cost` 协作：`账单信息.md` 重写时用 `withPromoBlock()` 保留 `<!-- promo:start --> … <!-- promo:end -->` 块（推广花费），不会覆盖对方写入的数据。

## 9. 调度与幂等

- `skipped`：tasks 里 done 且 zip 文件存在、且 mode != force。
- `pending/ready`：自动走 collect（只查历史、ready 就下载）。
- `expired`：提示重新提交；`force` 可忽略 done 重跑。
- 锁：`<店铺>/.lock`（30 分钟有效期），防同店并发。
- 并发：worker pool；单店失败隔离；报表含 `needsUser`、`warnings`。

## 10. 预检

- 错误类问题进 `issues` → 打印 `PREFLIGHT=needs_user_input` + JSON，退出码 3。
- root 缺失默认不建（用户确认后可 `autoCreateRoot:true`）；C 盘默认拒绝（`allowC:true` 才允许）。
- 店铺清单缺失且 `discover != false` → 自动发现建清单。
- 日期参数校验：格式、倒挂、未来日期。

## 10bis. doctor（只读自检）

- 触发：配置 `doctor:true` 或 `mode:"doctor"`。
- batch-run：先跑同样的预检（root/ego/清单/日期）；通过后对每家店**串行**起一个 `mode:"doctor"` worker，输出 `DOCTOR_RESULT` JSON。
- worker：`openShopSpace()`（同正式流程：按 profile 解析、读店铺名、必要时自动发现）→
  - 正常区间：`setMonthRange` → 点查询 → 等结果 → 解析汇总 → 回读日期；
  - 老区间：切导出页签 → 选日期 → **不点导出**；
  - 不写 `.tasks.json`、不下载、不建 `_runs` 目录；
  - 结果含 `shop/from/to/oldRange/dateValue/summary/ok`。
- 用途：PDD 改版后先跑 doctor，能在不产生任何账单的前提下发现日历/按钮/文案失效。

## 10ter. 版本 / 分发

- `VERSION`：当前版本号；`CHANGELOG.md`：每次改动的日期与内容（DOM 契约或行为变了必须记）。
- 分发：把本目录复制或目录联接到 `~/.agents/skills/pdd-bills` 即可；skill 目录本身就是安装单元，不额外提供安装脚本。
- 分发多副本时，先比对 `VERSION` 再排查行为差异。

## 11. 维护指南（PDD 改版时改哪里）

| 变的东西 | 改哪里 |
|---|---|
| 页面 URL / 入口 | `BILLS_URL`、`HIST_URL` |
| 日历类名/结构 | `ensurePicker`、`readCal`、`clickCell`、`clickArrow` 里的选择器 |
| 年份下拉选项结构 | `setYearFor` 的 `li[class*=cIL_item]` |
| 面板箭头位置/规则 | `markArrow` 的 x 阈值（750/900） |
| 12 个月弹层文案/按钮 | `setMonthRange` 末尾的 popup 检测与「去导出」 |
| 导出历史卡片/状态/按钮 | `findCard`、`downloadBill` |
| 下载接口/文件格式 | `downloadBill`（URL 模式）、`unzipCsv`、`parseCsv` |
| 店铺名读取方式 | `readShopName`、`readShopNameFromPage` |
| 表格列顺序 | `parseCsv` 的下标（0 订单号 / 1 入账时间 / 2 收入 / 3 支出） |

改完先拿 1 家店、1 个正常月份（有数据、非老账单）跑一遍，看 `report.json` 的 `matched=true` 再扩量。
