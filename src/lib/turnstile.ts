declare global {
  interface Window {
    turnstile?: {
      render: (
        el: string | HTMLElement,
        options: Record<string, unknown>,
      ) => string | number;
      reset: (widgetId?: string | number) => void;
      getResponse: (widgetId?: string | number) => string;
      remove?: (widgetId?: string | number) => void;
    };
  }
}

let scriptPromise: Promise<void> | null = null;

export function loadTurnstileScript() {
  if (window.turnstile) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src =
      "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Turnstile failed to load"));
    document.head.appendChild(script);
  });
  return scriptPromise;
}
