import "./styles/globals.css";

// The SSR shell has critical styles inline. Enable the full stylesheet after
// the deferred module has started, so it does not block the first paint.
if (typeof document !== "undefined") {
  const stylesheet = document.querySelector<HTMLLinkElement>(
    'link[data-app-css][rel="preload"]',
  );
  if (stylesheet) stylesheet.rel = "stylesheet";
}

const root = document.getElementById("app");
if (!root) throw new Error("#app root missing");

const start = () => {
  void import("react-dom/client").then(({ createRoot }) =>
    import("./App").then(({ App }) => {
      createRoot(root).render(
        <App />,
      );
    }),
  );
};

if ("requestIdleCallback" in window) {
  window.requestIdleCallback(start, { timeout: 1200 });
} else {
  window.setTimeout(start, 0);
}
