/**
 * PROTOTYPE — chrome mounted only when import.meta.env.DEV is true.
 */
import "./themes/sky-tokens.css";
import { PrototypeSwitcher } from "./PrototypeSwitcher";
import { PrototypeThemeController } from "./PrototypeThemeController";

export function DevPrototypeChrome() {
  return (
    <>
      <PrototypeThemeController />
      <PrototypeSwitcher />
    </>
  );
}
