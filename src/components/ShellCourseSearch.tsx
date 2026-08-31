import { SearchField } from "@heroui/react";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

/** Center course search: submit jumps to /courses?q=... (Issue #402). */
export function ShellCourseSearch({
  autoFocus = false,
  initialValue = "",
}: {
  autoFocus?: boolean;
  initialValue?: string;
}) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [query, setQuery] = useState(initialValue || params.get("q") || "");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => setQuery(params.get("q") ?? ""), [params]);
  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  const submit = (value: string) => {
    const trimmed = value.trim();
    navigate(trimmed ? `/courses?q=${encodeURIComponent(trimmed)}` : "/courses");
  };

  return (
    <SearchField
      fullWidth
      aria-label="搜索课程"
      className="w-full"
      name="shell-course-search"
      value={query}
      variant="secondary"
      onChange={setQuery}
      onSubmit={submit}
    >
      <SearchField.Group>
        <SearchField.SearchIcon />
        <SearchField.Input ref={inputRef} className="w-full" placeholder="搜索课程、老师" />
        <SearchField.ClearButton aria-label="清空课程搜索" />
      </SearchField.Group>
    </SearchField>
  );
}
