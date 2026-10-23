import { expect, it, vi } from "vitest";
const destroy = vi.fn();
const getDocument = vi.fn();
vi.mock("./pdfjs", () => ({
  pdfjs: { getDocument: (...args: unknown[]) => getDocument(...args) },
}));
import { scanExportedText, verifyExportedPdf } from "./pdf-export-verification";
const selected = {
  id: "x",
  kind: "private_person",
  value: "Synthetic Person",
  start: 0,
  end: 16,
};
it("rescans output text and reports counts without matched values", () => {
  const report = scanExportedText(
    ["Synthetic Person ada@example.com", "nothing"],
    [selected],
    [],
    "hash",
  );
  expect(report.status).toBe("residual-matches");
  expect(report.residualMatchCount).toBe(2);
  expect(report.residuals).toContainEqual({
    page: 1,
    kind: "private_person",
    count: 1,
  });
  expect(JSON.stringify(report)).not.toContain("Synthetic Person");
  expect(JSON.stringify(report)).not.toContain("ada@example.com");
});
it("does not call an image-only PDF safe", () => {
  expect(scanExportedText(["", " "], [], [], "hash").status).toBe(
    "no-extractable-text",
  );
  expect(scanExportedText(["ordinary words"], [], [], "hash").status).toBe(
    "no-text-matches",
  );
});
it("applies custom rules and deduplicates identical regex/source spans", () => {
  const report = scanExportedText(
    ["project123 ada@example.com"],
    [{ ...selected, kind: "private_email", value: "ada@example.com" }],
    [{ id: "x", name: "private client", mode: "exact", pattern: "project123" }],
    "hash",
  );
  expect(report.residualMatchCount).toBe(2);
  expect(JSON.stringify(report)).not.toContain("private client");
});
it("loads the actual output bytes and destroys the pdf.js task", async () => {
  getDocument.mockReturnValue({
    promise: Promise.resolve({
      numPages: 1,
      getPage: async () => ({
        getTextContent: async () => ({ items: [{ str: "ada@example.com" }] }),
      }),
    }),
    destroy,
  });
  const bytes = new Uint8Array([1, 2, 3]);
  const report = await verifyExportedPdf(bytes);
  expect(getDocument.mock.calls[0][0].data).not.toBe(bytes);
  expect(report.outputSha256).toHaveLength(64);
  expect(report.residualMatchCount).toBe(1);
  expect(destroy).toHaveBeenCalled();
});
it("cleans up after parsing fails", async () => {
  destroy.mockClear();
  getDocument.mockImplementationOnce(() => ({
    promise: Promise.reject(new Error("invalid PDF")),
    destroy,
  }));
  await expect(verifyExportedPdf(new Uint8Array([0]))).rejects.toThrow(
    "invalid PDF",
  );
  expect(destroy).toHaveBeenCalled();
});
