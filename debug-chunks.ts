import { readFileEntry } from "./src/utils/file-reader.js";
import path from "node:path";

async function debug() {
  const filePath = "/Users/jack/workspace/study/ai/agents/pg-memo-test/workspace/Yijing1+2.pdf";
  const workspaceDir = "/Users/jack/workspace/study/ai/agents/pg-memo-test/workspace";
  
  console.log("Reading file...");
  const entry = await readFileEntry(filePath, workspaceDir, { tokens: 400, overlap: 80 });
  
  if (!entry) {
    console.error("Failed to read file");
    return;
  }

  console.log(`Total chunks: ${entry.chunks.length}`);
  
  const idMap = new Map();
  const duplicates = [];

  for (const [i, chunk] of entry.chunks.entries()) {
    if (idMap.has(chunk.id)) {
      duplicates.push({
        id: chunk.id,
        firstIndex: idMap.get(chunk.id),
        secondIndex: i,
        range: `${chunk.startLine}-${chunk.endLine}`,
        text: chunk.text.slice(0, 50) + "..."
      });
    } else {
      idMap.set(chunk.id, i);
    }
  }

  if (duplicates.length > 0) {
    console.error("Found duplicate IDs!");
    console.error(JSON.stringify(duplicates, null, 2));
  } else {
    console.log("No duplicate IDs found.");
  }
}

debug().catch(console.error);
