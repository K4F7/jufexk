# jufexk

选课志——江西财经大学课程/教师评价站。

## Agent skills

### Issue tracker

Issue 与 PRD 以 GitHub Issues 形式存放在 `K4F7/jufexk`，统一走 `gh` CLI。见 `docs/agents/issue-tracker.md`。

### Issue 完整 PR 流程

修复或实现任何 issue 时，必须完整执行以下流程，不得直接在主工作区或 `main` 分支上修改：

1. **读取 issue**：使用 `gh issue view <number> --comments` 获取最新需求、讨论和标签。
2. **同步源码**：在主工作区确认没有覆盖用户改动的风险，然后执行 `git fetch origin`，并将本地 `main` 快进到最新的 `origin/main`。每个 issue 都必须从最新主干开始。
3. **创建 worktree**：从最新 `origin/main` 创建 `codex/<issue-number>-<slug>` 分支，并在仓库根目录的 `.worktree/<issue-number>-<slug>/` 创建独立 worktree。后续代码修改、依赖安装、测试和 Git 操作都在该 worktree 中完成。
4. **安装依赖**：进入新 worktree 后，先执行 `pnpm install --frozen-lockfile`，再开始修改。不得复用主工作区的依赖目录来跳过安装。
5. **实现、本地验证与 review**：完成修改并运行与改动范围匹配的格式检查、类型检查、测试和构建；不得绕过失败的检查。检查通过后执行本地 `$code-review`，修复其中的阻塞性问题并重新验证。
6. **提交、推送并创建 PR**：本地检查与 `$code-review` 通过后，提交 issue 范围内的改动并将分支推送到远端，然后使用 `gh pr create` 创建目标分支为 `main` 的 PR；PR 正文应关联对应 issue。
7. **CI 通过后合入**：PR 创建后立即执行 `gh pr merge <number> --auto --merge` 排队自动合并。只处理必需 CI、分支保护和合并冲突，不等待 CodeRabbit 等非必需 review。必需 CI 通过且仓库规则允许后直接合入 `main`；检查失败或出现冲突时修复并重新推送。除非用户明确要求，否则不得在 PR 尚未合入时把任务视为完成或提前清理。
8. **清理 worktree**：确认 PR 已合入且远端 `main` 已包含该提交后，回到主工作区同步最新 `main`，再用 `git worktree remove .worktree/<issue-number>-<slug>` 清理 worktree，并删除已合入的本地分支；远端分支按仓库 PR 合并设置或明确要求处理。

如果同步、安装依赖、本地检查、本地 `$code-review`、必需 CI、分支保护或合并权限造成阻塞，应保留 worktree 和分支并报告当前状态；只有 PR 合入后才能执行清理步骤。

### Triage labels

沿用五个规范角色的默认标签字符串。见 `docs/agents/triage-labels.md`。

### Domain docs

单上下文布局：根目录 `CONTEXT.md` + `docs/adr/`。见 `docs/agents/domain.md`。

### Matt Pocock skills

官方推荐集在 `.agents/skills/`（与 `heroui-react` 并列）。`/grill-me`、`/implement`、`/triage` 等带 `disable-model-invocation` 的 skill 必须用 `/skill-name` 显式调用；Cloud Agent 对话开始时才会扫描仓库 skill，已在跑的会话不会自动出现。

### HeroUI React (v3)

本仓库 UI 使用 HeroUI v3（`@heroui/react` + `@heroui/styles` + Tailwind CSS v4）。

- 项目 skill：`.agents/skills/heroui-react/`（Cursor：`/heroui-react`；Codex：`$heroui-react`）
- 项目 MCP：`.codex/config.toml` 中的 `mcp_servers.heroui-react`（`npx -y @heroui/react-mcp@latest`）

**凡涉及前端 UI 的构建或修改，必须先加载并遵循 `/heroui-react`（`$heroui-react`）skill，再动手写代码。** 同时通过 `heroui-react` MCP 拉取 v3 组件文档/源码/主题变量。禁止凭记忆或套用 HeroUI v2 的 Provider / flat props / `@heroui/theme` 模式。

重启 Codex agent 后 MCP 才会加载。

### UI 组件：官方优先

**所有界面先用 HeroUI v3 官方组件与默认视觉，用户明确提出需求后再微调。** 本条与上一节的 `/heroui-react` skill 强制要求一并执行。

1. **先查再写**：动手前用 `/heroui-react` skill / MCP / 官方 MDX 确认是否已有组件（如 `Tabs`、`Button`、`Table`、`SearchField`、`Select`、`Toolbar`）。有官方方案时禁止用裸 `div` + 手写样式冒充同一交互。
2. **默认外观优先**：先交付官方默认 variant / size / radius / spacing；不要一上来改圆角、高度、阴影或重写 BEM。
3. **微调需用户触发**：仅当用户明确说「太薄 / 太方 / 想更紧 / 去掉某元素」等时，才在官方组件上叠加最小 class 或布局调整。
4. **布局可以组合，控件不可私造**：页级排列（左品牌、右主题）可用 flex/grid；导航、按钮、表单、表格、分页等必须是 `@heroui/react` 导出组件。
5. **路由适配用官方 `render`/`href`**：例如 `Tabs.Tab` 的 `render` 接到 React Router `NavLink`，不要为了路由自建一套 tab 样式。
6. **Prototype 同样遵守**：变体之间应比较「不同官方组件或官方 variant 的组合」，而不是三套自定义 CSS 皮肤。
7. **禁止**：HeroUI v2 API；为了「更像设计稿」绕过官方组件；在未确认前把原型私货直接当生产默认。
