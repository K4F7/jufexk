# 冻结历史评价包本地 D1 演练清单

本清单对应 issue 92 与 #109，只使用 Cloudflare Vitest 的隔离内存 D1 和仓库内 migrations，不访问生产 API、生产数据库或任何凭证。演练测试会生成与冻结包 `legacy-historical-production-freeze-v2` 契约一致的 522 条可导入记录，并声明另有 419 条关系不可用记录保持隔离，便于在没有把原始历史证据提交到仓库的情况下复现首批导入闭环。

## 命令

```bash
pnpm install --frozen-lockfile
pnpm run test:historical-import-drill
pnpm exec tsc --noEmit
pnpm run test
pnpm run test:browser
pnpm run build
pnpm exec wrangler deploy --dry-run
```

测试从空白 D1 应用全部 `migrations/*.sql`，在导入前记录 courses、teachers、course_teachers 三项计数。导入按 50 条上限分为 11 批，固定契约哈希为批准包 `edcf142cbd0380e734da0cde1923ee976ea9e25ab48147d0b78e218a64bb51af`、目录 `1c761d5e52dff1dc11ba019773184cc2c07f529d9dbe4ecbd906bd56eae20588`。

## 失败恢复与预期结果

第 6 批故意将 1 条教师身份改为不存在的值；接口应以 422 拒绝整批，前 5 批保持 250 条，失败批不得留下部分写入。恢复时重放原始第 6 批及其余批次，最终 `public_historical_reviews` 恰好为 522 条，且 `package_contract` 匹配冻结契约。再次重放全部 11 批，所有记录返回 `created: 0`，数量和公开内容不变。

课程、教师和任课关系计数在导入前后保持不变；课程页与教师页各报告 522 条相同匿名评价。使用 50 条游标分页遍历得到 522 个不重复 ID，公开响应不包含来源、OCR、审核、状态或时间字段。测试结束删除演练课程、教师、任课关系及其历史评价，隔离 D1 不会污染其他测试或生产环境。

## 验收结论

当上述命令全部通过时，可据此批准生产演练：批准总集闭合为 `522 imported + 419 catalog-relation-unavailable = 941 approved`，关系不可用分区不进入导入请求；重复执行幂等，失败恢复已实测，目录计数与公开 API 投影闭合。浏览器桌面/移动冒烟由 `test:browser` 的 Chromium 与 375px 项目执行；该套测试使用本地构建的前端和隔离数据，不携带生产凭证。
