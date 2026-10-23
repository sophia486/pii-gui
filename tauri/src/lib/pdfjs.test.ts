import { existsSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { pdfjs } from "./pdfjs";

describe("pdfjs setup", () => {
  it("re-exports the pdfjs module with its document loader", () => {
    expect(typeof pdfjs.getDocument).toBe("function");
  });

  it("points the worker at the bundled asset", () => {
    expect(typeof pdfjs.GlobalWorkerOptions.workerSrc).toBe("string");
    expect(pdfjs.GlobalWorkerOptions.workerSrc.length).toBeGreaterThan(0);
    expect(pdfjs.GlobalWorkerOptions.workerSrc).toContain("pdf.worker");
  });

  it("resolves workerSrc to a worker file that exists in the build", () => {
    const src = pdfjs.GlobalWorkerOptions.workerSrc;
    const path = join(process.cwd(), src);
    expect(existsSync(path), `worker file missing at ${path}`).toBe(true);
  });

  it("installs the async-iterator shim on ReadableStream", () => {
    expect(
      typeof (ReadableStream.prototype as unknown as Record<PropertyKey, unknown>)[
        Symbol.asyncIterator
      ],
    ).toBe("function");
  });
});
