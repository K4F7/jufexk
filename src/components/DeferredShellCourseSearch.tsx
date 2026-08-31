import { lazy, Suspense, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";

const ShellCourseSearch = lazy(() =>
  import("./ShellCourseSearch").then((module) => ({ default: module.ShellCourseSearch })),
);

/** Keep the shell search slot stable without loading its HeroUI tree up front. */
export function DeferredShellCourseSearch() {
  const { pathname } = useLocation();
  const defer = pathname === "/" || pathname === "/latest";
  const [activated, setActivated] = useState(false);
  const active = !defer || activated;
  const [params] = useSearchParams();
  const [query, setQuery] = useState(params.get("q") ?? "");
  const activate = () => setActivated(true);

  return active ? (
    <Suspense fallback={<ShellCourseSearchPlaceholder onActivate={activate} query={query} onQueryChange={setQuery} />}>
      <ShellCourseSearch autoFocus={activated} initialValue={query} />
    </Suspense>
  ) : (
    <ShellCourseSearchPlaceholder onActivate={activate} query={query} onQueryChange={setQuery} />
  );
}

function ShellCourseSearchPlaceholder({
  onActivate,
  query,
  onQueryChange,
}: {
  onActivate: () => void;
  query: string;
  onQueryChange: (value: string) => void;
}) {
  const navigate = useNavigate();

  return (
    <form
      aria-label="搜索课程"
      className="flex h-10 w-full items-center gap-2 rounded-md border border-default bg-surface px-3 text-sm text-muted shadow-xs focus-within:outline focus-within:outline-2 focus-within:outline-offset-1 focus-within:outline-focus"
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        const trimmed = query.trim();
        navigate(trimmed ? `/courses?q=${encodeURIComponent(trimmed)}` : "/courses");
      }}
    >
      <span aria-hidden>⌕</span>
      <input
        aria-label="搜索课程"
        className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted"
        name="shell-course-search"
        placeholder="搜索课程、老师"
        role="searchbox"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        onFocus={onActivate}
        onPointerDown={onActivate}
      />
    </form>
  );
}
