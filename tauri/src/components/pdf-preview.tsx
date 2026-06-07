import { useEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import {
  base64ToUint8Array,
  rectsForPdfMatch,
  selectedPdfRects,
  type PdfDocumentData,
} from "@/lib/pdf-document";
import { pdfjs } from "@/lib/pdfjs";
import type { PiiMatch, PiiMatchSelection } from "@/lib/redaction-policy";
import { cn } from "@/lib/utils";

type PdfPreviewProps = {
  document: PdfDocumentData;
  matches: PiiMatch[];
  selection: PiiMatchSelection;
  mode: "input" | "output";
  className?: string;
  scale?: number;
};

type RenderedPage = {
  index: number;
  width: number;
  height: number;
  dataUrl: string;
};

export function PdfPreview({
  document,
  matches,
  selection,
  mode,
  className,
  scale = 1.1,
}: PdfPreviewProps) {
  const [pages, setPages] = useState<RenderedPage[]>([]);
  const [error, setError] = useState<string | undefined>();
  const renderKey = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const currentRenderKey = renderKey.current + 1;
    renderKey.current = currentRenderKey;
    setPages([]);
    setError(undefined);

    async function renderPages() {
      const loadingTask = pdfjs.getDocument({
        data: base64ToUint8Array(document.dataBase64),
      });

      try {
        const pdf = await loadingTask.promise;
        const nextPages: RenderedPage[] = [];

        for (let pageIndex = 0; pageIndex < pdf.numPages; pageIndex += 1) {
          if (cancelled || renderKey.current !== currentRenderKey) break;

          const page = await pdf.getPage(pageIndex + 1);
          const viewport = page.getViewport({ scale });
          const canvas = window.document.createElement("canvas");
          const context = canvas.getContext("2d");
          if (!context) continue;

          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);

          await page.render({ canvas, canvasContext: context, viewport }).promise;

          nextPages.push({
            index: pageIndex,
            width: viewport.width,
            height: viewport.height,
            dataUrl: canvas.toDataURL("image/png"),
          });

          if (!cancelled && renderKey.current === currentRenderKey) {
            setPages([...nextPages]);
          }
        }

      } catch (renderError) {
        if (!cancelled) {
          setError(
            renderError instanceof Error
              ? renderError.message
              : String(renderError),
          );
        }
      }
    }

    void renderPages();

    return () => {
      cancelled = true;
    };
  }, [document.dataBase64, scale]);

  const activeOverlays =
    mode === "output"
      ? selectedPdfRects({ document, matches, selection })
      : matches.flatMap((match) =>
          rectsForPdfMatch(document, match).map((rect) => ({ rect, match })),
        );

  return (
    <div
      className={cn(
        "min-h-0 w-full flex-1 overflow-auto rounded-md border bg-muted/40 p-3",
        className,
      )}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="truncate text-xs font-medium text-muted-foreground">
          {document.fileName}
        </span>
        <Badge variant="secondary">
          {document.pages.length} {document.pages.length === 1 ? "page" : "pages"}
        </Badge>
      </div>
      {error ? (
        <div className="rounded-md border bg-card p-3 text-sm text-muted-foreground">
          Failed to render PDF preview: {error}
        </div>
      ) : null}
      {pages.length === 0 && !error ? (
        <div className="rounded-md border bg-card p-3 text-sm text-muted-foreground">
          Loading PDF preview...
        </div>
      ) : null}
      <div className="flex flex-col items-center gap-4">
        {pages.map((page) => (
          <div
            key={page.index}
            className="relative overflow-hidden rounded-md border bg-white shadow-sm"
            style={{
              width: page.width,
              height: page.height,
            }}
          >
            <img
              src={page.dataUrl}
              alt={`PDF page ${page.index + 1}`}
              className="size-full"
              draggable={false}
            />
            <div className="pointer-events-none absolute inset-0">
              {activeOverlays
                .filter(({ rect }) => rect.pageIndex === page.index)
                .map(({ rect, match }, index) => (
                  <div
                    key={`${match.id}-${index}`}
                    title={`${match.kind}: ${match.value}`}
                    className={cn(
                      "absolute rounded-[2px]",
                      mode === "output"
                        ? "bg-black"
                        : "border border-primary/70 bg-primary/20",
                    )}
                    style={{
                      left: rect.x * scale,
                      top: rect.y * scale,
                      width: Math.max(2, rect.width * scale),
                      height: Math.max(8, rect.height * scale),
                    }}
                  />
                ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
