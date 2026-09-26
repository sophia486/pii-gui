import { describe, expect, it } from "vitest";

import { planPdfPages } from "./pdf-export-plan";

describe("planPdfPages", () => {
  it("copies pages that hold no redaction", () => {
    const plan = planPdfPages({
      pageCount: 3,
      redactedPageIndexes: [],
    });

    expect(plan.map((page) => page.strategy)).toEqual(["copy", "copy", "copy"]);
  });

  it("rasterizes only the pages that were redacted", () => {
    const plan = planPdfPages({
      pageCount: 4,
      redactedPageIndexes: [1],
    });

    expect(plan.map((page) => page.pageIndex)).toEqual([0, 1, 2, 3]);
    expect(plan.map((page) => page.strategy)).toEqual([
      "copy",
      "raster",
      "copy",
      "copy",
    ]);
  });

  it("covers matches instead of rasterizing in searchable mode", () => {
    const plan = planPdfPages({
      pageCount: 2,
      redactedPageIndexes: [0, 1],
      mode: "searchable",
    });

    expect(plan.map((page) => page.strategy)).toEqual(["cover", "cover"]);
  });

  it("ignores indexes outside the document", () => {
    const plan = planPdfPages({
      pageCount: 1,
      redactedPageIndexes: [1, 7],
    });

    expect(plan).toHaveLength(1);
    expect(plan[0].strategy).toBe("copy");
  });
});
