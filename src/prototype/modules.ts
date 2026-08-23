/**
 * PROTOTYPE — throwaway module registry.
 * Question per foundations: freeze UI modules one at a time via Gallery + live variants.
 */

export type PrototypeModuleStatus = "exploring" | "visually-frozen" | "production-done";

export type PrototypeVariantDef = {
  key: string;
  name: string;
  /** One-line structural difference vs other variants */
  summary: string;
};

export type PrototypeModuleDef = {
  id: string;
  title: string;
  question: string;
  status: PrototypeModuleStatus;
  /** Where the user should judge the variant */
  preview: "gallery" | "live";
  /** Live host path when preview is live (search params preserved by switcher) */
  livePath?: string;
  variants: PrototypeVariantDef[];
  /** Optional winner after visual freeze */
  winner?: string;
  notes?: string;
};

/**
 * Module order matches docs/ui/foundations.md.
 * Only modules with variants defined are interactive; others appear as upcoming.
 */
/**
 * Catalog-facing modules through teacher adapt are visually frozen.
 * course-detail-summary: B 意向冻结、页级可砍（issue #60 / module 9）。
 * course-detail-reviews: A+B chips 视觉冻结（issue #61 / module 10）— 已被 #68/#71 领域改版重开。
 * teacher-detail: 课程详情语言迁移，不单开 A/B/C（issue #62 / module 11）。
 * catalog-followup: 收藏 / 本专业入口（issue #63；决策记录 #73）— 用户已选择 C（条件密度 + Tag 清单），生产未实现。
 * teaching-reviews-feed: 任课评价文字流视觉确认（issue #71 承接 #68 / module 12）— 探索中。
 * review-recognition: 任课评价认可交互状态（issue #74 承接 #70 / module 13）— 探索中。
 * global-search: 页内目录搜索 vs 导航栏全局搜索（issue #303）— 探索中，不改生产默认。
 */
export const PROTOTYPE_MODULES: PrototypeModuleDef[] = [
  {
    id: "sky-tokens",
    title: "Sky 主题 token",
    question:
      "在官方 Sky accent 基础上，高密度目录工具应采用哪套半径、阴影与表面色处理？",
    status: "visually-frozen",
    preview: "gallery",
    winner: "A official canvas",
    notes:
      "胜出（#422 重开）：官方 Sky A 画布——HeroUI 默认浅灰底、白表面、中性边框；官方 Sky accent；亮色 eclipse 黑字。不再取 C 的天空色 tint。已写入 src/styles/globals.css。",
    variants: [
      {
        key: "A",
        name: "官方 Sky 默认",
        summary:
          "HeroUI v3 默认 Sky accent、0.5rem 半径、默认阴影与中性表面；link 跟 foreground。",
      },
      {
        key: "B",
        name: "Sky 压缩密度",
        summary:
          "同一 Sky accent；半径压到 0.3rem、阴影变薄，背景微偏冷灰，适合高密度目录。",
      },
      {
        key: "C",
        name: "Sky 目录工具",
        summary:
          "更紧的 0.25rem 半径 + 天空色表面/边框 + 字段细边框；accent 略偏青，工具感更强。",
      },
    ],
  },
  {
    id: "shell-nav",
    title: "公共 Shell 与顶部导航",
    question: "桌面公共壳（导航与主题）应如何组织？",
    status: "visually-frozen",
    preview: "live",
    livePath: "/courses",
    winner: "C",
    notes:
      "胜出 C：左簇字标品牌 + HeroUI Button secondary/ghost 课程/教师 + 校名与主题右；min-h-14；无「选」方标。生产已写入 AppShell。",
    variants: [
      {
        key: "A",
        name: "Tabs primary",
        summary:
          "HeroUI Tabs 默认：填充 indicator + list 圆角 radius×2.5。",
      },
      {
        key: "B",
        name: "Tabs secondary",
        summary:
          "HeroUI Tabs secondary：底线 indicator。",
      },
      {
        key: "C",
        name: "Button 导航",
        summary:
          "HeroUI Button secondary/ghost，与主题开关同属 Button 语系（rounded-3xl）。",
      },
    ],
  },
  {
    id: "catalog-search",
    title: "目录标题与搜索",
    question: "课程目录标题与搜索的信息层级？",
    status: "visually-frozen",
    preview: "live",
    livePath: "/courses",
    winner: "C",
    notes:
      "胜出 C：标题与 secondary SearchField 同行；门数在标题下。生产已写入 CatalogSearchHeader。",
    variants: [
      {
        key: "A",
        name: "标题优先",
        summary:
          "h1「课程目录」+ 计数在上，下方官方 SearchField primary 全宽搜索。",
      },
      {
        key: "B",
        name: "搜索优先",
        summary:
          "Surface 内宽搜索为第一操作（primary + Description），标题降为辅助行。",
      },
      {
        key: "C",
        name: "同行工具条",
        summary:
          "标题与 secondary SearchField 同一行；计数挂在标题下，紧凑工具感。",
      },
    ],
  },
  {
    id: "catalog-filters",
    title: "筛选工具",
    question: "筛选条件的布局与主操作路径？（A 单行 / B 侧栏 / C 分层 / D=A+C）",
    status: "visually-frozen",
    preview: "live",
    livePath: "/courses",
    winner: "D",
    notes:
      "胜出 D：院系/教师行紧贴搜索；类别 Button 在其下。生产 CatalogFilters 无「即将」占位。后续意向：收藏本专业课程/教师。",
    variants: [
      {
        key: "A",
        name: "单行高密度",
        summary:
          "类别 Select + 院系 + 教师搜索 + 教师 Select + 清空，同一工具行。",
      },
      {
        key: "B",
        name: "左侧筛选栏",
        summary: "筛选垂直排在左侧 sticky 栏，结果表占右侧主列。",
      },
      {
        key: "C",
        name: "分层快捷",
        summary:
          "类别用 Button secondary/ghost 快捷条；院系/教师收进「高级筛选」。",
      },
      {
        key: "D",
        name: "A+C 组合",
        summary:
          "院系/教师行紧贴上方搜索（A）；类别 Button 快捷条在其下（C）；预留收藏入口位。",
      },
    ],
  },
  {
    id: "course-table",
    title: "课程结果表",
    question: "结果表的列密度与行内链接语义？",
    status: "visually-frozen",
    preview: "live",
    livePath: "/courses",
    winner: "B",
    notes:
      "胜出 B（高密度折叠）：四列；课名+Chip、课号次行；评分·投稿合并；真实 Link。生产 CourseResultTable。意向：A 七列适合无筛选粗浏览，本批不切换。",
    variants: [
      {
        key: "A",
        name: "七列工作台",
        summary:
          "完整 Table 七列：课号/课程/类别/教师/院系/评分/投稿；整行进课程；教师真实 Link。",
      },
      {
        key: "B",
        name: "课程优先折叠",
        summary:
          "四列高密度：课名+类别 Chip 同行、课号次行；评分·投稿合并；行高接近七列表。",
      },
      {
        key: "C",
        name: "卡片列表",
        summary:
          "不用 Table：每门课一张 Card；左身份/教师，右大号评分与投稿。",
      },
    ],
  },
  {
    id: "catalog-states",
    title: "分页及加载、错误、空状态",
    question: "分页与页面状态如何与表格共存？",
    status: "visually-frozen",
    preview: "live",
    livePath: "/courses",
    winner: "A",
    notes:
      "胜出 A：精简页脚分页 + Spinner 加载 + 虚线框错误/空态。生产 CatalogResultsStates。",
    variants: [
      {
        key: "A",
        name: "精简页脚",
        summary:
          "上一页/下一页 + 页码文案；刷新一行 Spinner；空/错用虚线框 + 清除/重试。",
      },
      {
        key: "B",
        name: "完整分页 + 骨架",
        summary:
          "HeroUI Pagination 页码与范围 Summary；首次 Skeleton 表骨架；Alert 错误。",
      },
      {
        key: "C",
        name: "底栏状态条",
        summary:
          "分页与状态 Chip 同在 sticky 底栏；刷新半透明遮罩；空态居中大按钮。",
      },
    ],
  },
  {
    id: "course-detail-summary",
    title: "课程详情摘要",
    question: "课程详情顶部摘要如何组织身份元数据与总体评分？",
    status: "visually-frozen",
    preview: "live",
    /** Prefer a real course id from local D1; Gallery deep-link uses this path. */
    livePath: "/courses/3",
    winner: "B（若保留该页）",
    notes:
      "Issue #60 · 用户反馈：评价绑定课程+教师，课程单独详情价值有限，本页可能不做；若保留/重开，摘要取 B（左身份/右评分）。不进入生产重写。投稿/历史资料仍属模块 10。",
    variants: [
      {
        key: "A",
        name: "标题流 + 分隔元数据",
        summary:
          "单列纵向：返回 → Chip+课名 → 课号·院系·教师链接 → 分隔后大号评分与投稿数。",
      },
      {
        key: "B",
        name: "左身份 / 右评分",
        summary:
          "两列：左身份与教师链接；右 Surface 竖排大号评分，评分作视觉锚点。",
      },
      {
        key: "C",
        name: "评分优先摘要条",
        summary:
          "顶部 Surface 横条先放评分与投稿；其下才是课名与元数据（评分先于身份）。",
      },
    ],
  },
  {
    id: "course-detail-reviews",
    title: "学生投稿条目与历史文字资料",
    question:
      "课程详情页上，学生投稿列表与历史文字资料应如何分区、如何呈现条目？",
    status: "visually-frozen",
    preview: "live",
    /** Prefer a real course with approved submissions from local D1. */
    livePath: "/courses/3",
    winner: "A + B 维度 soft Chip",
    notes:
      "Issue #61 · 用户确认 A 结构，并吸收 B 的维度 soft Chip 白胶囊。生产后经 #68/#90 改为 PublicReviews 统一匿名文字流，ReviewCard / LegacyReviews 于 #115 移除。对照原型仍可 DEV 预览 A/B/C。",
    variants: [
      {
        key: "A",
        name: "紧凑分隔列表",
        summary:
          "左评分右正文；条目 Separator；历史独立区 + 「历史」Chip；空态始终可见。",
      },
      {
        key: "B",
        name: "Card 条目栈",
        summary:
          "每条投稿一张 Card；维度 soft Chip；历史 secondary Surface + Alert 免计分。",
      },
      {
        key: "C",
        name: "维度优先 + 归档区",
        summary:
          "维度网格先于正文；overall 为 accent Chip；历史是更弱的虚线归档列表。",
      },
    ],
  },
  {
    id: "teacher-detail",
    title: "教师详情与任课课程表",
    question:
      "教师详情如何沿用课程详情冻结语言组织摘要、任课课程与相关投稿？",
    status: "visually-frozen",
    preview: "live",
    /** Prefer a real teacher with courses from local D1 (e.g. 张可). */
    livePath: "/teachers/650",
    winner: "课程语言迁移（摘要 B + 课程域表 + 模块 10 投稿/历史）",
    notes:
      "Issue #62 · foundations 规定不单开 A/B/C。生产：摘要左身份/右评价数（DetailSummary，#115 落地评分 Surface，#153 改为仅评价数）；TeacherCourseTable 课程域折叠（评分按 教师×课程）；PublicReviews counterpart=course 统一文字流。",
    variants: [
      {
        key: "A",
        name: "生产冻结方案",
        summary:
          "单页纵向：返回 → 左身份/右评价数 Surface → 任课课程折叠表 → 投稿（课程身份）→ 历史资料。",
      },
    ],
  },
  {
    id: "catalog-followup",
    title: "目录后续：收藏与条件密度",
    question:
      "收藏 / 本专业入口应挂在哪、条件密度（无筛选七列 / 有筛选四列）是否值得做？",
    status: "visually-frozen",
    preview: "live",
    livePath: "/courses",
    winner: "C",
    notes:
      "Issue #73（承接 #63）· 2026-08-17 用户选择 C：条件密度（无筛选七列 / 有筛选四列）+ 筛选下「仅收藏 / 本专业」Toggle + Tag 可移除收藏清单 + 行内星标（ToggleButton render prop）；取代 #63 的 A + C Tag 意向。无账号/持久化；生产未实现、不在 MVP，确认进入生产后另开 frontend/backend。",
    variants: [
      {
        key: "A",
        name: "扩展位 + Tag + 固定四列",
        summary:
          "筛选下「仅收藏 / 本专业」· Tag 可移除清单（取 C）· 优化星标；表始终四列 B。",
      },
      {
        key: "B",
        name: "独立工具行 + 固定七列",
        summary:
          "筛选下 Surface 工具行（Chip · Switch · 清空）；表始终七列粗扫。",
      },
      {
        key: "C",
        name: "条件密度 + Tag 清单",
        summary:
          "无筛选七列 / 有筛选或收藏·本专业四列；TagGroup 管理收藏集。",
      },
    ],
  },
  {
    id: "teaching-reviews-feed",
    title: "任课评价条目与文字评价流",
    question:
      "共享的匿名「任课评价」文字流：counterpart 身份、统计摘要与条目结构是否可视觉冻结？",
    status: "exploring",
    preview: "live",
    /** Prefer a real course with reviews; teacher projection via /teachers/:id. */
    livePath: "/courses/3",
    notes:
      "Issue #71（承接 #68）· 视觉冻结闸门。单强提案 A：Separator 紧凑流 · 课程页强调教师 / 教师页强调课程 · 仅有补充说明入流 · 总体评分 + 学期 + 发布时间 · 无逐维度 Chip / 无维度均分（#66）/ 无作者。确认后写入 foundations；生产由独立 frontend MVP Issue 重写。",
    variants: [
      {
        key: "A",
        name: "匿名文字流",
        summary:
          "标题「任课评价」· 共 N 份评分 / M 条有补充说明 · 身份真链接 · 学期 · 总体评分 · 正文 · 发布时间；无逐维度 Chip / 无维度均分 / 无作者。",
      },
    ],
  },
  {
    id: "review-recognition",
    title: "任课评价认可交互状态",
    question:
      "任课评价条目 footer 上，「认可」低强度信号的按钮位置、强调程度、登录提示、pending 与失败恢复如何表达？",
    status: "exploring",
    preview: "live",
    /** Same host as teaching-reviews-feed: real course page context. */
    livePath: "/courses/3",
    notes:
      "Issue #74（承接 #70）· DEV-only 内存 stub，不调用生产写接口；覆盖未登录 / 零计数 / 非零计数 / 已认可 / 建立中 / 撤回中 / 失败 / 大计数；无负向状态、不按认可排序；历史评价与纯评分不显示认可。即使视觉冻结，也须等普通用户认证、唯一约束与幂等 API 就绪后另开 frontend/backend Issue。",
    variants: [
      {
        key: "A",
        name: "footer 右置",
        summary:
          "发布时间居左，低强调认可 Button（ghost · 含计数）居 footer 右端。",
      },
      {
        key: "B",
        name: "footer 左置",
        summary:
          "低强调认可 Button（ghost · 含计数）居左，发布时间以 · 跟随。",
      },
      {
        key: "C",
        name: "动作与计数分离",
        summary:
          "Button 只含「认可 / 已认可」动作；计数为独立 muted 文本「N 人认可」。",
      },
    ],
  },
  {
    id: "global-search",
    title: "页内目录搜索 vs 导航栏全局搜索",
    question:
      "导航栏要不要加一个统一搜索入口，还是把能力留在页内搜索（#286）+ 空态救援（#287）就够？",
    status: "exploring",
    preview: "live",
    livePath: "/courses",
    notes:
      "Issue #303 · throwaway prototype，不改生产默认。数据走现网 /api/courses、/api/teachers 的 q。若选出 B 或 C，另开 frontend 票再落地。",
    variants: [
      {
        key: "A",
        name: "维持页内",
        summary:
          "无顶栏搜索。第一次：进目录页 → 页内 SearchField 输入。搜错实体：空态 #287 跨目录链接。",
      },
      {
        key: "B",
        name: "顶栏分组建议",
        summary:
          "顶栏 Modal + Autocomplete，课程/教师各最多 5 条。点选进详情，回车进当前目录 ?q=。窄屏用图标开 Modal。",
      },
      {
        key: "C",
        name: "顶栏只跳转",
        summary:
          "顶栏 SearchField 回车进当前目录；结果上方「也在另一目录中搜」Link。比 B 轻，比 A 多常驻入口。",
      },
    ],
  },
];

export function getPrototypeModule(id: string | null | undefined) {
  if (!id) return undefined;
  return PROTOTYPE_MODULES.find((m) => m.id === id);
}

export function statusLabel(status: PrototypeModuleStatus): string {
  switch (status) {
    case "exploring":
      return "探索中";
    case "visually-frozen":
      return "视觉冻结";
    case "production-done":
      return "生产完成";
  }
}
