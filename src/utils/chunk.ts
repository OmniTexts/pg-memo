import crypto from "node:crypto";

export type ChunkConfig = {
  tokens: number;
  overlap: number;
};

const DEFAULT_CHUNK: ChunkConfig = { tokens: 400, overlap: 80 };

/**
 * Simple text chunker. Splits by lines, groups into token-sized chunks.
 * Not a real tokenizer — uses word count as approximation (1 word ≈ 1.3 tokens).
 */
export function chunkText(
  text: string,
  source: string,
  config: ChunkConfig = DEFAULT_CHUNK,
): Array<{
  id: string;
  path: string;
  source: "memory";
  startLine: number;
  endLine: number;
  hash: string;
  text: string;
}> {
  const lines = text.split("\n");
  const chunks: Array<{
    id: string;
    path: string;
    source: "memory";
    startLine: number;
    endLine: number;
    hash: string;
    text: string;
  }> = [];

  // Estimate: ~1.3 tokens per word
  const maxWords = Math.floor(config.tokens / 1.3);
  const overlapWords = Math.floor(config.overlap / 1.3);

  let currentLines: string[] = [];
  let currentWords = 0;
  let startLine = 1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineWords = line.trim().split(/\s+/).filter(Boolean).length;

    if (currentWords + lineWords > maxWords && currentLines.length > 0) {
      // Emit chunk
      const chunkText = currentLines.join("\n");
      const endLine = startLine + currentLines.length - 1;
      chunks.push({
        id: makeChunkId(source, startLine, endLine),
        path: source,
        source: "memory",
        startLine,
        endLine,
        hash: hashText(chunkText),
        text: chunkText,
      });

      // Overlap: keep last N lines
      if (overlapWords > 0) {
        const overlapLines: string[] = [];
        let overlapCount = 0;
        for (let j = currentLines.length - 1; j >= 0; j--) {
          const w = currentLines[j].trim().split(/\s+/).filter(Boolean).length;
          if (overlapCount + w > overlapWords) break;
          overlapLines.unshift(currentLines[j]);
          overlapCount += w;
        }
        startLine = endLine - overlapLines.length + 1;
        currentLines = overlapLines;
        currentWords = overlapCount;
      } else {
        startLine = i + 1;
        currentLines = [];
        currentWords = 0;
      }
    }

    currentLines.push(line);
    currentWords += lineWords;
  }

  // Emit final chunk
  if (currentLines.length > 0) {
    const chunkText = currentLines.join("\n");
    const endLine = startLine + currentLines.length - 1;
    chunks.push({
      id: makeChunkId(source, startLine, endLine),
      path: source,
      source: "memory",
      startLine,
      endLine,
      hash: hashText(chunkText),
      text: chunkText,
    });
  }

  return chunks;
}

function makeChunkId(path: string, startLine: number, endLine: number): string {
  return crypto
    .createHash("sha256")
    .update(`${path}:${startLine}:${endLine}`)
    .digest("hex")
    .slice(0, 24);
}

export function hashText(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}
