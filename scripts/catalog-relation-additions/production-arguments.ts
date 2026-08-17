import { win32 } from "node:path";

export const ISSUE111_RELATION_PACKAGE_ROOT = win32.resolve(
  "D:/19016/Documents/Workload/jufexk-production-inputs/issue111-relation-addition-v1",
);

export function parseRelationAdditionArguments(
  argv: readonly string[],
  platform: NodeJS.Platform = process.platform,
) {
  if (platform !== "win32")
    throw new Error("任课关系生产写入只允许在 Windows 执行");
  let apply = false;
  let viaPairs = false;
  const positional: string[] = [];

  for (const argument of argv) {
    if (argument === "--") continue;
    if (argument === "--apply") {
      if (apply) throw new Error("不得重复传入 --apply");
      apply = true;
      continue;
    }
    if (argument === "--via-pairs") {
      if (viaPairs) throw new Error("不得重复传入 --via-pairs");
      viaPairs = true;
      continue;
    }
    if (argument.startsWith("-"))
      throw new Error(`未知的任课关系写入选项: ${argument}`);
    positional.push(argument);
  }

  if (positional.length > 1)
    throw new Error("任课关系写入最多接受一个候选包路径");
  const root = win32.resolve(positional[0] || ISSUE111_RELATION_PACKAGE_ROOT);
  if (root.toLowerCase() !== ISSUE111_RELATION_PACKAGE_ROOT.toLowerCase())
    throw new Error(
      `候选包必须使用固定绝对路径: ${ISSUE111_RELATION_PACKAGE_ROOT}`,
    );

  return { apply, root, viaPairs };
}
