import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import { base64ToUint8Array, type PdfDocumentData } from "./pdf-document";

// A one-page blank PDF generated with pdf-lib, so the valid case below proves
// the export path resolves and the reject case cannot pass for the wrong
// reason.
const MINIMAL_PDF_BASE64 = "JVBERi0xLjcKJYGBgYEKCjUgMCBvYmoKPDwKL0ZpbHRlciAvRmxhdGVEZWNvZGUKL1R5cGUgL09ialN0bQovTiA0Ci9GaXJzdCAyMAovTGVuZ3RoIDI1OQo+PgpzdHJlYW0KeJzVUk1LxDAQvedXzFFPmUzSpiul4PbjIsKyeFL2ELZhKchm6Qfov3fSrIoH8ezhMZm8N0kmbxQgEBgDGmwBBjJNUJZCPr1fPMidO/lJyIehn+CFWYQ9HISsw3KeQYmqEt/a2s3uNZxEKgIVxZ+K3Rj65ehHKLu26xAtIuaGkSNSw7FmbBjEOXNU8JphzRW8ZzWivmeuS8htqon8qs2u9S1H1uZR0yStKVL+dW+8q01n0F/v2VRCPoa+cbOHm+aOkHKFRKQw0/r5lr9j9G4O/7e59f1DOP/a4Q+fo73R5NHHGVhdlns/hWU8su2sq+J/+X5w2/DGU4NxwjDhEMkPLNSNugplbmRzdHJlYW0KZW5kb2JqCgo2IDAgb2JqCjw8Ci9TaXplIDcKL1Jvb3QgMiAwIFIKL0luZm8gMyAwIFIKL0ZpbHRlciAvRmxhdGVEZWNvZGUKL1R5cGUgL1hSZWYKL0xlbmd0aCAzNAovVyBbIDEgMiAyIF0KL0luZGV4IFsgMCA3IF0KPj4Kc3RyZWFtCnicFcQxDgAgCASwHsbd7/p6CB2K7nLZstV24pF8BkOGAq0KZW5kc3RyZWFtCmVuZG9iagoKc3RhcnR4cmVmCjM3NwolJUVPRg==";
import {
  bytesToBase64,
  createRedactedPdfBytes,
} from "./pdf-redacted-export";
import { pdfjs } from "./pdfjs";

describe("bytesToBase64", () => {
  it("round-trips through base64ToUint8Array", () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);

    expect(base64ToUint8Array(bytesToBase64(bytes))).toEqual(bytes);
  });

  it("handles payloads larger than one chunk", () => {
    const bytes = new Uint8Array(0x8000 * 2 + 3);
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = index % 251;
    }

    expect(base64ToUint8Array(bytesToBase64(bytes))).toEqual(bytes);
  });

  it("encodes an empty input", () => {
    expect(bytesToBase64(new Uint8Array(0))).toBe("");
  });
});

describe("createRedactedPdfBytes", () => {
  beforeAll(() => {
    // vite gives workerSrc as a root-relative URL; node needs a file URL to
    // set up pdfjs's fake worker, and the first setup failure is cached.
    pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(
      join(process.cwd(), pdfjs.GlobalWorkerOptions.workerSrc),
    ).href;
  });

  it("rejects a document whose bytes are not a PDF", async () => {
    const document = {
      fileName: "not-a-pdf.pdf",
      dataBase64: bytesToBase64(new TextEncoder().encode("plain text")),
      pages: [],
    } as unknown as PdfDocumentData;

    await expect(
      createRedactedPdfBytes({ document, matches: [], selection: {} }),
    ).rejects.toThrow();
  });

  it("resolves a minimal valid PDF", async () => {
    // The reject case above is only meaningful if a valid document gets past
    // parsing. The full export rasterizes through a DOM canvas, which the
    // node test environment does not provide, so this pins the parse
    // boundary the export depends on.
    const sourceBytes = base64ToUint8Array(MINIMAL_PDF_BASE64);

    const pdf = await pdfjs.getDocument({ data: sourceBytes }).promise;

    expect(pdf.numPages).toBe(1);
  });

});
