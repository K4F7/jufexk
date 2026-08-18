import { resolve } from "node:path";
import {
  parseProductionGapArgs,
  productionGapUsage,
  runProductionGap,
} from "./production_gap";

try {
  const options = parseProductionGapArgs(process.argv.slice(2));
  const result = await runProductionGap({
    ...options,
    formulaBarDir: resolve(options.formulaBarDir),
    production: options.production.map((item) => ({ ...item, path: resolve(item.path) })),
    unimported: options.unimported.map((item) => ({ ...item, path: resolve(item.path) })),
    outDir: resolve(options.outDir),
  });
  console.log(JSON.stringify({
    json: result.jsonPath,
    markdown: result.markdownPath,
    planned_cells: result.inventory.planned_cells,
    production_records: result.inventory.production_records,
    production_unique_keys: result.inventory.production_unique_keys,
    production_missing_from_formula: result.inventory.production_missing_from_formula,
    later_capture: {
      smoke: result.inventory.later_capture.smoke.cell_count,
      non_smoke: result.inventory.later_capture.non_smoke.cell_count,
    },
    inventory_sha256: result.inventory.inventory_sha256,
  }));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error(productionGapUsage());
  process.exit(2);
}
