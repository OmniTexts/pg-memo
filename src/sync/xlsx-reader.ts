import fs from "node:fs/promises";
import type { FileReader } from "../types.js";

let XLSX: typeof import("xlsx") | null = null;

async function loadXlsx() {
  if (XLSX) return XLSX;
  try {
    XLSX = await import("xlsx");
    return XLSX;
  } catch {
    throw new Error(
      'xlsx is required for .xlsx support. Install it: pnpm add xlsx',
    );
  }
}

export const xlsxReader: FileReader = {
  extensions: [".xlsx"],
  async read(filePath: string) {
    const x = await loadXlsx();
    const buf = await fs.readFile(filePath);
    const wb = x.read(buf, { type: "buffer" });
    const parts: string[] = [];

    for (const sheetName of wb.SheetNames) {
      const sheet = wb.Sheets[sheetName];
      const rows: string[][] = x.utils.sheet_to_json(sheet, { header: 1, defval: "" });
      if (rows.length === 0) continue;

      parts.push(`## ${sheetName}\n`);

      // First row as header
      const header = rows[0].map(String);
      if (header.some((c) => c.trim())) {
        parts.push("| " + header.join(" | ") + " |");
        parts.push("| " + header.map(() => "---").join(" | ") + " |");
        for (let i = 1; i < rows.length; i++) {
          parts.push("| " + rows[i].map((c) => String(c)).join(" | ") + " |");
        }
        parts.push("");
      }
    }

    return {
      content: parts.join("\n"),
      metadata: { sheets: wb.SheetNames.length },
    };
  },
};
