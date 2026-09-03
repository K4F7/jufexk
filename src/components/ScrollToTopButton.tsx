/**
 * 长评价流的右下角回到顶部。HeroUI v3 没有 ScrollToTop，用官方 Button。
 * 只在滚过约一屏后出现。
 */
import { ArrowUp } from "@gravity-ui/icons";
import { Button } from "@heroui/react";
import { useEffect, useState } from "react";

function isPastOneViewport(): boolean {
  return window.scrollY >= window.innerHeight;
}

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function ScrollToTopButton() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const sync = () => setVisible(isPastOneViewport());
    sync();
    window.addEventListener("scroll", sync, { passive: true });
    window.addEventListener("resize", sync);
    return () => {
      window.removeEventListener("scroll", sync);
      window.removeEventListener("resize", sync);
    };
  }, []);

  if (!visible) return null;

  return (
    <Button
      isIconOnly
      variant="secondary"
      size="md"
      aria-label="回到顶部"
      className="fixed right-4 bottom-4 z-40 max-sm:bottom-[max(1rem,env(safe-area-inset-bottom))]"
      onPress={() => {
        window.scrollTo({
          top: 0,
          behavior: prefersReducedMotion() ? "instant" : "smooth",
        });
      }}
    >
      <ArrowUp aria-hidden />
    </Button>
  );
}
