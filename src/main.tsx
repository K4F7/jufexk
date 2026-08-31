import "./styles/globals.css";

const root = document.getElementById("app");
if (!root) throw new Error("#app root missing");

const start = () => {
  // The SSR shell has critical styles inline. Enable the full stylesheet only
  // once the browser is idle, so it does not compete with the first paint.
  const stylesheet = document.querySelector<HTMLLinkElement>(
    'link[data-app-css][rel="preload"]',
  );
  if (stylesheet) stylesheet.rel = "stylesheet";

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
