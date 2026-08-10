/** Gallery / switcher / theme variants must never ship in production builds. */
export const PROTOTYPE_ENABLED = import.meta.env.DEV;

export const PROTOTYPE_MODULE_PARAM = "module";
export const PROTOTYPE_VARIANT_PARAM = "variant";
