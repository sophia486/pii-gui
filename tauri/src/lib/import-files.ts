/** File-name helpers shared by the native, browser and drag-drop import paths. */

const markdownExtensions = new Set(["md", "markdown"]);
const textExtensions = new Set(["txt", "text"]);

/** Lowercase extension of the last path segment, or "" when it has none. */
export function fileExtension(fileName: string) {
  const baseName = fileName.split(/[\\/]/).filter(Boolean).pop() ?? fileName;
  const dotIndex = baseName.lastIndexOf(".");

  // A leading dot marks a hidden file (".env"), not an extension.
  return dotIndex > 0 ? baseName.slice(dotIndex + 1).toLowerCase() : "";
}

export function isMarkdownFileName(fileName: string) {
  return markdownExtensions.has(fileExtension(fileName));
}

export function isPlainTextFileName(fileName: string) {
  return textExtensions.has(fileExtension(fileName));
}

/** Text documents import as plain text; Markdown and plain text share the
 * chunked non-PDF path, so both extensions are accepted here.
 */
export function isImportableTextFileName(fileName: string) {
  return isMarkdownFileName(fileName) || isPlainTextFileName(fileName);
}
