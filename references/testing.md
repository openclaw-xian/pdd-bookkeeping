# 测试记录（pdd-bookkeeping）

> 2026-11-21，店铺匿名化为店铺A。

## 单店 10 月

配置：root=`D:/pdd-bills`，from=2026-10-01，to=2026-10-31，modules 四件套。

| 模块 | 状态 | 耗时 | 产物 |
|---|---|---|---|
| bills | done（child skipped，已有产物） | 2.9s | 对账中心 CSV + 账单信息.md 已存在 |
| promo | done | 5.9s | 推广 PNG + 推广花费.md |
| orders | done | 29.6s | 订单 CSV + 订单信息.md |
| kefu | done | 14.2s | 客服绩效 PNG + 客服绩效.md |

总报告：
```
bookkeeping 20261121030653 2026-10-01~2026-10-31 root=<root>
bills    done
promo    done
orders   done
kefu     done
```
exit 0，四类产物齐全。

## 3 店 10 月

配置：root=`D:/pdd-bills`，3 店，四模块。

| 模块 | 状态 | 耗时 |
|---|---|---|
| bills | done | 21.9s（其中 1 店已有产物，子 skill skipped，产物校验通过） |
| promo | done | 10.1s |
| orders | done | 47.3s |
| kefu | done | 15.1s |

总 exit 0；三店四类产物全部齐全。

## 已验证行为

- 子配置生成到 `_runs/bookkeeping-<时间>/configs/`
- 子日志到 `logs/`
- 子模块失败不阻断后面的模块（按代码路径）
- kefu 早于 62 天会 skipped，不阻塞其他模块（代码路径）
- bills 已有产物会幂等 skipped；总控按产物仍记为 done

## 未实测

- 3 店并行总控（单店已过）
- 某模块 needs/失败后的总报告展示（代码已映射）
- 跨月/部分月 `periodDir` 总控
- kefu skipped 的真实旧月份整批
