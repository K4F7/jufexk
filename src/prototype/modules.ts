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
 * Detail modules (course/teacher summary, reviews) are next when started.
 */
export const PROTOTYPE_MODULES: PrototypeModuleDef[] = [
  {
    id: "sky-tokens",
    title: "Sky 主题 token",
    question:
      "在官方 Sky accent 基础上，高密度目录工具应采用哪套半径、阴影与表面色处理？",
    status: "visually-frozen",
    preview: "gallery",
    winner: "A+C surfaces",
    notes:
      "胜出：A 的 accent/半径/阴影/link + C 的天空色 background/surface/border/separator。已写入 src/styles/globals.css。",
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
