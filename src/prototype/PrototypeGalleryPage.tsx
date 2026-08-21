/**
 * PROTOTYPE — /prototype Gallery
 * Question: freeze UI modules one at a time (start: sky-tokens A/B/C).
 * Lists modules + status; hosts small-component previews; live modules deep-link
 * into real routes with module+variant params preserved.
 */
import { Chip } from "@heroui/react";
import { useEffect } from "react";
import { Link, Navigate } from "react-router-dom";
import {
  PROTOTYPE_ENABLED,
  PROTOTYPE_MODULE_PARAM,
  PROTOTYPE_VARIANT_PARAM,
} from "./enabled";
import {
  PROTOTYPE_MODULES,
  statusLabel,
  type PrototypeModuleDef,
} from "./modules";
import { SkyTokenPreview } from "./SkyTokenPreview";
import { usePrototypeNavigation } from "./usePrototypeNavigation";

const DEFAULT_GALLERY_MODULE = "sky-tokens";
const DEFAULT_GALLERY_VARIANT = "A";

function ModuleCard({
  mod,
  active,
}: {
  mod: PrototypeModuleDef;
  active: boolean;
}) {
  const firstVariant = mod.variants[0]?.key || "A";
  const hasVariants = mod.variants.length > 0;

  const target =
    mod.preview === "live" && mod.livePath
      ? `${mod.livePath}?${PROTOTYPE_MODULE_PARAM}=${mod.id}&${PROTOTYPE_VARIANT_PARAM}=${firstVariant}`
      : `/prototype?${PROTOTYPE_MODULE_PARAM}=${mod.id}&${PROTOTYPE_VARIANT_PARAM}=${firstVariant}`;

  return (
    <article
      className={`grid gap-2 rounded-lg border p-3 ${
        active ? "border-accent bg-accent-soft" : "border-border bg-surface"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="m-0 text-sm font-bold">{mod.title}</h2>
          <p className="m-0 mt-1 text-xs text-muted">{mod.question}</p>
        </div>
        <Chip
          color={mod.status === "visually-frozen" ? "success" : "default"}
          size="sm"
          variant="soft"
        >
          {statusLabel(mod.status)}
        </Chip>
      </div>

      {mod.winner ? (
        <p className="m-0 text-xs text-success">
          胜出：{mod.winner}
          {mod.notes ? ` · ${mod.notes}` : null}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-1.5">
        {hasVariants ? (
          mod.variants.map((v) => {
            const href =
              mod.preview === "live" && mod.livePath
                ? `${mod.livePath}?${PROTOTYPE_MODULE_PARAM}=${mod.id}&${PROTOTYPE_VARIANT_PARAM}=${v.key}`
                : `/prototype?${PROTOTYPE_MODULE_PARAM}=${mod.id}&${PROTOTYPE_VARIANT_PARAM}=${v.key}`;
            return (
              <Link
                key={v.key}
                className="button button--sm button--outline no-underline"
                to={href}
              >
                {v.key} · {v.name}
              </Link>
            );
          })
        ) : (
          <span className="text-xs text-muted">尚未制作变体（排队中）</span>
        )}
      </div>

      {hasVariants ? (
        <div>
          <Link className="button button--sm no-underline" to={target}>
            {mod.preview === "live" ? "在真实页面预览" : "在 Gallery 预览"}
          </Link>
        </div>
      ) : null}
    </article>
  );
}

function PrototypeGalleryContent() {
  const { moduleId, module, variant, setModule } = usePrototypeNavigation();

  // Bare /prototype → sky-tokens A so theme controller + switcher bind immediately.
  useEffect(() => {
    if (!moduleId) {
      setModule(DEFAULT_GALLERY_MODULE, DEFAULT_GALLERY_VARIANT);
    }
  }, [moduleId, setModule]);

  return (
    <div className="grid gap-5 pb-24">
      <header className="grid gap-1 border-b border-border pb-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-accent">
          Prototype Gallery · dev only
        </p>
        <h1 className="m-0 text-2xl font-bold">JUFE评课社区 · UI 模块</h1>
        <p className="m-0 max-w-3xl text-sm text-muted">
          一次只回答一个视觉问题。主要模块挂在真实路由与真实数据上；Sky
          token 等小组件在 Gallery 并排验证。变体通过 URL{" "}
          <code className="rounded bg-default px-1">?module=&variant=</code>{" "}
          切换，可复制、可刷新。
        </p>
        <p className="m-0 text-xs text-muted">
          顺序见 docs/ui/foundations.md · 当前优先：目录后续收藏/条件密度（issue
          #63 · module=catalog-followup）· 启动：
          <code className="rounded bg-default px-1">pnpm prototype</code>
          （API 另开{" "}
          <code className="rounded bg-default px-1">pnpm dev</code>）
        </p>
      </header>

      <section aria-label="模块列表" className="grid gap-3 lg:grid-cols-2">
        {PROTOTYPE_MODULES.map((mod) => (
          <ModuleCard key={mod.id} mod={mod} active={module?.id === mod.id} />
        ))}
      </section>

      {module?.id === "sky-tokens" && variant ? (
        <section
          aria-label="Sky token 预览"
          className="rounded-xl border border-border bg-background p-4"
        >
          <SkyTokenPreview variant={variant} />
        </section>
      ) : null}

      {module &&
      module.id !== "sky-tokens" &&
      module.preview === "live" &&
      module.variants.length > 0 ? (
        <section className="rounded-lg border border-border bg-surface px-4 py-4 text-sm">
          <p className="m-0 font-semibold">{module.title}</p>
          <p className="m-0 mt-1 text-muted">{module.question}</p>
          <p className="m-0 mt-2 text-xs text-muted">
            该模块在真实页面上下文预览。请从上方变体链接进入对应路由，底部切换条可循环
            A/B/C。课程详情摘要挂在 /courses/:id。
          </p>
          {module.livePath ? (
            <p className="m-0 mt-2">
              <Link
                className="button button--sm no-underline"
                to={`${module.livePath}?${PROTOTYPE_MODULE_PARAM}=${module.id}&${PROTOTYPE_VARIANT_PARAM}=${variant?.key || "A"}`}
              >
                打开 {module.livePath} · {variant?.key || "A"}
              </Link>
            </p>
          ) : null}
        </section>
      ) : null}

      {module && module.id !== "sky-tokens" && module.variants.length === 0 ? (
        <section className="rounded-lg border border-dashed border-border px-4 py-6 text-sm text-muted">
          模块「{module.title}」尚未制作变体。请先完成公共 Shell 与顶部导航。
        </section>
      ) : null}
    </div>
  );
}

export function PrototypeGalleryPage() {
  if (!PROTOTYPE_ENABLED) {
    return <Navigate to="/courses" replace />;
  }
  return <PrototypeGalleryContent />;
}
