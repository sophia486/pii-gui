import type { PdfDocumentData } from "./pdf-document";

export type PiiTextChunk = {
  start: number;
  end: number;
};

export const piiTextChunkTokenLimit = 1000;

export function markdownPiiTextChunks(
  input: string,
  tokenLimit = piiTextChunkTokenLimit,
): PiiTextChunk[] {
  return textChunksByTokenCount(input, 0, input.length, tokenLimit);
}

export function pdfPiiTextChunks(
  document: PdfDocumentData,
  tokenLimit = piiTextChunkTokenLimit,
): PiiTextChunk[] {
  const pageRanges = pdfPageTextRanges(document);
  const chunks = pageRanges.flatMap((range) =>
    textChunksByTokenCount(document.text, range.start, range.end, tokenLimit),
  );

  return chunks.length > 0
    ? chunks
    : textChunksByTokenCount(document.text, 0, document.text.length, tokenLimit);
}

function textChunksByTokenCount(
  input: string,
  rangeStart: number,
  rangeEnd: number,
  tokenLimit: number,
): PiiTextChunk[] {
  if (rangeEnd <= rangeStart || !input.slice(rangeStart, rangeEnd).trim()) {
    return [];
  }

  const safeTokenLimit = Math.max(1, tokenLimit);
  const chunks: PiiTextChunk[] = [];
  const tokenPattern = /\S+\s*/g;
  tokenPattern.lastIndex = rangeStart;

  let chunkStart = rangeStart;
  let tokenCount = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenPattern.exec(input)) && match.index < rangeEnd) {
    const tokenStart = match.index;

    if (tokenCount >= safeTokenLimit) {
      pushNonEmptyChunk(input, chunks, chunkStart, tokenStart);
      chunkStart = tokenStart;
      tokenCount = 0;
    }

    tokenCount += 1;

    if (tokenPattern.lastIndex > rangeEnd) {
      tokenPattern.lastIndex = rangeEnd;
    }
  }

  pushNonEmptyChunk(input, chunks, chunkStart, rangeEnd);
  return chunks;
}

function pdfPageTextRanges(document: PdfDocumentData): PiiTextChunk[] {
  const ranges = document.pages
    .map((page) => {
      let start = -1;
      let end = -1;

      document.charBoxes.forEach((box, index) => {
        if (box?.pageIndex !== page.index) return;

        if (start < 0) start = index;
        end = index + 1;
      });

      return start >= 0 && end > start ? { start, end } : undefined;
    })
    .filter((range): range is PiiTextChunk => Boolean(range));

  return ranges;
}

function pushNonEmptyChunk(
  input: string,
  chunks: PiiTextChunk[],
  start: number,
  end: number,
) {
  if (end <= start || !input.slice(start, end).trim()) return;
  chunks.push({ start, end });
}
