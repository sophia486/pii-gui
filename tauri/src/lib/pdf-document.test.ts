import { describe, expect, it } from "vitest";

import {
  rectsForPdfMatch,
  textItemToRect,
  type PdfDocumentData,
} from "@/lib/pdf-document";
import type { pdfjs } from "@/lib/pdfjs";
import type { PiiMatch } from "@/lib/redaction-policy";

function documentWithCharBoxes(
  charBoxes: PdfDocumentData["charBoxes"],
  text = charBoxes.map(() => "x").join(""),
): PdfDocumentData {
  return {
    fileName: "test.pdf",
    dataBase64: "",
    text,
    pages: [{ index: 0, width: 612, height: 792 }],
    charBoxes,
  };
}

function matchOver(start: number, end: number): PiiMatch {
  return {
    id: "match-1",
    kind: "private_email",
    value: "x".repeat(end - start),
    start,
    end,
  };
}

describe("rectsForPdfMatch", () => {
  it("extends the redaction box below the baseline to cover descenders", () => {
    // Char boxes produced at import end at the text baseline (y + height
    // = baselineY); descenders and underlines render below that line.
    const baselineBox = {
      pageIndex: 0,
      x: 100,
      y: 200,
      width: 10,
      height: 12,
    };
    const document = documentWithCharBoxes([
      baselineBox,
      { ...baselineBox, x: 110 },
    ]);

    const [rect] = rectsForPdfMatch(document, matchOver(0, 2));

    expect(rect.x).toBeCloseTo(92);
    expect(rect.y).toBe(198);
    expect(rect.height).toBeGreaterThan(12);
    // Bottom must extend past the baseline by a descent allowance.
    expect(rect.y + rect.height).toBeCloseTo(217);
  });

  it("merges char boxes on the same line into one rect", () => {
    const document = documentWithCharBoxes([
      { pageIndex: 0, x: 100, y: 200, width: 10, height: 12 },
      { pageIndex: 0, x: 110, y: 200, width: 10, height: 12 },
      { pageIndex: 0, x: 50, y: 300, width: 10, height: 12 },
    ]);

    const rects = rectsForPdfMatch(document, matchOver(0, 3));

    expect(rects).toHaveLength(2);
    expect(rects[0]).toMatchObject({ y: 198 });
    expect(rects[0].x).toBeCloseTo(92);
    expect(rects[0].width).toBeCloseTo(30);
    expect(rects[1]).toMatchObject({ y: 298 });
    expect(rects[1].x).toBeCloseTo(42);
    expect(rects[1].width).toBeCloseTo(20);
  });

  it("resolves drifted model offsets by searching for the literal match value", () => {
    const text = "AAAA secret@example.com BBB";
    const charBoxes = Array.from({ length: text.length }, (_, index) => ({
      pageIndex: 0,
      x: index * 5,
      y: 200,
      width: 5,
      height: 12,
    }));
    const document = documentWithCharBoxes(charBoxes, text);
    const [rect] = rectsForPdfMatch(document, {
      ...matchOver(0, 4),
      value: "secret@example.com",
    });

    expect(rect).toMatchObject({
      y: 198,
    });
    expect(rect.x).toBeCloseTo(20);
    expect(rect.width).toBeCloseTo(97);
  });
});

describe("textItemToRect", () => {
  const viewport = {
    transform: [1, 0, 0, -1, 0, 200],
  } as pdfjs.PageViewport;

  it("splits horizontal text items so redactions can stay character-scoped", () => {
    const result = textItemToRect(
      {
        str: "secret@example.com",
        width: 160,
        height: 20,
        transform: [20, 0, 0, 20, 50, 120],
      },
      viewport,
      0,
    );

    expect(result.splitHorizontally).toBe(true);
    expect(result.rect).toMatchObject({
      pageIndex: 0,
      x: 50,
      y: 60,
      width: 160,
      height: 20,
    });
  });

  it("marks transformed text items as whole-item redactions", () => {
    const result = textItemToRect(
      {
        str: "secret@example.com",
        width: 160,
        height: 20,
        transform: [0, 20, 20, 0, 50, 120],
      },
      viewport,
      0,
    );

    expect(result.splitHorizontally).toBe(false);
    expect(result.rect.width).toBeGreaterThanOrEqual(20);
    expect(result.rect.height).toBeGreaterThanOrEqual(160);
  });
});
