import crypto from "node:crypto";

export type ChunkConfig = {
  tokens: number;
  overlap: number;
};

const DEFAULT_CHUNK: ChunkConfig = { tokens: 400, overlap: 80 };

type ChunkResult = {
  id: string;
  path: string;
  source: "memory";
  startLine: number;
  endLine: number;
  hash: string;
  text: string;
};

/**
 * Simple text chunker. Splits by lines, groups into token-sized chunks.
 * Not a real tokenizer — uses word count as approximation (1 word ≈ 1.3 tokens).
 */
export function chunkText(
  text: string,
  source: string,
  config: ChunkConfig = DEFAULT_CHUNK,
): ChunkResult[] {
  const lines = text.split("\n");
  const chunks: ChunkResult[] = [];

  const maxTokens = config.tokens;
  const overlapTokens = config.overlap;

  let currentLines: string[] = [];
  let currentTokens = 0;
  let startLine = 1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineTokens = estimateTokens(line);

    if (currentTokens + lineTokens > maxTokens && currentLines.length > 0) {
      // Emit chunk
      const chunkText = currentLines.join("\n");
      const endLine = startLine + currentLines.length - 1;
      chunks.push(makeChunk(source, startLine, endLine, chunkText));

      // Overlap: keep last N lines
      if (overlapTokens > 0) {
        const overlapLines: string[] = [];
        let overlapCount = 0;
        for (let j = currentLines.length - 1; j >= 0; j--) {
          const t = estimateTokens(currentLines[j]);
          if (overlapCount + t > overlapTokens) break;
          overlapLines.unshift(currentLines[j]);
          overlapCount += t;
        }
        startLine = endLine - overlapLines.length + 1;
        currentLines = overlapLines;
        currentTokens = overlapCount;
      } else {
        startLine = i + 1;
        currentLines = [];
        currentTokens = 0;
      }
    }

    currentLines.push(line);
    currentTokens += lineTokens;
  }

  // Emit final chunk
  if (currentLines.length > 0) {
    const chunkText = currentLines.join("\n");
    const endLine = startLine + currentLines.length - 1;
    chunks.push(makeChunk(source, startLine, endLine, chunkText));
  }

  return chunks;
}

/**
 * Markdown-aware chunker. Splits by headings (# to ######),
 * then subdivides oversized sections by paragraphs.
 * Produces semantically coherent chunks for structured documents.
 */
export function chunkMarkdown(
  text: string,
  source: string,
  config: ChunkConfig = DEFAULT_CHUNK,
): ChunkResult[] {
  const lines = text.split("\n");
  const maxTokens = config.tokens;
  const overlapTokens = config.overlap;

  // Phase 1: split into sections by headings
  interface Section {
    heading: string;
    level: number;
    startLine: number;
    lines: string[];
  }

  const sections: Section[] = [];
  let current: Section = { heading: "", level: 0, startLine: 1, lines: [] };

  for (let i = 0; i < lines.length; i++) {
    const headingMatch = lines[i].match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      if (current.lines.length > 0 || current.heading) {
        sections.push(current);
      }
      current = {
        heading: headingMatch[2],
        level: headingMatch[1].length,
        startLine: i + 1,
        lines: [lines[i]],
      };
    } else {
      current.lines.push(lines[i]);
    }
  }
  if (current.lines.length > 0 || current.heading) {
    sections.push(current);
  }

  // If no headings found, fall back to line-based chunking
  if (sections.length <= 1 && !sections[0]?.heading) {
    return chunkText(text, source, config);
  }

  // Phase 2: convert sections to chunks, splitting oversized ones
  const chunks: ChunkResult[] = [];

  for (const sec of sections) {
    const content = sec.lines.join("\n");
    const tokens = estimateTokens(content);

    if (tokens <= maxTokens) {
      // Section fits in one chunk
      const endLine = sec.startLine + sec.lines.length - 1;
      chunks.push(makeChunk(source, sec.startLine, endLine, content));
    } else {
      // Oversized section: split by blank lines (paragraphs)
      const paragraphs = splitByParagraphs(sec.lines, sec.startLine);
      let paraLines: string[] = [];
      let paraStart = sec.startLine;
      let paraTokens = 0;

      for (const para of paragraphs) {
        const pTokens = estimateTokens(para.text);
        if (paraTokens + pTokens > maxTokens && paraLines.length > 0) {
          const endLine = paraStart + paraLines.length - 1;
          chunks.push(makeChunk(source, paraStart, endLine, paraLines.join("\n")));

          // Overlap
          if (overlapTokens > 0) {
            const overlap = takeOverlapLines(paraLines, overlapTokens);
            paraStart = endLine - overlap.length + 1;
            paraLines = overlap;
            paraTokens = overlap.reduce((s, l) => s + estimateTokens(l), 0);
          } else {
            paraStart = para.startLine;
            paraLines = [];
            paraTokens = 0;
          }
        }
        paraLines.push(...para.lines);
        paraTokens += pTokens;
      }

      if (paraLines.length > 0) {
        const endLine = paraStart + paraLines.length - 1;
        chunks.push(makeChunk(source, paraStart, endLine, paraLines.join("\n")));
      }
    }
  }

  return chunks;
}

interface ParaBlock {
  startLine: number;
  lines: string[];
  text: string;
}

function splitByParagraphs(lines: string[], startLine: number): ParaBlock[] {
  const paras: ParaBlock[] = [];
  let current: string[] = [];
  let currentStart = startLine;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === "") {
      if (current.length > 0) {
        paras.push({
          startLine: currentStart,
          lines: current,
          text: current.join("\n"),
        });
        current = [];
      }
      currentStart = startLine + i + 1;
    } else {
      if (current.length === 0) currentStart = startLine + i;
      current.push(lines[i]);
    }
  }
  if (current.length > 0) {
    paras.push({
      startLine: currentStart,
      lines: current,
      text: current.join("\n"),
    });
  }
  return paras;
}

function takeOverlapLines(lines: string[], maxOverlapTokens: number): string[] {
  const result: string[] = [];
  let count = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    const t = estimateTokens(lines[i]);
    if (count + t > maxOverlapTokens) break;
    result.unshift(lines[i]);
    count += t;
  }
  return result;
}

// Tunable weights for token estimation
const CJK_TOKEN_WEIGHT = 0.6;    // tokens per CJK character
const LATIN_TOKENS_PER_WORD = 1.3; // tokens per whitespace-delimited word

// CJK Unicode ranges: Han, Hiragana, Katakana, Hangul
const CJK_RE = /[\u{4E00}-\u{9FFF}\u{3400}-\u{4DBF}\u{F900}-\u{FAFF}\u{3040}-\u{309F}\u{30A0}-\u{30FF}\u{AC00}-\u{D7AF}]/u;

function isCJK(char: string): boolean {
  return CJK_RE.test(char);
}

/**
 * Estimate token count for a line of text.
 * - CJK characters: CJK_TOKEN_WEIGHT tokens each
 * - Latin/whitespace-delimited words: LATIN_TOKENS_PER_WORD tokens each
 */
function estimateTokens(line: string): number {
  const trimmed = line.trim();
  if (!trimmed) return 0;

  let totalTokens = 0;
  let nonCjkBuffer = "";

  for (const char of trimmed) {
    if (isCJK(char)) {
      if (nonCjkBuffer.length > 0) {
        const words = nonCjkBuffer.trim().split(/\s+/).filter(Boolean);
        totalTokens += words.length * LATIN_TOKENS_PER_WORD;
        nonCjkBuffer = "";
      }
      totalTokens += CJK_TOKEN_WEIGHT;
    } else {
      nonCjkBuffer += char;
    }
  }

  if (nonCjkBuffer.length > 0) {
    const words = nonCjkBuffer.trim().split(/\s+/).filter(Boolean);
    totalTokens += words.length * LATIN_TOKENS_PER_WORD;
  }

  return totalTokens;
}

function makeChunk(
  path: string,
  startLine: number,
  endLine: number,
  text: string | string[],
): ChunkResult {
  const content = Array.isArray(text) ? text.join("\n") : text;
  return {
    id: makeChunkId(path, startLine, endLine),
    path,
    source: "memory",
    startLine,
    endLine,
    hash: hashText(content),
    text: content,
  };
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
