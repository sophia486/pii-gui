import { pdfjs } from "@/lib/pdfjs";

import type { PiiMatch, PiiMatchSelection } from "./redaction-policy";

export type PdfRect = {
  pageIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PdfPageData = {
  index: number;
  width: number;
  height: number;
};

export type PdfDocumentData = {
  fileName: string;
  dataBase64: string;
  text: string;
  pages: PdfPageData[];
  charBoxes: Array<PdfRect | null>;
};

type TextItem = {
  str: string;
  width: number;
  height: number;
  transform: number[];
};

type TextItemRect = {
  rect: PdfRect;
  splitHorizontally: boolean;
};

export function isPdfFileName(fileName: string) {
  return /\.pdf$/i.test(fileName);
}

export async function createPdfDocumentData({
  fileName,
  dataBase64,
}: {
  fileName: string;
  dataBase64: string;
}): Promise<PdfDocumentData> {
  const bytes = base64ToUint8Array(dataBase64);
  const loadingTask = pdfjs.getDocument({ data: bytes });
  const document = await loadingTask.promise;
  const pages: PdfPageData[] = [];
  const textParts: string[] = [];
  const charBoxes: Array<PdfRect | null> = [];

  for (let pageIndex = 0; pageIndex < document.numPages; pageIndex += 1) {
    const page = await document.getPage(pageIndex + 1);
    const viewport = page.getViewport({ scale: 1 });
    const textContent = await page.getTextContent();

    pages.push({
      index: pageIndex,
      width: viewport.width,
      height: viewport.height,
    });

    if (pageIndex > 0) appendText("\n\n", null);

    for (const item of textContent.items) {
      if (!("str" in item)) continue;

      const textItem = item as TextItem;
      const text = textItem.str;
      if (!text) continue;

      if (needsSpace(textParts[textParts.length - 1], text)) {
        appendText(" ", null);
      }

      const itemBox = textItemToRect(textItem, viewport, pageIndex);
      appendText(text, itemBox.rect, itemBox.splitHorizontally);
    }
  }

  return {
    fileName,
    dataBase64,
    text: textParts.join(""),
    pages,
    charBoxes,
  };

  function appendText(
    text: string,
    rect: PdfRect | null,
    splitHorizontally = true,
  ) {
    if (!text) return;

    textParts.push(text);

    if (!rect || text.length === 0) {
      for (let index = 0; index < text.length; index += 1) {
        charBoxes.push(null);
      }
      return;
    }

    if (!splitHorizontally) {
      for (let index = 0; index < text.length; index += 1) {
        charBoxes.push(rect);
      }
      return;
    }

    const characterWidth = rect.width / text.length;
    for (let index = 0; index < text.length; index += 1) {
      charBoxes.push({
        pageIndex: rect.pageIndex,
        x: rect.x + characterWidth * index,
        y: rect.y,
        width: characterWidth,
        height: rect.height,
      });
    }
  }
}

export function rectsForPdfMatch(
  document: PdfDocumentData,
  match: PiiMatch,
): PdfRect[] {
  const range = resolvePdfMatchRange(document.text, match);
  const boxes = document.charBoxes
    .slice(range.start, range.end)
    .filter((box): box is PdfRect => Boolean(box));

  if (boxes.length === 0) return [];

  const lines = new Map<string, PdfRect[]>();
  boxes.forEach((box) => {
    const lineKey = `${box.pageIndex}:${Math.round(box.y * 2) / 2}`;
    lines.set(lineKey, [...(lines.get(lineKey) ?? []), box]);
  });

  return Array.from(lines.values()).map((lineBoxes) => {
    const pageIndex = lineBoxes[0].pageIndex;
    const x = Math.min(...lineBoxes.map((box) => box.x));
    const y = Math.min(...lineBoxes.map((box) => box.y));
    const right = Math.max(...lineBoxes.map((box) => box.x + box.width));
    const bottom = Math.max(...lineBoxes.map((box) => box.y + box.height));
    const height = bottom - y;
    // Char boxes often end at the text baseline; expand the redaction area so
    // descenders, antialiasing, and transformed text do not leak at the edges.
    // Applied here so tabs persisted with older char boxes are fixed too.
    const edgePadding = Math.max(2, height * 0.1);
    const firstBoxWidth = lineBoxes
      .filter((box) => box.width > 0)
      .sort((left, right) => left.x - right.x)[0]?.width;
    const firstGlyphAllowance =
      firstBoxWidth === undefined
        ? height * 0.12
        : Math.min(Math.max(firstBoxWidth * 0.6, 1.5), height * 0.55);
    const leftPadding = edgePadding + firstGlyphAllowance;
    const descent = height * 0.25;
    const page = document.pages.find(
      (candidate) => candidate.index === pageIndex,
    );

    return clampPdfRect(
      {
        pageIndex,
        x: x - leftPadding,
        y: y - edgePadding,
        width: right - x + leftPadding + edgePadding,
        height: height + descent + edgePadding * 2,
      },
      page,
    );
  });
}

function resolvePdfMatchRange(documentText: string, match: PiiMatch) {
  const fallback = { start: match.start, end: match.end };
  const value = match.value;

  if (!value) return fallback;
  if (documentText.slice(match.start, match.end) === value) return fallback;

  const resolvedStart = findNearestLiteralMatch(documentText, value, match.start);
  if (resolvedStart === -1) return fallback;

  return {
    start: resolvedStart,
    end: resolvedStart + value.length,
  };
}

function findNearestLiteralMatch(
  documentText: string,
  value: string,
  targetStart: number,
) {
  let bestStart = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  let searchStart = 0;

  while (searchStart <= documentText.length) {
    const found = documentText.indexOf(value, searchStart);
    if (found === -1) break;

    const distance = Math.abs(found - targetStart);
    if (distance < bestDistance) {
      bestStart = found;
      bestDistance = distance;
    }

    searchStart = found + Math.max(1, value.length);
  }

  if (bestStart !== -1) return bestStart;

  const trimmed = value.trim();
  if (trimmed.length >= 2 && trimmed !== value) {
    return findNearestLiteralMatch(documentText, trimmed, targetStart);
  }

  return -1;
}

function clampPdfRect(rect: PdfRect, page: PdfPageData | undefined): PdfRect {
  if (!page) return rect;

  const x = Math.max(0, rect.x);
  const y = Math.max(0, rect.y);
  const right = Math.min(page.width, rect.x + rect.width);
  const bottom = Math.min(page.height, rect.y + rect.height);

  return {
    pageIndex: rect.pageIndex,
    x,
    y,
    width: Math.max(1, right - x),
    height: Math.max(1, bottom - y),
  };
}

export function textItemToRect(
  item: TextItem,
  viewport: pdfjs.PageViewport,
  pageIndex: number,
): TextItemRect {
  const [a, b, c, d, x, baselineY] = pdfjs.Util.transform(
    viewport.transform,
    item.transform,
  ) as number[];
  const width = Math.max(Math.abs(item.width), 1);
  const height = Math.max(Math.abs(item.height), 8);
  const widthVector = scaledVector(a, b, width, { x: width, y: 0 });
  const heightVector = scaledVector(c, d, height, { x: 0, y: -height });
  const points = [
    { x, y: baselineY },
    { x: x + widthVector.x, y: baselineY + widthVector.y },
    { x: x + heightVector.x, y: baselineY + heightVector.y },
    {
      x: x + widthVector.x + heightVector.x,
      y: baselineY + widthVector.y + heightVector.y,
    },
  ];
  const left = Math.min(...points.map((point) => point.x));
  const top = Math.min(...points.map((point) => point.y));
  const right = Math.max(...points.map((point) => point.x));
  const bottom = Math.max(...points.map((point) => point.y));
  const splitHorizontally =
    Math.abs(widthVector.y) < 0.01 && Math.abs(heightVector.x) < 0.01;

  return {
    rect: {
      pageIndex,
      x: left,
      y: top,
      width: Math.max(right - left, 1),
      height: Math.max(bottom - top, height),
    },
    splitHorizontally,
  };
}

export function selectedPdfRects({
  document,
  matches,
  selection,
}: {
  document: PdfDocumentData;
  matches: PiiMatch[];
  selection: PiiMatchSelection;
}) {
  return matches
    .filter((match) => selection[match.id] !== false)
    .flatMap((match) =>
      rectsForPdfMatch(document, match).map((rect) => ({
        rect,
        match,
      })),
    );
}

export function base64ToUint8Array(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

export function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }

  return btoa(binary);
}

function scaledVector(
  x: number,
  y: number,
  length: number,
  fallback: { x: number; y: number },
) {
  const magnitude = Math.hypot(x, y);
  if (magnitude === 0) return fallback;

  return {
    x: (x / magnitude) * length,
    y: (y / magnitude) * length,
  };
}

function needsSpace(previous: string | undefined, next: string) {
  if (!previous || /\s$/.test(previous) || /^\s/.test(next)) return false;

  return true;
}
