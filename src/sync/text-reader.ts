import fs from "node:fs/promises";
import type { FileReader } from "../types.js";

export const textReader: FileReader = {
  extensions: [".md", ".txt"],
  async read(filePath: string) {
    const content = await fs.readFile(filePath, "utf-8");
    return { content };
  },
};
