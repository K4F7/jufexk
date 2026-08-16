# 历史评价生产导入与验收

生产操作只允许在已批准的维护窗口执行。v2 冻结包固定放在 `D:\19016\Documents\Workload\jufexk-production-inputs\frozen-historical-production-v2`，生产脚本只读取其中的 `manifest.json` 与 `importable-legacy-reviews.jsonl`；`catalog-relation-unavailable.jsonl` 中的 419 条由 #111 独立处理，不得上传。

先准备管理员密码和已导出的生产备份绝对路径，执行只读预检。预检要求备份文件已存在，并核对 v2 目录 marker、3740 门课程、1951 位教师、11482 条任课关系、冻结包契约与 522 条可导入记录；退出码 `2` 表示预览完成且没有写入。

```powershell
$env:JUFEXK_BASE_URL = 'https://xk.sein.moe'
$env:JUFEXK_ADMIN_PASSWORD = '...'
$env:JUFEXK_BACKUP_PATH = 'D:\19016\Documents\Workload\jufexk-production-inputs\backups\historical-production-v2-<UTC_TIMESTAMP>.sql'
pnpm run historical-import:production -- 'D:\19016\Documents\Workload\jufexk-production-inputs\frozen-historical-production-v2'
```

确认预览输出中的 Worker、目录 marker、课程/教师/任课关系计数和备份 SHA-256 后，在同一窗口执行写入。正式写入必须使用一个尚不存在的新备份绝对路径；脚本会先用 Wrangler 创建远程 D1 导出，再逐批提交最多 50 条记录，完整重放一次验证 `existing=522`，并输出可归档的 JSON 审计记录。

```powershell
$env:JUFEXK_BASE_URL = 'https://xk.sein.moe'
$env:JUFEXK_ADMIN_PASSWORD = '...'
$env:JUFEXK_BACKUP_PATH = 'D:\19016\Documents\Workload\jufexk-production-inputs\backups\historical-production-v2-<UTC_TIMESTAMP>.sql'
pnpm run historical-import:production -- 'D:\19016\Documents\Workload\jufexk-production-inputs\frozen-historical-production-v2' --apply |
  Set-Content -Encoding utf8 'D:\19016\Documents\Workload\jufexk-production-inputs\audit\historical-production-v2.json'
```

任何契约、哈希、marker、目录计数、导入计数或幂等复核失败都会中止；保留备份和输出，按演练步骤恢复。公开验收应另外抽查课程与教师入口、搜索和排序页面，确认仅展示匿名文字评价，不宣称评分、投稿、审核或身份功能已上线。
