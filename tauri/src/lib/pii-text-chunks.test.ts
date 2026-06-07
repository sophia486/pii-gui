import { describe, expect, it } from "vitest";

import {
  markdownPiiTextChunks,
  pdfPiiTextChunks,
  type PiiTextChunk,
} from "./pii-text-chunks";
import type { PdfDocumentData, PdfRect } from "./pdf-document";

describe("PII text chunking", () => {
  it("splits markdown by token count while preserving offsets", () => {
    const input = "one two three four five six";

    expect(chunkTexts(input, markdownPiiTextChunks(input, 2))).toEqual([
      "one two ",
      "three four ",
      "five six",
    ]);
  });

  it("keeps markdown chunks under the configured token budget", () => {
    const input = Array.from({ length: 1005 }, (_, index) => `token-${index}`).join(
      " ",
    );
    const chunks = markdownPiiTextChunks(input, 1000);

    expect(chunks).toHaveLength(2);
    expect(tokenCount(input.slice(chunks[0].start, chunks[0].end))).toBe(1000);
    expect(tokenCount(input.slice(chunks[1].start, chunks[1].end))).toBe(5);
  });

  it("splits pdf text by page before token count", () => {
    const document = pdfDocumentFromPages([
      "page-one-a page-one-b page-one-c",
      "page-two-a page-two-b",
    ]);

    expect(chunkTexts(document.text, pdfPiiTextChunks(document, 2))).toEqual([
      "page-one-a page-one-b ",
      "page-one-c",
      "page-two-a page-two-b",
    ]);
  });
});

function chunkTexts(input: string, chunks: PiiTextChunk[]) {
  return chunks.map((chunk) => input.slice(chunk.start, chunk.end));
}

function tokenCount(input: string) {
  return input.trim().split(/\s+/).filter(Boolean).length;
}

function pdfDocumentFromPages(pages: string[]): PdfDocumentData {
  const textParts: string[] = [];
  const charBoxes: Array<PdfRect | null> = [];

  pages.forEach((pageText, pageIndex) => {
    if (pageIndex > 0) {
      textParts.push("\n\n");
      charBoxes.push(null, null);
    }

    textParts.push(pageText);
    for (let index = 0; index < pageText.length; index += 1) {
      charBoxes.push({
        pageIndex,
        x: index,
        y: 0,
        width: 1,
        height: 1,
      });
    }
  });

  return {
    fileName: "fixture.pdf",
    dataBase64: "",
    text: textParts.join(""),
    pages: pages.map((_, index) => ({
      index,
      width: 100,
      height: 100,
    })),
    charBoxes,
  };
}
