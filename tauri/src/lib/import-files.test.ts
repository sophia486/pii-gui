import { describe, expect, it } from "vitest";

import {
  fileExtension,
  isImportableTextFileName,
  isMarkdownFileName,
  isPlainTextFileName,
} from "./import-files";

describe("import file names", () => {
  it("reads a lowercase extension from the last path segment", () => {
    expect(fileExtension("notes.md")).toBe("md");
    expect(fileExtension("/tmp/docs/Notes.MARKDOWN")).toBe("markdown");
    expect(fileExtension("C:\\Users\\me\\notes.txt")).toBe("txt");
  });

  it("does not treat a dotfile or a missing extension as an extension", () => {
    expect(fileExtension(".env")).toBe("");
    expect(fileExtension("README")).toBe("");
    expect(fileExtension("archive.tar.gz")).toBe("gz");
  });

  it("accepts plain text files on the import path", () => {
    expect(isPlainTextFileName("notes.txt")).toBe(true);
    expect(isPlainTextFileName("NOTES.TXT")).toBe(true);
    expect(isPlainTextFileName("/tmp/notes.text")).toBe(true);
    expect(isPlainTextFileName("notes.md")).toBe(false);
    expect(isPlainTextFileName("notes.docx")).toBe(false);
  });

  it("accepts Markdown and plain text as text documents", () => {
    expect(isImportableTextFileName("notes.md")).toBe(true);
    expect(isImportableTextFileName("notes.markdown")).toBe(true);
    expect(isImportableTextFileName("notes.txt")).toBe(true);
    expect(isImportableTextFileName("notes.pdf")).toBe(false);
    expect(isImportableTextFileName("notes.docx")).toBe(false);
    expect(isImportableTextFileName(".env")).toBe(false);
  });

  it("keeps Markdown detection separate from plain text", () => {
    expect(isMarkdownFileName("notes.md")).toBe(true);
    expect(isMarkdownFileName("notes.txt")).toBe(false);
  });
});
