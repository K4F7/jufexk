/**
 * 排课模拟的本科专业名单。公开目录只有开课单位，没有专业表，
 * 所以专业是本机名单；选中后再按所属学院匹配目录院系。
 */
import type { JwxtFilterOption } from "./jwxt-offering";

export type CatalogMajor = {
  id: string;
  label: string;
  colleges: string[];
};

const majors = (college: string, names: string[], extraColleges: string[] = []): CatalogMajor[] =>
  names.map((name) => ({
    id: name,
    label: name,
    colleges: [college, ...extraColleges],
  }));

/** 2025 本科招生专业 + 在校生仍会用到的学院别名。 */
export const CATALOG_SCHEDULE_MAJORS: CatalogMajor[] = [
  ...majors("会计学院", ["会计学", "财务管理", "审计学"]),
  ...majors("金融学院", ["金融学", "金融工程", "保险学", "金融科技", "精算学"]),
  ...majors("统计与数据科学学院", ["经济统计学", "应用统计学", "数据科学"]),
  ...majors("经济学院", ["经济学", "数字经济", "资源与环境经济学"]),
  ...majors("财政税务学院", ["财政学", "税收学"]),
  ...majors("工商管理学院", ["工商管理", "市场营销", "人力资源管理", "物流管理"]),
  ...majors("国际经贸学院", ["国际经济与贸易", "国际商务", "国际经济发展合作"], ["国际学院"]),
  ...majors("旅游与城市管理学院", ["旅游管理", "工程管理"]),
  ...majors("信息管理与数学学院", ["信息管理与信息系统", "信息与计算科学", "电子商务"], ["信息管理学院"]),
  ...majors("信息管理与数学学院", ["数学与应用数学"], ["数学学院"]),
  ...majors("软件与物联网工程学院", ["软件工程", "物联网工程"]),
  ...majors("计算机与人工智能学院", ["计算机科学与技术", "人工智能", "网络空间安全"]),
  ...majors("外国语学院", ["商务英语"]),
  ...majors("法学院", ["法学"]),
  ...majors("社会与人文学院", ["新闻学", "社会工作"]),
  ...majors("公共管理学院", ["行政管理", "劳动与社会保障"]),
  ...majors("格里菲斯数智学院", ["数据科学与大数据技术", "虚拟现实技术"]),
];

export function catalogScheduleMajors(): JwxtFilterOption[] {
  return [...CATALOG_SCHEDULE_MAJORS]
    .sort((left, right) => left.label.localeCompare(right.label, "zh-CN"))
    .map(({ id, label }) => ({ id, label }));
}

export function homeUnitLabel(department: string): string {
  return department.replace(/^\[[^\]]+\]/, "").trim();
}

export function matchDepartmentForMajor(majorId: string, departments: string[]): string {
  const major = CATALOG_SCHEDULE_MAJORS.find((item) => item.id === majorId);
  if (!major) return "";
  const labels = departments.map((department) => ({
    department,
    label: homeUnitLabel(department),
  }));
  for (const college of major.colleges) {
    const exact = labels.find((item) => item.label === college);
    if (exact) return exact.department;
  }
  return "";
}
