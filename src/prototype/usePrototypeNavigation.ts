/**
 * PROTOTYPE — URL helpers for module + variant state.
 * Preserves host-page search params (q, category, page, …) when cycling variants.
 */
import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import {
  PROTOTYPE_MODULE_PARAM,
  PROTOTYPE_VARIANT_PARAM,
} from "./enabled";
import {
  getPrototypeModule,
  type PrototypeModuleDef,
  type PrototypeVariantDef,
} from "./modules";

export function usePrototypeNavigation() {
  const [params, setParams] = useSearchParams();

  const moduleId = params.get(PROTOTYPE_MODULE_PARAM);
  const variantKey = (params.get(PROTOTYPE_VARIANT_PARAM) || "A").toUpperCase();
  const module = getPrototypeModule(moduleId);

  const variant: PrototypeVariantDef | undefined = useMemo(() => {
    if (!module || module.variants.length === 0) return undefined;
    return (
      module.variants.find((v) => v.key.toUpperCase() === variantKey) ||
      module.variants[0]
    );
  }, [module, variantKey]);

  const setModule = useCallback(
    (nextModuleId: string, nextVariant = "A") => {
      const sp = new URLSearchParams(params);
      sp.set(PROTOTYPE_MODULE_PARAM, nextModuleId);
      sp.set(PROTOTYPE_VARIANT_PARAM, nextVariant);
      setParams(sp, { replace: true });
    },
    [params, setParams],
  );

  const setVariant = useCallback(
    (nextVariant: string) => {
      const sp = new URLSearchParams(params);
      if (moduleId) sp.set(PROTOTYPE_MODULE_PARAM, moduleId);
      sp.set(PROTOTYPE_VARIANT_PARAM, nextVariant);
      setParams(sp, { replace: true });
    },
    [moduleId, params, setParams],
  );

  const cycleVariant = useCallback(
    (delta: number) => {
      if (!module || module.variants.length === 0) return;
      const keys = module.variants.map((v) => v.key.toUpperCase());
      const current = variant?.key.toUpperCase() || keys[0];
      const idx = Math.max(0, keys.indexOf(current));
      const next = keys[(idx + delta + keys.length) % keys.length];
      setVariant(next);
    },
    [module, setVariant, variant],
  );

  const clearPrototype = useCallback(() => {
    const sp = new URLSearchParams(params);
    sp.delete(PROTOTYPE_MODULE_PARAM);
    sp.delete(PROTOTYPE_VARIANT_PARAM);
    setParams(sp, { replace: true });
  }, [params, setParams]);

  return {
    moduleId,
    module: module as PrototypeModuleDef | undefined,
    variantKey: variant?.key || variantKey,
    variant,
    setModule,
    setVariant,
    cycleVariant,
    clearPrototype,
    params,
  };
}
