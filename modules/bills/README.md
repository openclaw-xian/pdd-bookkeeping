# pdd-bills

拼多多多店铺「货款账单」批量导出与归档 —— **DeepSeek Harness (DSH) skill**。

按店铺 × 期间，在商家后台对账中心查询货款明细并导出，自动校验收支合计与页面汇总一致，然后按 `<店铺>/<期间>/` 归档。

- 支持并发跑多店、幂等跳过已完成、慢任务挂 `pending` 后续收取
- 自动发现 ego profiles 对应的店铺，不需要手填映射
- 不含本机路径/账号/店铺名；店铺清单与账单数据都在运行时的数据目录

## 安装

把这个仓库目录复制到 DSH 的 skills 目录（或作为 skill 目录直接引用）：

```bash
# 例：复制成用户级 skill
mkdir -p ~/.agents/skills
cp -r . ~/.agents/skills/pdd-bills
```

> Windows 可用目录联接：`mklink /J C:\Users\<你>\.agents\skills\pdd-bills <本仓库路径>`

版本见 [`VERSION`](VERSION)，变更见 [`CHANGELOG.md`](CHANGELOG.md)。

## 前置条件

- Windows + [ego-browser](https://github.com/)（各店铺 profile 已登录）
- Node.js
- 账单数据目录（默认 `D:/对账账单`，非 C 盘；可用配置 `root` 覆盖）

## 用法

```bash
node <skill目录>/batch-run.mjs <config.json>
```

最小配置：

```json
{
  "period": "2026-08",
  "from": "2026-08-01",
  "to": "2026-08-31",
  "concurrency": 3
}
```

- 店铺清单 `_stores.json` 可省略（会自动扫描 ego profiles 生成）；也可以只写店铺名。
- 先自检（只读，不导出）：`{ "doctor": true, "from": "2026-08-01", "to": "2026-08-31" }`
- 详见 [SKILL.md](SKILL.md)：日期规则、预检、自动找店、红线、排障、维护。
- 实现细节 / DOM 契约 / 踩坑 / 测试记录在 [references/](references/)：

| 文件 | 内容 |
|---|---|
| `references/dom-contract.md` | 页面结构、选择器、日历、12 个月限制、下载机制、文件格式 |
| `references/implementation.md` | 日期选择算法、寻店、导出下载、解压校验、幂等调度、改版维护指南 |
| `references/testing.md` | 测试矩阵、结果、性能、已知限制 |

## 产物

```
<root>/<店铺>/<期间>/
├─ 货款明细_<期间>_<导出时间>.zip   # 平台原始导出包
├─ <店铺>-<月>月.csv               # GBK，解压后的明细（区间则 起月日-止月日）
└─ 账单信息.md                     # 店铺/期间/申请时间/行数/收支合计/核对结果
```

## 红线

- 不代登录、不点提交/保存、下载只点一次、不落 C 盘、收支合计不一致不（`mismatch`）得算完成。
