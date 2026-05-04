import fs from "node:fs/promises";
import type { FileReader } from "../types.js";

export const pdfReader: FileReader = {
  extensions: [".pdf"],
  async read(filePath: string) {
    // Use the legacy build for Node.js (no DOM dependencies)
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const buf = await fs.readFile(filePath);
    const data = new Uint8Array(buf);
    const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;

    const parts: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const text = content.items
        .map((item: any) => item.str)
        .join(" ");
      parts.push(text);
    }

    return {
      content: parts.join("\n\n"),
      metadata: { pages: doc.numPages },
    };
  },
};
