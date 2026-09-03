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
  const empty = !query;

  return (
    <form
      aria-label="搜索课程"
      className="search-field search-field--secondary search-field--full-width w-full"
      data-empty={empty ? "true" : undefined}
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        const trimmed = query.trim();
        navigate(trimmed ? `/courses?q=${encodeURIComponent(trimmed)}` : "/courses");
      }}
    >
      <div
        className="search-field__group search-field__group--full-width"
        data-slot="search-field-group"
      >
        <svg
          aria-hidden="true"
          className="search-field__search-icon"
          data-slot="search-field-search-icon"
          fill="none"
          height={16}
          role="presentation"
          viewBox="0 0 16 16"
          width={16}
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            clipRule="evenodd"
            d="M11.5 7a4.5 4.5 0 1 1-9 0a4.5 4.5 0 0 1 9 0m-.82 4.74a6 6 0 1 1 1.06-1.06l2.79 2.79a.75.75 0 1 1-1.06 1.06z"
            fill="currentColor"
            fillRule="evenodd"
          />
        </svg>
        <input
          aria-label="搜索课程"
          className="search-field__input w-full"
          data-slot="search-field-input"
          name="shell-course-search"
          placeholder="搜索课程、老师"
          role="searchbox"
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onFocus={onActivate}
          onPointerDown={onActivate}
        />
        <span
          aria-hidden
          className="close-button close-button--default search-field__clear-button pointer-events-none opacity-0"
          data-slot="search-field-clear-button"
          slot="clear"
        />
      </div>
    </form>
  );
}
