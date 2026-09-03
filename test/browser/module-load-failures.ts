import type { Page } from "@playwright/test";

const MODULE_LOAD_FAILURE =
  /Failed to load module|Failed to fetch dynamically imported module|MIME type of ["']text\/html["']/i;

/** Course-detail white screens from hashed JS served as SPA HTML. */
export function collectModuleLoadFailures(page: Page): () => string[] {
  const failures: string[] = [];
  const record = (text: string) => {
    if (MODULE_LOAD_FAILURE.test(text)) failures.push(text);
  };
  page.on("pageerror", (error) => record(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") record(message.text());
  });
  return () => failures;
}
