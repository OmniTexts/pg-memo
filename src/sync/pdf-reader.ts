import fs from "node:fs/promises";
import path from "node:path";
import type { FileReader, PgMemoryConfig } from "../types.js";
import { runPythonExtractor } from "../utils/python-bridge.js";
import { uploadImagesToS3 } from "../utils/s3-storage.js";

export const pdfReader: FileReader = {
  extensions: [".pdf"],
  async read(filePath: string, options?: { media?: PgMemoryConfig["media"] }) {
    // 1. Try Python Advanced Extraction first (with media persistence)
    const mediaDir = options?.media?.rootPath || path.join(path.dirname(filePath), "media");
    const baseUrl = options?.media?.baseUrl || "media/";
    
    const advancedResult = await runPythonExtractor(filePath, mediaDir, baseUrl);
    if (advancedResult) {
      // 2. If R2/S3 config is provided, upload newly saved images
      if (options?.media?.s3 && advancedResult.metadata?.saved_images?.length) {
        await uploadImagesToS3(
          mediaDir,
          advancedResult.metadata.saved_images,
          options.media.s3
        );
      }
      return advancedResult;
    }

    // 2. Fallback to basic pdf.js if Python fails or is not available
    console.log("Falling back to basic PDF reader...");
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
      parts.push(`[Page ${i}]\n${text}`);
    }

    return {
      content: parts.join("\n\n"),
      metadata: { pages: doc.numPages, vlm_enhanced: false },
    };
  },
};
