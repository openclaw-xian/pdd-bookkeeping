# DOM 契约与实测细节（拼多多对账中心）

> 环境基线：Windows + ego lite 0.6.3.14，拼多多商家后台 2026-11-19 的界面。
> 类名带构建 hash（如 `_5-191-0`），**只能用 `[class*=…]` 前缀匹配**，不要写死整串。

## 1. 入口与页面

- 入口：`https://mms.pinduoduo.com/cashier/finance/payment-bills`
- 实际落地：`https://cashier.pinduoduo.com/main/bills?tab=4001&__app_code=113`（标题「对账中心」）
- 打开时可能先经过一次性跳转：`https://cashier.pinduoduo.com/main/auth?ticket=…` → 再跳回 bills；需等 URL 离开 `/main/auth`、正文出现「对账中心」再操作。
- 账户页签：**货款账户 / 营销账户 / 保证金账户**（默认货款账户）
- 子页签：**货款明细 / 日汇总 / 月汇总 / 货款明细导出**
- 筛选行：日期 input（placeholder `开始日期-结束日期`，readonly）、`查询`、`重置`、`导出`、`展开高级选项`；右上 `导出历史`
- 汇总文案：`收入金额（元） +1,234.56 收入笔数（笔） 1234 支出金额（元） -567.89 支出笔数（笔） 567`
- 明细表列：入账时间 / 商户订单号 / 账务类型 / 收支金额(元) / 备注 / 业务描述；一页 20 条倒序

## 2. 日期日历（自定义组件，前缀 RPR_）

结构：
- 外层：`div[class*=outerPickerWrapper]`
- 内容：`section[class*=contentPickerWrapper]`，里面 **2 个 `table`（左右两个独立面板）**
- 月份标题：`span[class*=RPR_dateText]`（按 x 排序：左面板 / 右面板）
- 年份：`input`，value 形如 `2026年`（每个面板一个，按 x 排序）
- 日期格：`td[role=date-cell]`，内层 `div[class*=RPR_cell]`
  - 本月格无 `RPR_outOfMonth`；不可选有 `RPR_disabled`
- 快捷项：今天 / 昨天 / 最近7天 / 最近30天
- 底部：时间输入 `00:00:00 ~ 23:59:59` + `确认` 按钮
- 箭头：`svg[class*=RPR_iconPrevNext]`；带 `RPR_right` 的是「下一月」。1920 宽下坐标约：
  - 左◀ 497 / 左▶ 725 / 右◀ 769 / 右▶ 997
  - 判定：x<750 属于左面板，x>750 属于右面板；右面板 ▶ 的 x>900
  - **面板相邻时只渲染外侧箭头**（左◀ + 右▶），内箭头隐藏

实测行为（踩坑）：
1. 点一下日期：确认按钮**变灰**、输入框仍是旧值；点第二下才回填完整区间并恢复。
2. **两次点击之间翻月会清掉已选起点**，必须先把两个面板摆好再连点起点/终点。
3. 两个月面板**互相独立**：翻左面板不动右面板；年份下拉只改该面板年份、不改月份。
4. 面板相邻（如 11月/12月）时内箭头隐藏；需要时先把另一个面板往外挪一步再点。
5. 年份下拉点 `input` 打开，选项是 `li[class*=cIL_item]`，文本如 `2026年`，范围 2018–2037。

## 3. 12 个月限制

- 触发点：在查询页点「确认」时（不是点查询后）
- 弹层文案：`仅支持查询最近12个月的账单，如需更多账单，可至【货款明细导出】页面导出后查看`
- 按钮：`去导出` / `取消`
- 点「取消」：弹层关闭，日历仍开、越界值保留但不生效；点「查询」会关掉弹层并把日期框退回上次生效区间
- 边界（今天 2026-11-19 实测）：起始日 `2025-11-20` 可查；`2025-11-19` 及更早触发限制 → 规则 ≈ `起始日 > 今天 − 12 个月`（严格大于）
- 「去导出」= 原地切到「货款明细导出」子页签（URL 不变），日期保留

## 4. 导出流程

- 「货款明细导出」页签的日期是**独立状态**（从货款明细切过来通常显示它自己的区间，必须在导出页重设）
- 点 `导出`：**无确认弹窗/无 toast**，静默提交任务
- `导出历史` 是 `<a>`，点击会**新开 Tab**：`https://cashier.pinduoduo.com/main/bills/export-history?tab=4001&__app_code=113`；连点会开多个页签，只点一次
- 历史记录卡片：包含 `账单申请时间 YYYY-MM-DD HH:MM:SS`、`入账时间：A 至 B`、`资金流向/账务类型/金额/商户订单号`、状态按钮
  - 状态：`生成中`（预计导出时间为30分钟）、`下载账单`（提示 N 小时后到期，实测约 24h）、`已过期` + `重新导出`
- 记录识别必须按**卡片**：取 `div`（含「账单申请时间」+ 目标起始日、innerText 长度 <500），按 top 排序取最上面一条；**不能按整页文本切片**（会把相邻记录的状态/按钮算进来）
- 按钮 `下载账单` 的 id 形如 `downloadBalance-btn-0`（按记录位置变化，**不要依赖 id**；在目标卡片里标记按钮再点）

## 5. 下载（关键坑）

- 点「下载账单」**不会触发浏览器 download 事件**（ego 的 `waitForEvent("download")` 等不到），而是 `window.open` 到签名 URL：
  `https://cashier.pinduoduo.com/fluxion/api/file/downloadFile?uuid=…&sign=…&__app_code=113`
- 正确做法：先 hook `window.open` 记录 URL → 点一次按钮 → `page.fetch(url, { saveAs: "<绝对路径>" })`
- **只点一次**：等不到事件时不要重复点，每点一次都会真实发起一次下载（曾出现多次下载）
- 响应头 `content-disposition` 给出文件名，形如
  `pdd-mall-bill-detail(<exportKey>)_<导出时间>_<n>.zip`
  - 注意：`<exportKey>` 是本次导出的文件 key，**不是店铺 code**（同店不同月完全不同）
- 下载有效期约 24 小时，过期需重新提交

## 6. 导出文件格式

- ZIP 内含 1 个 CSV（**GBK 编码**）
- ZIP 解析：用 **中央目录**（EOCD 签名 `0x06054b50` → CD 项 `0x02014b50`），按 method 8 做 `inflateRaw`；本地头解析在带 data descriptor 的 ZIP 上会失败（实测踩过）
- CSV 结构：
  - 第 1~4 行是说明（第 2 行含起止时间，第 3 行分隔提示）
  - 第 5 行才是列名：`商户订单号,入账时间,收入金额(+元),支出金额(-元),账务类型,备注,业务描述`
  - 末尾一行 `#更新时间：…`
- 行数统计会多出约 5 行非数据行（空行/说明/尾行），收支合计与页面汇总在容差 0.005 内一致

## 7. 页面复用坑

- 判断「是不是账单页」**不能只看 URL 是否含 `/main/bills`**：`…/main/bills/export-history` 也包含，会被误判，导致点击「查询」0 命中
- 正确：`/\/main\/bills(\?|#|$)/` 且 URL 不含 `export-history`；命中历史页时强制 goto 账单页

## 8. ego 相关

- space 归属：`ownership=user` 用 `claimTaskSpace`；`agentDelegatedToUser` 用 `takeOverTaskSpace`；否则 `taskSpace`
- spaceId 重启会变，**只按 profileName 找**
- 每店跑完 `task.finish({ keep: [] })` 释放页面（有页面预算）；用户自己的 tab 不会被关
- SVG 没有 `offsetParent`，判可见要用 `getBoundingClientRect()`
- 标记属性会跨轮残留，每次点击前先清同名 `data-*`，避免一次命中多个
