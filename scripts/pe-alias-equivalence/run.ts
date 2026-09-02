/**
 * GET-only production HTTP equivalence check for 800001/800002 vs pe:瑜伽 / pe:武术.
 *
 *   pnpm check:pe-alias-equivalence
 *   pnpm check:pe-alias-equivalence -- --origin https://courses.sein.moe --format markdown
 */
import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { parseArgs, promisify } from "node:util";
import {
  createWranglerJsonCommand,
  parseWorkerVersionId,
} from "../pe-mapping-audit/execute";
import {
  aliasCoursePath,
  canonicalCoursePath,
  colonEncodedPePath,
  DEFAULT_PRODUCTION_ORIGIN,
  publicGetJson,
  publicGetReviewPages,
  type HttpCapture,
} from "./http";
import {
  buildPeAliasEquivalenceReport,
  formatPeAliasEquivalenceMarkdown,
  PE_ALIAS_PAIRS,
  teachersFromDetail,
  type PeAliasEquivalenceReport,
  type PeAliasPairCaptures,
  type PeAliasPairSpec,
} from "./report";

const execFileAsync = promisify(execFile);

type FetchImpl = typeof fetch;

function teacherIdsFromDetail(json: unknown): number[] {
  return teachersFromDetail(json).map((teacher) => teacher.id);
}

async function readDeploySha(explicit?: string): Promise<string> {
  if (explicit) return explicit;
  const result = await execFileAsync("git", ["rev-parse", "origin/main"], {
    cwd: process.cwd(),
  });
  const sha = result.stdout.trim();
  if (!sha) throw new Error("无法读取 origin/main SHA");
  return sha;
}

async function readWorkerVersionId(explicit?: string): Promise<string | null> {
  if (explicit) return explicit;
  try {
    const command = createWranglerJsonCommand(["deployments", "list", "--json"]);
    const result = await execFileAsync(command.executable, command.args, {
      cwd: process.cwd(),
      timeout: 60_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    return parseWorkerVersionId(result.stdout || result.stderr);
  } catch {
    return null;
  }
}

async function fetchReviews(options: {
  origin: string;
  coursePath: string;
  fetch?: FetchImpl;
  teacherIds: number[];
  detailOk: boolean;
}): Promise<{ reviews: HttpCapture; teacherReviews: HttpCapture[] }> {
  const reviews = await publicGetReviewPages({
    origin: options.origin,
    coursePath: options.coursePath,
    fetch: options.fetch,
  });
  const teacherReviews = options.detailOk
    ? await Promise.all(
        options.teacherIds.map((teacherId) =>
          publicGetReviewPages({
            origin: options.origin,
            coursePath: options.coursePath,
            teacherId,
            fetch: options.fetch,
          }),
        ),
      )
    : [];
  return { reviews, teacherReviews };
}

export async function collectPeAliasPairCaptures(options: {
  origin: string;
  spec: PeAliasPairSpec;
  fetch?: FetchImpl;
}): Promise<PeAliasPairCaptures> {
  const aliasPath = aliasCoursePath(options.spec.aliasId);
  const primaryCanonicalPath = canonicalCoursePath(options.spec.canonicalPublicId);
  const colonCanonicalPath = colonEncodedPePath(options.spec.label);
  const extraPaths = [...new Set([colonCanonicalPath])].filter(
    (path) => path !== primaryCanonicalPath,
  );
  const [aliasDetail, primaryCanonical, ...extraCanonical] = await Promise.all([
    publicGetJson({
      origin: options.origin,
      path: aliasPath,
      fetch: options.fetch,
    }),
    publicGetJson({
      origin: options.origin,
      path: primaryCanonicalPath,
      fetch: options.fetch,
    }),
    ...extraPaths.map((path) =>
      publicGetJson({
        origin: options.origin,
        path,
        fetch: options.fetch,
      }),
    ),
  ]);
  const chosenCanonical =
    primaryCanonical.ok ? primaryCanonical : extraCanonical.find((item) => item.ok) ?? primaryCanonical;
  const aliasTeacherIds = teacherIdsFromDetail(aliasDetail.json);
  const canonicalTeacherIds = teacherIdsFromDetail(chosenCanonical.json);
  const [aliasRest, canonicalRest] = await Promise.all([
    fetchReviews({
      origin: options.origin,
      coursePath: aliasPath,
      fetch: options.fetch,
      teacherIds: aliasTeacherIds,
      detailOk: aliasDetail.ok,
    }),
    fetchReviews({
      origin: options.origin,
      coursePath: chosenCanonical.path,
      fetch: options.fetch,
      teacherIds: canonicalTeacherIds,
      detailOk: chosenCanonical.ok,
    }),
  ]);
  return {
    spec: options.spec,
    aliasDetail,
    aliasReviews: aliasRest.reviews,
    aliasTeacherReviews: aliasRest.teacherReviews,
    canonicalDetail: chosenCanonical,
    canonicalReviews: canonicalRest.reviews,
    canonicalTeacherReviews: canonicalRest.teacherReviews,
    extraCanonical: [
      ...(chosenCanonical.path === primaryCanonical.path ? [] : [primaryCanonical]),
      ...extraCanonical.filter((item) => item.path !== chosenCanonical.path),
    ],
  };
}

export async function runPeAliasEquivalence(
  argv = process.argv.slice(2),
  deps: { fetch?: FetchImpl } = {},
): Promise<{
  report: PeAliasEquivalenceReport;
  printed: string;
}> {
  const { values } = parseArgs({
    args: argv,
    options: {
      origin: { type: "string", default: DEFAULT_PRODUCTION_ORIGIN },
      format: { type: "string", default: "both" },
      "deploy-sha": { type: "string" },
      "requested-at": { type: "string" },
      "worker-version": { type: "string" },
      output: { type: "string" },
    },
  });
  const format = values.format ?? "both";
  if (format !== "json" && format !== "markdown" && format !== "both") {
    throw new Error("--format 只支持 json、markdown、both");
  }
  const origin = (values.origin || DEFAULT_PRODUCTION_ORIGIN).replace(/\/+$/, "");
  const pairs: PeAliasPairCaptures[] = [];
  for (const spec of PE_ALIAS_PAIRS) {
    pairs.push(
      await collectPeAliasPairCaptures({
        origin,
        spec,
        fetch: deps.fetch,
      }),
    );
  }
  const report = buildPeAliasEquivalenceReport({
    requestedAt: values["requested-at"] || new Date().toISOString(),
    origin,
    deploySha: await readDeploySha(values["deploy-sha"]),
    workerVersionId: await readWorkerVersionId(values["worker-version"]),
    pairs,
  });
  const json = `${JSON.stringify(report, null, 2)}\n`;
  const markdown = `${formatPeAliasEquivalenceMarkdown(report)}\n`;
  const printed =
    format === "json" ? json : format === "markdown" ? markdown : `${json}\n${markdown}`;
  if (values.output) {
    const output = values.output;
    const payload = /\.json$/i.test(output) ? json : /\.md$/i.test(output) ? markdown : printed;
    await writeFile(output, payload, "utf8");
    if (format !== "json" && /\.json$/i.test(output)) {
      await writeFile(output.replace(/\.json$/i, ".md"), markdown, "utf8");
    }
  }
  return { report, printed };
}

async function main() {
  const { printed } = await runPeAliasEquivalence();
  process.stdout.write(printed);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
