import fs from "node:fs/promises";
import type { FileReader } from "../types.js";

let mammoth: typeof import("mammoth") | null = null;

async function loadMammoth() {
  if (mammoth) return mammoth;
  try {
    mammoth = await import("mammoth");
    return mammoth;
  } catch {
    throw new Error(
      'mammoth is required for .docx support. Install it: pnpm add mammoth',
    );
  }
}

export const docxReader: FileReader = {
  extensions: [".docx"],
  async read(filePath: string) {
    const m = await loadMammoth();
    const buf = await fs.readFile(filePath);
    // mammoth.convertToMarkdown is available in recent versions
    // It preserves headings, lists, and tables which is much better for chunking
    const result = await (m as any).convertToMarkdown({ buffer: buf });
    return {
      content: result.value,
      metadata: { messages: result.messages },
    };
  },
};
