import crypto from "node:crypto";

export type ChunkConfig = {
  tokens: number;
  overlap: number;
};

export type ChunkResult = {
  text: string;
  startLine: number;
  endLine: number;
};

/**
 * Split text into overlapping chunks.
 */
export function chunkText(text: string, config: ChunkConfig): ChunkResult[] {
  const words = text.split(/\s+/);
  const results: ChunkResult[] = [];
  
  for (let i = 0; i < words.length; i += config.tokens - config.overlap) {
    const chunkWords = words.slice(i, i + config.tokens);
    const chunkText = chunkWords.join(" ");
    
    // Approximate lines
    const startLine = text.substring(0, text.indexOf(chunkText)).split("\n").length;
    const endLine = startLine + chunkText.split("\n").length - 1;

    results.push({
      text: chunkText,
      startLine,
      endLine,
    });
    
    if (i + config.tokens >= words.length) break;
  }
  
  return results;
}

/**
 * Split markdown into sections by headers, then chunk within sections.
 */
export function chunkMarkdown(text: string, config: ChunkConfig): ChunkResult[] {
  // Simplified header-based chunking
  const sections = text.split(/(?=^#{1,6}\s+)/m);
  const results: ChunkResult[] = [];
  
  for (const section of sections) {
    if (section.length < config.tokens * 4) {
      const lines = section.split("\n");
      results.push({
        text: section,
        startLine: 1, // simplified
        endLine: lines.length
      });
    } else {
      results.push(...chunkText(section, config));
    }
  }
  
  return results;
}

/** Helper: generate a unique chunk ID */
export function makeChunkId(path: string, startLine: number, endLine: number): string {
  return crypto
    .createHash("sha256")
    .update(`${path}:${startLine}:${endLine}`)
    .digest("hex")
    .slice(0, 24);
}

/** Helper: hash text content */
export function hashText(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}
