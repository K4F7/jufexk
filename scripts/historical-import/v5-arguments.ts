import { win32 } from "node:path";

export const V5_CANDIDATE_PACKAGE_ROOT = win32.resolve(
  "D:/19016/Documents/Workload/jufexk-production-inputs/frozen-historical-v5-candidate-v5",
);

export function parseV5ImportArguments(
  argv: readonly string[],
  platform: NodeJS.Platform = process.platform,
) {
  if (platform !== "win32")
    throw new Error("v5 生产候选预检只允许在 Windows 执行");
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
      throw new Error(`未知的 v5 预检选项: ${argument}`);
    positional.push(argument);
  }

  if (positional.length > 1)
    throw new Error("v5 预检最多接受一个冻结包路径");
  const root = win32.resolve(positional[0] || V5_CANDIDATE_PACKAGE_ROOT);
  if (root.toLowerCase() !== V5_CANDIDATE_PACKAGE_ROOT.toLowerCase())
    throw new Error(
      `冻结包必须使用固定绝对路径: ${V5_CANDIDATE_PACKAGE_ROOT}`,
    );

  return { apply, root };
}

export function assertV5PreviewOnly(apply: boolean) {
  if (apply) throw new Error("本票未授权 --apply，拒绝写入生产 D1");
}
