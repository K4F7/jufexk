## 问题描述

目录类别快捷筛现在是：全部、体育课、英语课、思政课、数学课。#337 当时明确「不要加专业类/公共基础类 Chip」。浏览侧现在缺六类评价规则里剩下的两类：专业类、公共基础类。点选该筛选条时，用户会问专业课和公共课去哪了。

不要改 `courses.category` 的 `general | sports` 评价模板语义。不要做完整六类评价规则投稿（那是 #230）。不要把 scheme 文案写进课名旁类别 Chip。不要新开选课/收藏。

## 位置

- `src/components/CatalogFilters.tsx`（`CATEGORY_OPTIONS` / `isPublicCategoryFilter`）
- `src/pages/CoursesPage.tsx`（过期 `category=` 深链剥离；`major` 不再视为过期）
- `src/index.ts`（`GET /api/courses` 的 `category` 校验与错误文案）
- `src/lib/public-course-presentation.ts`（`PUBLIC_CATEGORY_FILTERS` / `publicCategoryFilterSql`）
- `test/course-category-api.test.ts`
- `test/public-course-presentation.test.ts`
- `test/browser/catalog-category-filter.browser.test.ts`

## 建议

类别条做成：全部、专业课、公共课、体育课、英语课、思政课、数学课。

URL 继续用 `?category=`，取值：

- 空：全部（现状）
- `major`：专业课（`scheme_key = 'major'`）
- `public_basic`：公共课（`scheme_key = 'public_basic'`）
- `sports`：体育课（保留现有深链）
- `english`：英语课
- `ideology`：思政课
- `math`：数学课

过滤：

- `major` / `public_basic`：与英语/思政/数学相同，按 `scheme_key` 相等；公开可见与体育规范课约束保持不变
- `sports` / `english` / `ideology` / `math`：行为不变
- 仍拒绝 `general` / `pe` / `required` / `elective` 等旧值（400）；过期深链从 URL 剥离，不再把 `major` 当过期值
- 列表 Chip 仍用评价模板文案（普通课程 / 体育课）
- 清空筛选、院系、教师、排序、`?q=` 深链行为不变
- HeroUI 官方 Button / 现有类别条，不要手写一套 tab

## 验收

- 目录能点「专业课」「公共课」，URL 分别为 `category=major|public_basic`，列表只含对应 `scheme_key` 的公开课
- 英语课 / 思政课 / 数学课 / 体育课筛选与专项课展示仍可用
- 未知 `category` 仍 400；未带 `category` 仍是全部
- `?category=general` / `pe` / `required` 仍不打公开 API、并从 URL 剥离
- 评价模板写入仍只接受 `general | sports`
