/**
 * PROTOTYPE — chrome mounted only when import.meta.env.DEV is true.
 */
import { DevIdentitySwitcher } from "./DevIdentitySwitcher";
import { PageAtlasChrome } from "./PageAtlasChrome";

export function DevPrototypeChrome() {
  return (
    <>
      <PageAtlasChrome />
      <DevIdentitySwitcher />
    </>
  );
}
