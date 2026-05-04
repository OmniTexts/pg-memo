import type { FileReader } from "../types.js";
import { textReader } from "./text-reader.js";
import { pdfReader } from "./pdf-reader.js";
import { docxReader } from "./docx-reader.js";
import { xlsxReader } from "./xlsx-reader.js";

export { textReader } from "./text-reader.js";
export { pdfReader } from "./pdf-reader.js";
export { docxReader } from "./docx-reader.js";
export { xlsxReader } from "./xlsx-reader.js";

/**
 * Build a reader lookup map from a list of FileReader adapters.
 * Returns a Map<extension, FileReader>.
 */
export function buildReaderMap(readers: FileReader[]): Map<string, FileReader> {
  const map = new Map<string, FileReader>();
  // Built-in readers first (lowest priority)
  for (const reader of builtinReaders) {
    for (const ext of reader.extensions) {
      map.set(ext, reader);
    }
  }
  // User-provided readers override built-in
  for (const reader of readers) {
    for (const ext of reader.extensions) {
      map.set(ext, reader);
    }
  }
  return map;
}

/**
 * Get the reader for a given file extension.
 * Returns the text reader as default for .md/.txt, or null if no reader registered.
 */
export function getReader(
  ext: string,
  readerMap: Map<string, FileReader>,
): FileReader | null {
  return readerMap.get(ext.toLowerCase()) ?? null;
}

/** Default supported extensions when none configured */
export const DEFAULT_EXTENSIONS = [".md"];

/** All built-in readers (for auto-registration) */
export const builtinReaders: FileReader[] = [
  textReader,
  pdfReader,
  docxReader,
  xlsxReader,
];
