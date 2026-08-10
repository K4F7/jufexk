import { useEffect, useRef, useState } from "react";
import { loadTurnstileScript } from "../lib/turnstile";

export function TurnstileBox({
  siteKey,
  onReadyChange,
  widgetRef,
}: {
  siteKey: string;
  onReadyChange: (ready: boolean, message: string) => void;
  widgetRef: React.MutableRefObject<string | number | null>;
}) {
  const elRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState("人机验证加载中，请稍候…");

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
            setStatus("人机验证已完成。");
            onReadyChange(true, "人机验证已完成。");
          },
          "expired-callback": () => {
            setStatus("验证已过期，正在自动刷新…");
            onReadyChange(false, "验证已过期，正在自动刷新…");
            if (widgetRef.current != null) window.turnstile?.reset(widgetRef.current);
          },
          "error-callback": () => {
            setStatus("人机验证失败，请检查网络后重试。");
            onReadyChange(false, "人机验证失败，请检查网络后重试。");
            return true;
          },
        });
        setStatus("请完成人机验证。");
        onReadyChange(false, "请完成人机验证。");
      } catch {
        setStatus("人机验证加载失败，请刷新页面重试。");
        onReadyChange(false, "人机验证加载失败，请刷新页面重试。");
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
    <div className="space-y-1">
      <div ref={elRef} />
      <p className="m-0 text-[13px] text-muted">{status}</p>
    </div>
  );
}
