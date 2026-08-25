import { useEffect, useState } from "react";
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

  return (
    <iframe
      className="border-0 [color-scheme:normal]"
      height={30}
      src={statusBadgeUrl(scheme)}
      title="系统运行状态"
      width={250}
    />
  );
}