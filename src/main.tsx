import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
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

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
