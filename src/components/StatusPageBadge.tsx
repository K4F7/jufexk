import { useEffect, useRef, useState } from "react";
import { statusBadgeUrl } from "../lib/site-links";

function readScheme(): "light" | "dark" {
  if (typeof document === "undefined") return "light";
  return document.documentElement.classList.contains("dark") ||
    document.documentElement.dataset.theme === "dark"
    ? "dark"
    : "light";
}

export function StatusPageBadge() {
  const [scheme, setScheme] = useState<"light" | "dark">(readScheme);
  const [shouldLoad, setShouldLoad] = useState(false);
  const placeholderRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const sync = () => setScheme(readScheme());
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme"],
    });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      if (!cancelled) setShouldLoad(true);
    };
    const placeholder = placeholderRef.current;
    if (!placeholder || !("IntersectionObserver" in window)) {
      const timeoutId = window.setTimeout(load, 2000);
      return () => {
        cancelled = true;
        window.clearTimeout(timeoutId);
      };
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        window.setTimeout(load, 0);
      },
      { rootMargin: "256px 0px" },
    );
    observer.observe(placeholder);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, []);

  if (!shouldLoad) {
    return (
      <span
        aria-label="系统运行状态"
        className="inline-block h-[30px] w-[250px]"
        role="img"
        ref={placeholderRef}
      />
    );
  }

  return (
    <iframe
      className="block border-0 [color-scheme:normal]"
      height={30}
      scrolling="no"
      loading="lazy"
      src={statusBadgeUrl(scheme)}
      title="系统运行状态"
      width={250}
    />
  );
}
