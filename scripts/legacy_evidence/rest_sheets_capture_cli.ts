import { restSheetsCaptureUsage, runRestSheetsCaptureCli } from "./rest_sheets_capture";

try {
  const result = await runRestSheetsCaptureCli(process.argv.slice(2));
  const pretty = result && typeof result === "object" && "steps" in result;
  console.log(JSON.stringify(result, null, pretty ? 2 : 0));
  if (result && typeof result === "object" && "status" in result && result.status !== "accepted") {
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error(restSheetsCaptureUsage());
  process.exit(2);
}
