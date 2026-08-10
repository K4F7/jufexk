/**
 * PROTOTYPE — apply / clear html[data-prototype-theme] for token modules.
 */
const SKY_PREFIX = "sky-";

export function applyPrototypeTheme(
  moduleId: string | undefined,
  variantKey: string | undefined,
) {
  const root = document.documentElement;
  if (moduleId === "sky-tokens" && variantKey) {
    root.dataset.prototypeTheme = `${SKY_PREFIX}${variantKey.toUpperCase()}`;
    return;
  }
  delete root.dataset.prototypeTheme;
}

export function clearPrototypeTheme() {
  delete document.documentElement.dataset.prototypeTheme;
}
