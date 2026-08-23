# 补充说明改用 Tiptap 富文本，落库存消毒 HTML

写评价页（及目录申请随附评价）的补充说明从纯文本 `TextArea` 改为 Tiptap（`@tiptap/react` + starter kit 最小子集）：只开放加粗、斜体、链接、无序/有序列表、引用；工具栏用 HeroUI 官方 `ToggleButtonGroup` / `ToggleButton` / `Button`，不自定义编辑器皮肤。不做协作、AI 写作、表格、图片上传。

**存储**：`reviews.comment` 存白名单消毒后的 HTML（Tiptap 默认输出的子集），新增 `reviews.comment_format` 标记——`'html'` 为消毒富文本，`NULL` 为纯文本。历史行与绕过前端提交的纯文本都保持 `NULL`，不回填、不假装成富文本。公开流、审核台与编辑接口按同一白名单渲染/处理。

**消毒**：落库前在 Workers 侧用纯 TS 白名单消毒器（`src/lib/review-note-html.ts`，无 DOM 依赖）过滤——白名单外标签解开保留文本，`script`/`style` 等元素连同内容丢弃，`a` 只保留 http/https/mailto/相对 `href` 并统一补 `target="_blank" rel="noopener noreferrer nofollow"`。展示侧用 DOMPurify 按同一份白名单常量再消毒一层后才插入 DOM。

**字数门槛**：仍按去标签后的纯文本去空白计算，闭区间 10 到 1200；富文本标记不计入、也不能用来凑字。消毒后 HTML 另有存储上限护栏。纯文本不足的投稿（例如整段只有脚本标签）被接口拒绝。

权威规格：GitHub issue #400
