# Issue 追踪器：GitHub

本仓库的 issue 与 PRD 以 GitHub issue 形式存放（`K4F7/jufexk`）。所有操作统一使用 `gh` CLI。

## 约定

- **创建 issue**：`gh issue create --title "..." --body "..."`。多行正文用 heredoc。
- **读取 issue**：`gh issue view <number> --comments`，用 `jq` 过滤评论，同时取回 labels。
- **列出 issue**：`gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'`，按需加 `--label` 与 `--state` 过滤。
- **评论 issue**：`gh issue comment <number> --body "..."`
- **增删标签**：`gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **关闭**：`gh issue close <number> --comment "..."`

仓库从 `git remote -v` 推断——在 clone 内运行时 `gh` 会自动识别。

## Pull request 是否作为 triage 输入面

**PR 作为请求输入面：否。** _（如果本仓库把外部 PR 当作功能请求，改成「是」；`/triage` 会读这个标志位。）_

设为「是」时，PR 与 issue 走同一套标签和状态，改用 `gh pr` 等价命令：

- **读取 PR**：`gh pr view <number> --comments`，diff 用 `gh pr diff <number>`。
- **列出待 triage 的外部 PR**：`gh pr list --state open --json number,title,body,labels,author,authorAssociation,comments`，然后只保留 `authorAssociation` 为 `CONTRIBUTOR`、`FIRST_TIME_CONTRIBUTOR` 或 `NONE` 的（丢弃 `OWNER`/`MEMBER`/`COLLABORATOR`）。
- **评论 / 打标签 / 关闭**：`gh pr comment`、`gh pr edit --add-label`/`--remove-label`、`gh pr close`。

GitHub 的 issue 与 PR 共用一套编号空间，因此单看 `#42` 无法判断类型——先 `gh pr view 42`，失败再回退到 `gh issue view 42`。

## 当某个 skill 说「发布到 issue 追踪器」

创建一个 GitHub issue。

## 当某个 skill 说「取回相关工单」

执行 `gh issue view <number> --comments`。

## Wayfinding 操作

供 `/wayfinder` 使用。**map** 是一个 issue，**子** issue 是其下的工单。

- **Map**：一个打了 `wayfinder:map` 标签的 issue，正文包含 Notes / Decisions-so-far / Fog 三部分。用 `gh issue create --label wayfinder:map` 创建。
- **子工单**：以 GitHub sub-issue 的形式挂在 map 下（对 sub-issues 端点调 `gh api`）。若未启用 sub-issues，则把子项加入 map 正文的任务列表，并在子 issue 正文顶部写 `Part of #<map>`。标签为 `wayfinder:<type>`（`research`/`prototype`/`grilling`/`task`）。一旦认领，把工单 assign 给推进者。
- **阻塞关系**：使用 GitHub **原生 issue dependencies**，这是唯一权威、且在 UI 可见的表示。建立一条边：`gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`，其中 `<blocker-db-id>` 是阻塞方的数字 **database id**（`gh api repos/<owner>/<repo>/issues/<n> --jq .id`，**不是** `#number` 也不是 `node_id`）。GitHub 会返回 `issue_dependencies_summary.blocked_by`（只计未关闭的阻塞方——这就是实时闸门）。若该功能不可用，回退到在子 issue 正文顶部写一行 `Blocked by: #<n>, #<n>`。所有阻塞方都关闭后，该工单才解除阻塞。
- **Frontier 查询**：列出 map 下所有未关闭的子项（`gh issue list --state open`，范围限定为该 map 的 sub-issues / 任务列表），剔除仍有未关闭阻塞方的（`issue_dependencies_summary.blocked_by > 0`，或 `Blocked by` 行中仍有未关闭 issue）以及已有 assignee 的；按 map 中的顺序取第一个。
- **认领**：`gh issue edit <n> --add-assignee @me`——这是一次会话的第一次写操作。
- **收尾**：`gh issue comment <n> --body "<answer>"`，然后 `gh issue close <n>`，最后把上下文指针（gist + 链接）追加到 map 的 Decisions-so-far。
