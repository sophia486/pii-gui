import { PDFDocument } from "pdf-lib";

import {
  base64ToUint8Array,
  selectedPdfRects,
  type PdfDocumentData,
} from "@/lib/pdf-document";
import { pdfjs } from "@/lib/pdfjs";
import type { PiiMatch, PiiMatchSelection } from "@/lib/redaction-policy";

type RedactedPdfExportOptions = {
  document: PdfDocumentData;
  matches: PiiMatch[];
  selection: PiiMatchSelection;
  scale?: number;
  /** Erase the matched text pixels (paint the page background over them). */
  removeText?: boolean;
  /** Draw a solid black box over the matched text. */
  addBlackBox?: boolean;
};

export async function createRedactedPdfBytes({
  document,
  matches,
  selection,
  scale = 2,
  removeText = false,
  addBlackBox = true,
}: RedactedPdfExportOptions) {
  const loadingTask = pdfjs.getDocument({
    data: base64ToUint8Array(document.dataBase64),
  });
  const sourcePdf = await loadingTask.promise;
  const outputPdf = await PDFDocument.create();
  const redactionRects = selectedPdfRects({ document, matches, selection });

  try {
    for (let pageIndex = 0; pageIndex < sourcePdf.numPages; pageIndex += 1) {
      const page = await sourcePdf.getPage(pageIndex + 1);
      const baseViewport = page.getViewport({ scale: 1 });
      const renderViewport = page.getViewport({ scale });
      const canvas = window.document.createElement("canvas");
      const context = canvas.getContext("2d");

      if (!context) {
        throw new Error("Failed to create PDF export canvas.");
      }

      canvas.width = Math.ceil(renderViewport.width);
      canvas.height = Math.ceil(renderViewport.height);
      context.fillStyle = "white";
      context.fillRect(0, 0, canvas.width, canvas.height);

      await page.render({
        canvas,
        canvasContext: context,
        viewport: renderViewport,
      }).promise;

      if (removeText || addBlackBox) {
        // A black box also erases the underlying pixels in the rasterized
        // page, so it covers both modes; removeText alone restores the page
        // background instead of leaving a visible marker.
        context.fillStyle = addBlackBox ? "black" : "white";
        redactionRects
          .filter(({ rect }) => rect.pageIndex === pageIndex)
          .forEach(({ rect }) => {
            context.fillRect(
              rect.x * scale,
              rect.y * scale,
              Math.max(2, rect.width * scale),
              Math.max(8, rect.height * scale),
            );
          });
      }

      const pageImage = await outputPdf.embedPng(await canvasToPngBytes(canvas));
      const outputPage = outputPdf.addPage([
        baseViewport.width,
        baseViewport.height,
      ]);

      outputPage.drawImage(pageImage, {
        x: 0,
        y: 0,
        width: baseViewport.width,
        height: baseViewport.height,
      });
    }
  } finally {
    await loadingTask.destroy();
  }

  return outputPdf.save();
}

export function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }

  return btoa(binary);
}

async function canvasToPngBytes(canvas: HTMLCanvasElement) {
  if (canvas.toBlob) {
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/png"),
    );

    if (blob) {
      return new Uint8Array(await blob.arrayBuffer());
    }
  }

  const dataUrl = canvas.toDataURL("image/png");
  return base64ToUint8Array(dataUrl.split(",", 2)[1] ?? "");
}
