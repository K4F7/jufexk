/**
 * DEV 页面图集：真实路由入口，方便进出对照每个界面。
 */
import { Card, Chip, Typography, buttonVariants } from "@heroui/react";
import { useEffect, useState } from "react";
import { RouterAriaLink } from "../components/RouterAriaLink";
import { api } from "../lib/api";
import type { Course, Paginated, Teacher } from "../lib/types";
import {
  ATLAS_EMPTY_COURSE_QUERY,
  ATLAS_FILLED_COURSE_QUERY,
  ATLAS_HASH,
  ATLAS_TEACHER_QUERY,
  listAtlasGroups,
  resolveAtlasTargets,
  withAtlasParam,
  type AtlasAccess,
  type AtlasTargets,
} from "./page-atlas";

const ACCESS_LABEL: Record<AtlasAccess, string> = {
  public: "访客",
  login: "需登录",
  admin: "需管理员",
};

export function PageAtlas() {
  const [targets, setTargets] = useState<AtlasTargets>(() =>
    resolveAtlasTargets({
      filledCourses: [],
      emptyCourses: [],
      teachers: [],
    }),
  );
  const [seedReady, setSeedReady] = useState<boolean | null>(null);

  useEffect(() => {
    if (window.location.hash === `#${ATLAS_HASH}`) {
      document.getElementById(ATLAS_HASH)?.scrollIntoView({ block: "start" });
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api<Paginated<Course>>(
        `/api/courses?q=${encodeURIComponent(ATLAS_FILLED_COURSE_QUERY)}&pageSize=5`,
      ),
      api<Paginated<Course>>(
        `/api/courses?q=${encodeURIComponent(ATLAS_EMPTY_COURSE_QUERY)}&pageSize=5`,
      ),
      api<Paginated<Teacher>>(
        `/api/teachers?q=${encodeURIComponent(ATLAS_TEACHER_QUERY)}&pageSize=5`,
      ),
    ])
      .then(([filled, empty, teachers]) => {
        if (cancelled) return;
        const next = resolveAtlasTargets({
          filledCourses: filled.items,
          emptyCourses: empty.items,
          teachers: teachers.items,
        });
        setTargets(next);
        setSeedReady(next.filledCourseId != null && next.emptyCourseId != null);
      })
      .catch(() => {
        if (!cancelled) setSeedReady(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const groups = listAtlasGroups(targets);

  return (
    <section aria-labelledby="page-atlas-heading" className="grid gap-4" id={ATLAS_HASH}>
      <header className="grid gap-1">
        <Typography className="m-0 text-lg font-bold" id="page-atlas-heading" type="h2">
          页面图集
        </Typography>
        <Typography className="m-0 text-sm text-muted">
          每个界面点「打开」进去，左下角「返回页面图集」再出来。对照 UI
          用真实路由，不是静态效果图。
        </Typography>
        {seedReady === false ? (
          <Typography className="m-0 text-sm text-muted">
            未读到预览课。先跑{" "}
            <code className="rounded bg-default px-1">pnpm db:seed-preview</code>
            ，详情链接会先落到搜索页。
          </Typography>
        ) : null}
      </header>

      {groups.map((group) => (
        <section key={group.id} aria-label={group.title} className="grid gap-2">
          <div>
            <Typography className="m-0 text-sm font-semibold" type="h3">
              {group.title}
            </Typography>
            <Typography className="m-0 text-xs text-muted">{group.hint}</Typography>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {group.pages.map((page) => (
              <Card key={page.id}>
                <Card.Header>
                  <Card.Title>{page.title}</Card.Title>
                  <Card.Description>{page.description}</Card.Description>
                </Card.Header>
                <Card.Footer className="flex flex-wrap items-center gap-2">
                  <Chip size="sm" variant="soft">
                    {ACCESS_LABEL[page.access]}
                  </Chip>
                  <RouterAriaLink
                    className={`${buttonVariants({ size: "sm", variant: "secondary" })} no-underline`}
                    to={withAtlasParam(page.href)}
                  >
                    打开
                  </RouterAriaLink>
                </Card.Footer>
              </Card>
            ))}
          </div>
        </section>
      ))}
    </section>
  );
}
