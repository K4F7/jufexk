/**
 * Official-style light/dark icon toggle.
 * Uses App.__jufexkSetTheme (localStorage "jufexk-theme"); initial visit follows system.
 */
import { Button } from "@heroui/react";
import { useEffect, useState } from "react";

function readScheme(): "light" | "dark" {
  if (typeof document === "undefined") return "light";
  return document.documentElement.classList.contains("dark") ||
    document.documentElement.dataset.theme === "dark"
    ? "dark"
    : "light";
}

function setTheme(mode: "light" | "dark") {
  const fn = (
    window as unknown as {
      __jufexkSetTheme?: (m: "light" | "dark" | "system") => void;
    }
  ).__jufexkSetTheme;
  fn?.(mode);
}

function SunIcon() {
  return (
    <svg
      aria-hidden
      className="size-4"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg
      aria-hidden
      className="size-4"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <path d="M21 14.5A8.5 8.5 0 1 1 9.5 3a7 7 0 0 0 11.5 11.5z" />
    </svg>
  );
}

export function ThemeToggle({
  className,
  size = "sm",
}: {
  className?: string;
  size?: "sm" | "md" | "lg";
}) {
  const [scheme, setScheme] = useState<"light" | "dark">(readScheme);

  useEffect(() => {
    const sync = () => setScheme(readScheme());
    sync();
    const obs = new MutationObserver(sync);
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme"],
    });
    return () => obs.disconnect();
  }, []);

  const next = scheme === "dark" ? "light" : "dark";
  const label = next === "dark" ? "切换到暗色模式" : "切换到亮色模式";

  return (
    <Button
      aria-label={label}
      className={className}
      isIconOnly
      size={size}
      variant="ghost"
      onPress={() => setTheme(next)}
    >
      {scheme === "dark" ? <SunIcon /> : <MoonIcon />}
    </Button>
  );
}
