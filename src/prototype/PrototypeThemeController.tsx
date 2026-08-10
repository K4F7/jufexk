/**
 * PROTOTYPE — keeps data-prototype-theme in sync with URL module/variant.
 */
import { useEffect } from "react";
import { applyPrototypeTheme, clearPrototypeTheme } from "./applyThemeVariant";
import { usePrototypeNavigation } from "./usePrototypeNavigation";

export function PrototypeThemeController() {
  const { moduleId, variant } = usePrototypeNavigation();

  useEffect(() => {
    applyPrototypeTheme(moduleId || undefined, variant?.key);
  }, [moduleId, variant?.key]);

  useEffect(() => {
    return () => {
      clearPrototypeTheme();
    };
  }, []);

  return null;
}
