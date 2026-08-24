/**
 * Official-style light/dark icon toggle.
 * Uses App.__jufexkSetTheme (localStorage "jufexk-theme"); initial visit follows system.
 * Icons: HeroUI-recommended @gravity-ui/icons (Sun / Moon).
 */
import { Moon, Sun } from "@gravity-ui/icons";
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
      {scheme === "dark" ? <Sun aria-hidden /> : <Moon aria-hidden />}
    </Button>
  );
}
