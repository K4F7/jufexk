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
 * Frozen catalog Gallery variants (search / filters / table / states /
 * course-detail-summary / course-detail-reviews) were removed after production
 * landed CourseRelationRow + CatalogResultsStates.
 * teacher-detail: 课程详情语言迁移，不单开 A/B/C（issue #62 / module 11）。
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
    id: "teaching-reviews-feed",
    title: "任课评价条目与文字评价流",
    question:
      "共享的匿名「任课评价」文字流：counterpart 身份、统计摘要与条目结构是否可视觉冻结？",
    status: "exploring",
    preview: "live",
    /** Prefer a real course with reviews; teacher projection via /teachers/:id. */
    livePath: "/courses/3",
    notes:
      "Issue #71（承接 #68）· 视觉冻结闸门。单强提案 A：Separator 紧凑流 · 课程页强调教师 / 教师页强调课程 · 仅有补充说明入流 · 总体评分 + 发布时间 · 无逐维度 Chip / 无维度均分（#66）/ 无作者。确认后写入 foundations；生产由独立 frontend MVP Issue 重写。",
    variants: [
      {
        key: "A",
        name: "匿名文字流",
        summary:
          "标题「任课评价」· 共 N 份评分 / M 条有补充说明 · 身份真链接 · 总体评分 · 正文 · 发布时间；无逐维度 Chip / 无维度均分 / 无作者。",
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
    id: "public-user-follow",
    title: "公开主页关注按钮位置与强调",
    question:
      "公开主页右侧「公开编号」卡片里，关注按钮放在哪里、用哪个 HeroUI 官方 variant/size 最合适？",
    status: "exploring",
    preview: "gallery",
    notes:
      "throwaway prototype，不改生产默认。A 为当前生产方案（昵称下 · primary）；F 为原布局（统计下方）。确认后把胜出组合写回 PublicUserPage。",
    variants: [
      {
        key: "A",
        name: "昵称下 · primary",
        summary: "当前生产方案：默认尺寸主按钮，放在昵称与统计之间。",
      },
      {
        key: "B",
        name: "昵称下 · primary sm",
        summary: "同一位置，按钮小一号。",
      },
      {
        key: "C",
        name: "昵称下 · secondary",
        summary: "同一位置，次一级强调。",
      },
      {
        key: "D",
        name: "昵称下 · outline",
        summary: "同一位置，描边更轻。",
      },
      {
        key: "E",
        name: "昵称下 · ghost",
        summary: "同一位置，最轻。",
      },
      {
        key: "F",
        name: "统计下方 · primary",
        summary: "原布局：按钮回到卡片底部。",
      },
      {
        key: "G",
        name: "标题行右侧 · primary sm",
        summary: "小主按钮与昵称同一行，靠右。",
      },
    ],
  },
  {
    id: "global-search",
    title: "页内目录搜索 vs 导航栏全局搜索",
    question:
      "导航栏要不要加一个统一搜索入口，还是把能力留在页内搜索（#286）就够？",
    status: "exploring",
    preview: "live",
    livePath: "/courses",
    notes:
      "Issue #303 · throwaway prototype，不改生产默认。列表只走 /courses；教师建议点进 /teachers/:id。若选出 B 或 C，另开 frontend 票再落地。",
    variants: [
      {
        key: "A",
        name: "维持页内",
        summary:
          "无顶栏搜索。第一次：进课程目录 → 页内 SearchField 输入。",
      },
      {
        key: "B",
        name: "顶栏分组建议",
        summary:
          "顶栏 Modal + Autocomplete，课程/教师各最多 5 条。点选进详情，回车进课程目录 ?q=。窄屏用图标开 Modal。",
      },
      {
        key: "C",
        name: "顶栏只跳转",
        summary:
          "顶栏 SearchField 回车进课程目录。比 B 轻，比 A 多常驻入口。",
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
