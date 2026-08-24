import { useEffect, useRef } from "react";
import { loadTurnstileScript } from "../lib/turnstile";

export function TurnstileBox({
  siteKey,
  onReadyChange,
  widgetRef,
  collapsed = false,
}: {
  siteKey: string;
  onReadyChange: (ready: boolean) => void;
  widgetRef: React.MutableRefObject<string | number | null>;
  /**
   * Hide the widget iframe but keep it mounted so `refresh-expired: auto`
   * keeps renewing the token.
   */
  collapsed?: boolean;
}) {
  const elRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!siteKey || !elRef.current) return;
    let cancelled = false;
    (async () => {
      try {
        await loadTurnstileScript();
        if (cancelled || !elRef.current || !window.turnstile) return;
        if (widgetRef.current != null) {
          window.turnstile.remove?.(widgetRef.current);
          widgetRef.current = null;
        }
        elRef.current.innerHTML = "";
        widgetRef.current = window.turnstile.render(elRef.current, {
          sitekey: siteKey,
          action: "turnstile-spin-v2",
          "refresh-expired": "auto",
          callback: () => {
            onReadyChange(true);
          },
          "expired-callback": () => {
            onReadyChange(false);
          },
          "error-callback": () => {
            onReadyChange(false);
            return true;
          },
        });
        onReadyChange(false);
      } catch {
        onReadyChange(false);
      }
    })();
    return () => {
      cancelled = true;
      if (widgetRef.current != null) {
        window.turnstile?.remove?.(widgetRef.current);
        widgetRef.current = null;
      }
    };
  }, [siteKey, onReadyChange, widgetRef]);

  return (
    <div>
      <div ref={elRef} className={collapsed ? "hidden" : undefined} />
    </div>
  );
}
