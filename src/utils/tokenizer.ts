import { Segment, useDefault } from "segmentit";

const segment = new Segment();
useDefault(segment);

/**
 * Tokenize mixed Chinese/English text for FTS.
 * Chinese words are segmented with segmentit, English words pass through.
 * Result is space-separated — suitable for PostgreSQL 'simple' tsvector config.
 */
export function tokenizeForFts(text: string): string {
  // segmentit returns objects like { w: 'word', p: number }
  const tokens = segment.doSegment(text, { simple: true });
  return tokens.join(" ");
}
