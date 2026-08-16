import { win32 } from "node:path";

export const HISTORICAL_PRODUCTION_PACKAGE_ROOT = win32.resolve(
  "D:/19016/Documents/Workload/jufexk-production-inputs/frozen-historical-production-v2",
);

export function parseProductionImportArguments(
  argv: readonly string[],
  platform: NodeJS.Platform = process.platform,
) {
  if (platform !== "win32")
    throw new Error("历史评价生产导入只允许在 Windows 执行");
  let apply = false;
  const positional: string[] = [];

  for (const argument of argv) {
    if (argument === "--") continue;
    if (argument === "--apply") {
      if (apply) throw new Error("不得重复传入 --apply");
      apply = true;
      continue;
    }
    if (argument.startsWith("-"))
      throw new Error(`未知的生产导入选项: ${argument}`);
    positional.push(argument);
  }

  if (positional.length > 1)
    throw new Error("生产导入最多接受一个冻结包路径");
  const root = win32.resolve(
    positional[0] || HISTORICAL_PRODUCTION_PACKAGE_ROOT,
  );
  if (root.toLowerCase() !== HISTORICAL_PRODUCTION_PACKAGE_ROOT.toLowerCase())
    throw new Error(
      `冻结包必须使用固定绝对路径: ${HISTORICAL_PRODUCTION_PACKAGE_ROOT}`,
    );

  return { apply, root };
}
