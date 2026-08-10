/**
 * PROTOTYPE — floating bottom bar for A/B/C cycling.
 * Hidden in production via PROTOTYPE_ENABLED gate at mount site.
 */
import { Button } from "@heroui/react";
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { usePrototypeNavigation } from "./usePrototypeNavigation";

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  return Boolean(target.closest("[contenteditable='true']"));
}

export function PrototypeSwitcher() {
  const navigate = useNavigate();
  const { module, variant, cycleVariant, clearPrototype } =
    usePrototypeNavigation();

  useEffect(() => {
    if (!module || module.variants.length === 0) return;

    function onKey(event: KeyboardEvent) {
      if (isEditableTarget(event.target)) return;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        cycleVariant(-1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        cycleVariant(1);
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cycleVariant, module]);

  if (!module || module.variants.length === 0 || !variant) {
    return null;
  }

  return (
    <div
      aria-label="Prototype 变体切换"
      className="pointer-events-none fixed inset-x-0 bottom-4 z-[100] flex justify-center px-3"
    >
      <div className="pointer-events-auto flex max-w-[min(720px,100%)] items-center gap-2 rounded-full border border-border bg-overlay/95 px-2 py-1.5 text-overlay-foreground shadow-overlay backdrop-blur">
        <Button
          aria-label="上一个变体"
          className="min-w-8 font-bold"
          size="sm"
          variant="secondary"
          onPress={() => cycleVariant(-1)}
        >
          ←
        </Button>
        <div className="min-w-0 flex-1 px-1 text-center">
          <div className="truncate text-xs font-semibold tabular">
            {variant.key} — {variant.name}
          </div>
          <div className="truncate text-[11px] text-muted">{module.title}</div>
        </div>
        <Button
          aria-label="下一个变体"
          className="min-w-8 font-bold"
          size="sm"
          variant="secondary"
          onPress={() => cycleVariant(1)}
        >
          →
        </Button>
        <Button
          aria-label="打开 Prototype Gallery"
          size="sm"
          variant="tertiary"
          onPress={() =>
            navigate(
              `/prototype?module=${module.id}&variant=${variant.key}`,
            )
          }
        >
          Gallery
        </Button>
        <Button
          aria-label="关闭 Prototype 变体"
          size="sm"
          variant="ghost"
          onPress={clearPrototype}
        >
          关闭
        </Button>
      </div>
    </div>
  );
}
