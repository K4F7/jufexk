# 历史评价生产导入与验收

生产操作只允许在已批准的维护窗口执行。冻结包必须放在工作区外的受控目录，包含 `manifest.json` 与 `importable-legacy-reviews.jsonl`；脚本不会读取或上传其他分区。

先准备管理员密码和备份路径，执行只读预检。预检要求备份文件已存在，并核对目录 marker、冻结包契约与 941 条可导入记录；退出码 `2` 表示预览完成且没有写入。

```bash
JUFEXK_BASE_URL=https://xk.sein.moe \
JUFEXK_ADMIN_PASSWORD='...' \
JUFEXK_BACKUP_PATH=.local-data/historical-import-before.sql \
pnpm run historical-import:production -- /secure/frozen-historical-production-v1
```

确认预览输出中的 Worker、目录 marker、课程/教师/任课关系计数和备份 SHA-256 后，在同一窗口执行写入。脚本会先用 Wrangler 创建远程 D1 导出，再逐批提交最多 50 条记录，完整重放一次验证 `existing=941`，并输出可归档的 JSON 审计记录。

```bash
JUFEXK_BASE_URL=https://xk.sein.moe \
JUFEXK_ADMIN_PASSWORD='...' \
JUFEXK_BACKUP_PATH=.local-data/historical-import-before.sql \
pnpm run historical-import:production -- /secure/frozen-historical-production-v1 --apply \
  > .local-data/historical-import-audit.json
```

任何契约、哈希、marker、目录计数、导入计数或幂等复核失败都会中止；保留备份和输出，按演练步骤恢复。公开验收应另外抽查课程与教师入口、搜索和排序页面，确认仅展示匿名文字评价，不宣称评分、投稿、审核或身份功能已上线。
