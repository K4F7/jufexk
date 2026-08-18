import { describe, expect, it } from "vitest";
import {
  assertPrintWindowOnlyScript,
  captureSheetWindowPng,
  readPrintWindowCaptureScript,
} from "./window_capture";

describe("PrintWindow sheet capture", () => {
  it("ships a PrintWindow(..., 2) script with no CopyFromScreen fallback", () => {
    const source = readPrintWindowCaptureScript();
    expect(() => assertPrintWindowOnlyScript(source)).not.toThrow();
    expect(source).toMatch(/PrintWindow\s*\([^)]*,\s*[^)]*,\s*2\s*\)/);
    expect(source).not.toMatch(/\.CopyFromScreen\s*\(/);
    expect(source).toMatch(/refusing CopyFromScreen fallback/);
  });

  it("rejects a desktop-composite script", () => {
    expect(() => assertPrintWindowOnlyScript("Graphics.FromImage($b).CopyFromScreen(0,0,0,0,$size)")).toThrow(
      "PrintWindow(..., 2)",
    );
    expect(() => assertPrintWindowOnlyScript("[WinCap]::PrintWindow($h, $hdc, 2)\n$g.CopyFromScreen(0,0,0,0,$s)")).toThrow(
      "must not use CopyFromScreen",
    );
  });

  it("does not treat a failed PrintWindow as a successful desktop grab", async () => {
    await expect(captureSheetWindowPng({
      hwnd: "1",
      outPng: "D:/tmp/sheet.png",
      run: async () => ({ code: 1, stdout: "", stderr: "PrintWindow failed; refusing CopyFromScreen fallback" }),
    })).rejects.toThrow("PrintWindow failed; refusing CopyFromScreen fallback");
  });

  it("parses a print_window JSON result from the helper", async () => {
    const result = await captureSheetWindowPng({
      hwnd: "1972200",
      outPng: "D:/tmp/sheet.png",
      run: async () => ({
        code: 0,
        stdout: "Add-Type noise\n{\"method\":\"print_window\",\"path\":\"D:/tmp/sheet.png\",\"width\":2560,\"height\":1440}\n",
        stderr: "",
      }),
    });
    expect(result).toEqual({
      method: "print_window",
      path: "D:/tmp/sheet.png",
      width: 2560,
      height: 1440,
    });
  });
});
