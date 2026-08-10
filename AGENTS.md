# jufexk

选课志——江西财经大学课程/教师评价站。

## Agent skills

### Issue tracker

Issue 与 PRD 以 GitHub Issues 形式存放在 `K4F7/jufexk`，统一走 `gh` CLI。见 `docs/agents/issue-tracker.md`。

### Triage labels

沿用五个规范角色的默认标签字符串。见 `docs/agents/triage-labels.md`。

### Domain docs

单上下文布局：根目录 `CONTEXT.md` + `docs/adr/`。见 `docs/agents/domain.md`。

### HeroUI React (v3)

本仓库 UI 使用 HeroUI v3（`@heroui/react` + `@heroui/styles` + Tailwind CSS v4）。

- 项目 skill：`.agents/skills/heroui-react/`
- 项目 MCP：`.codex/config.toml` 中的 `mcp_servers.heroui-react`（`npx -y @heroui/react-mcp@latest`）

构建或修改前端 UI 时优先走 `$heroui-react` skill，并通过 `heroui-react` MCP 拉取 v3 组件文档/源码/主题变量。不要套用 HeroUI v2 的 Provider / flat props / `@heroui/theme` 模式。

重启 Codex agent 后 MCP 才会加载。

### UI 组件：官方优先

**所有界面先用 HeroUI v3 官方组件与默认视觉，用户明确提出需求后再微调。**

1. **先查再写**：动手前用 skill/MCP/官方 MDX 确认是否已有组件（如 `Tabs`、`Button`、`Table`、`SearchField`、`Select`、`Toolbar`）。有官方方案时禁止用裸 `div` + 手写样式冒充同一交互。
2. **默认外观优先**：先交付官方默认 variant / size / radius / spacing；不要一上来改圆角、高度、阴影或重写 BEM。
3. **微调需用户触发**：仅当用户明确说「太薄 / 太方 / 想更紧 / 去掉某元素」等时，才在官方组件上叠加最小 class 或布局调整。
4. **布局可以组合，控件不可私造**：页级排列（左品牌、右主题）可用 flex/grid；导航、按钮、表单、表格、分页等必须是 `@heroui/react` 导出组件。
5. **路由适配用官方 `render`/`href`**：例如 `Tabs.Tab` 的 `render` 接到 React Router `NavLink`，不要为了路由自建一套 tab 样式。
6. **Prototype 同样遵守**：变体之间应比较「不同官方组件或官方 variant 的组合」，而不是三套自定义 CSS 皮肤。
7. **禁止**：HeroUI v2 API；为了「更像设计稿」绕过官方组件；在未确认前把原型私货直接当生产默认。