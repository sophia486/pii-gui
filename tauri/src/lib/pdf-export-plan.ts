/**
 * Which strategy each source page gets in the redacted PDF export.
 *
 * `copy` keeps the original page, so its text stays searchable and the file
 * stays small. `raster` re-renders the page as an image, which is the only
 * strategy that removes the covered text from the file. `cover` copies the
 * page and paints boxes over the matches: the page keeps its text layer, so
 * the covered text is still recoverable from the content stream.
 */
export type PdfExportMode = "raster" | "searchable";

export type PdfPageStrategy = "copy" | "raster" | "cover";

export type PdfPagePlan = {
  pageIndex: number;
  strategy: PdfPageStrategy;
};

export function planPdfPages({
  pageCount,
  redactedPageIndexes,
  mode = "raster",
}: {
  pageCount: number;
  redactedPageIndexes: Iterable<number>;
  mode?: PdfExportMode;
}): PdfPagePlan[] {
  const redacted = new Set(redactedPageIndexes);

  return Array.from({ length: Math.max(0, pageCount) }, (_, pageIndex) => ({
    pageIndex,
    strategy: !redacted.has(pageIndex)
      ? "copy"
      : mode === "searchable"
        ? "cover"
        : "raster",
  }));
}
