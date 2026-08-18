import { describe, expect, it } from "vitest";
import {
  COMPOSITION_RECAPTURE_LIMIT,
  D13_DIRTY_COMPOSITION_SHA256,
  captureCompositionPair,
  decodePng,
  encodePng,
  evaluateComposition,
  inspectCompositionPixels,
  isKnownDirtyCompositionHash,
  type CompositionDomObservation,
  type CompositionFrame,
  type RgbaImage,
} from "./composition_qa";

describe("freeze-time composition QA", () => {
  it("accepts a clean formula/cell pair without rewriting the formula-bar record hash", () => {
    const recordSha = "a".repeat(64);
    const result = evaluateComposition({
      observation: observation({ formula_bar_record_sha256: recordSha }),
      formula: frame(cleanFormulaImage()),
      cell: frame(cleanCellImage()),
    });

    expect(result.status).toBe("accepted");
    expect(result.issues).toEqual([]);
    expect(result.rewrite_source_json).toBe(false);
    expect(result.formula_bar_record_sha256).toBe(recordSha);
  });

  it("rejects D13-class dirty explorer/terminal fixtures and does not mark them accepted", () => {
    const result = evaluateComposition({
      observation: observation(),
      formula: frame(dirtyDesktopImage()),
      cell: frame(dirtyDesktopImage({ shift: 20 })),
    });

    expect(result.status).toBe("recapture_required");
    expect(result.issues.some((issue) => issue.includes("dark overlay") || issue.includes("terminal"))).toBe(true);
    expect(isKnownDirtyCompositionHash(D13_DIRTY_COMPOSITION_SHA256["体育课|13|D|formula"])).toBe(true);
    expect(isKnownDirtyCompositionHash(D13_DIRTY_COMPOSITION_SHA256["体育课|13|D|cell"])).toBe(true);
    expect(inspectCompositionPixels(dirtyDesktopImage(), "cell").length).toBeGreaterThan(0);
  });

  it("rejects identical formula/cell hashes", () => {
    const bytes = encodePng(cleanFormulaImage());
    const result = evaluateComposition({
      observation: observation(),
      formula: { method: "playwright_page", bytes },
      cell: { method: "playwright_page", bytes },
    });

    expect(result.status).toBe("recapture_required");
    expect(result.issues).toContain("formula/cell hashes are identical");
  });

  it("rejects CopyFromScreen and JPEG desktop grabs as the evidence path", () => {
    const desktop = evaluateComposition({
      observation: observation(),
      formula: { method: "copy_from_screen", bytes: encodePng(cleanFormulaImage()) },
      cell: { method: "copy_from_screen", bytes: encodePng(cleanCellImage()) },
    });
    expect(desktop.status).toBe("recapture_required");
    expect(desktop.issues.some((issue) => issue.includes("desktop composite"))).toBe(true);

    const jpeg = evaluateComposition({
      observation: observation(),
      formula: { method: "print_window", bytes: Uint8Array.from([0xff, 0xd8, 1, 2, 3]) },
      cell: { method: "print_window", bytes: Uint8Array.from([0xff, 0xd8, 4, 5, 6]) },
    });
    expect(jpeg.status).toBe("recapture_required");
    expect(jpeg.issues.some((issue) => issue.includes("jpeg desktop grab"))).toBe(true);
  });

  it("requires 只能查看, the address box, and active address = target", () => {
    const result = evaluateComposition({
      observation: observation({
        view_only_visible: false,
        address_box_present: false,
        active_address: "G7",
        formula_clip: { x: 0, y: 0, width: 100, height: 40 },
        chrome_rects: {
          view_only: { x: 200, y: 0, width: 72, height: 24 },
          address_box: { x: 10, y: 20, width: 80, height: 24 },
          formula_bar: { x: 100, y: 18, width: 400, height: 28 },
        },
      }),
      formula: frame(cleanFormulaImage()),
      cell: frame(cleanCellImage()),
    });

    expect(result.status).toBe("recapture_required");
    expect(result.issues).toEqual(expect.arrayContaining([
      "formula image is missing 只能查看",
      "formula image is missing the address box",
      "active address G7 is not D13",
      "formula clip does not include 只能查看",
      "formula clip does not include the formula bar",
    ]));
  });

  it("retries the same address and then stops that cell as recapture_required", async () => {
    const grabs: string[] = [];
    const pair = await captureCompositionPair({
      observation: observation({ formula_bar_record_sha256: "keep-me" }),
      grabFormula: async () => {
        grabs.push("formula");
        return frame(dirtyDesktopImage());
      },
      grabCell: async () => {
        grabs.push("cell");
        return frame(dirtyDesktopImage({ shift: 12 }));
      },
    });

    expect(pair.status).toBe("recapture_required");
    expect(pair.attempts).toBe(COMPOSITION_RECAPTURE_LIMIT);
    expect(grabs).toEqual(["formula", "cell", "formula", "cell", "formula", "cell"]);
    expect(pair.rewrite_source_json).toBe(false);
    expect(pair.formula_bar_record_sha256).toBe("keep-me");
  });

  it("writes nothing on a failed attempt and accepts the first clean retry", async () => {
    let attempt = 0;
    const pair = await captureCompositionPair({
      observation: observation({ formula_bar_record_sha256: "keep-me" }),
      grabFormula: async () => {
        attempt += 1;
        return frame(attempt === 1 ? dirtyDesktopImage() : cleanFormulaImage());
      },
      grabCell: async () => frame(attempt === 1 ? dirtyDesktopImage({ shift: 8 }) : cleanCellImage()),
    });

    expect(pair.status).toBe("accepted");
    if (pair.status !== "accepted") throw new Error("expected accepted composition pair");
    expect(pair.attempts).toBe(2);
    expect(pair.formula_bar_record_sha256).toBe("keep-me");
    expect(pair.rewrite_source_json).toBe(false);
    expect(pair.formula.sha256).not.toBe(pair.cell.sha256);
  });

  it("round-trips generated PNG fixtures", () => {
    const source = cleanCellImage();
    const decoded = decodePng(encodePng(source));
    expect(decoded.width).toBe(source.width);
    expect(decoded.height).toBe(source.height);
    expect(Array.from(decoded.rgba.slice(0, 12))).toEqual(Array.from(source.rgba.slice(0, 12)));
  });
});

function observation(overrides: Partial<CompositionDomObservation> = {}): CompositionDomObservation {
  return {
    target_address: "D13",
    active_address: "D13",
    view_only_visible: true,
    address_box_present: true,
    formula_bar_reads: ["老师挺负责", "老师挺负责"],
    formula_bar_record_sha256: null,
    ...overrides,
  };
}

function frame(image: RgbaImage): CompositionFrame {
  return { method: "print_window", bytes: encodePng(image) };
}

function paint(width: number, height: number, color: (x: number, y: number) => [number, number, number]): RgbaImage {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = color(x, y);
      const index = (y * width + x) * 4;
      rgba[index] = r;
      rgba[index + 1] = g;
      rgba[index + 2] = b;
      rgba[index + 3] = 255;
    }
  }
  return { width, height, rgba };
}

function cleanFormulaImage(): RgbaImage {
  return paint(320, 120, (x, y) => {
    if (x >= 12 && x <= 70 && y >= 16 && y <= 40) return [255, 255, 255];
    if (x >= 80 && x <= 240 && y >= 16 && y <= 44) return [252, 252, 252];
    if (x >= 248 && x <= 308 && y >= 14 && y <= 36) return [230, 240, 255];
    return [236, 238, 241];
  });
}

function cleanCellImage(): RgbaImage {
  return paint(320, 220, (x, y) => {
    if (x % 40 < 2 || y % 28 < 2) return [90, 96, 104];
    return [255, 255, 255];
  });
}

function dirtyDesktopImage(options: { shift?: number } = {}): RgbaImage {
  const shift = options.shift ?? 0;
  return paint(320, 220, (x, y) => {
    if (x < 56) return [245, 245, 245];
    if (x >= 70 + shift && x <= 230 + shift && y >= 24 && y <= 150) return [18, 18, 20];
    return [250, 250, 250];
  });
}
