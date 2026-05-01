import { applyMMR, type MMRConfig, DEFAULT_MMR_CONFIG } from "./mmr.js";
import {
  applyTemporalDecay,
  type TemporalDecayConfig,
  DEFAULT_TEMPORAL_DECAY_CONFIG,
} from "./temporal-decay.js";
import type { MemorySource } from "../types.js";

export type HybridResult = {
  path: string;
  startLine: number;
  endLine: number;
  source: MemorySource;
  snippet: string;
  vectorScore: number;
  textScore: number;
};

export { type MMRConfig, DEFAULT_MMR_CONFIG };
export { type TemporalDecayConfig, DEFAULT_TEMPORAL_DECAY_CONFIG };

/**
 * Merge vector and keyword results with weighted scoring, MMR, and temporal decay.
 * Compatible with openclaw's mergeHybridResults.
 */
export function mergeHybridResults(params: {
  vector: Array<{
    id: string;
    path: string;
    startLine: number;
    endLine: number;
    source: MemorySource;
    snippet: string;
    score: number;
  }>;
  keyword: Array<{
    id: string;
    path: string;
    startLine: number;
    endLine: number;
    source: MemorySource;
    snippet: string;
    score: number;
    textScore: number;
  }>;
  vectorWeight: number;
  textWeight: number;
  mmr?: Partial<MMRConfig>;
  temporalDecay?: Partial<TemporalDecayConfig>;
  fileMtimes?: Map<string, number>;
  nowMs?: number;
}): Array<{
  path: string;
  startLine: number;
  endLine: number;
  score: number;
  vectorScore: number;
  textScore: number;
  snippet: string;
  source: MemorySource;
}> {
  const byId = new Map<
    string,
    {
      id: string;
      path: string;
      startLine: number;
      endLine: number;
      source: MemorySource;
      snippet: string;
      vectorScore: number;
      textScore: number;
    }
  >();

  for (const r of params.vector) {
    byId.set(r.id, {
      id: r.id,
      path: r.path,
      startLine: r.startLine,
      endLine: r.endLine,
      source: r.source,
      snippet: r.snippet,
      vectorScore: r.score,
      textScore: 0,
    });
  }

  for (const r of params.keyword) {
    const existing = byId.get(r.id);
    if (existing) {
      existing.textScore = r.textScore;
      if (r.snippet && r.snippet.length > 0) existing.snippet = r.snippet;
    } else {
      byId.set(r.id, {
        id: r.id,
        path: r.path,
        startLine: r.startLine,
        endLine: r.endLine,
        source: r.source,
        snippet: r.snippet,
        vectorScore: 0,
        textScore: r.textScore,
      });
    }
  }

  const merged = Array.from(byId.values()).map((e) => ({
    path: e.path,
    startLine: e.startLine,
    endLine: e.endLine,
    score: params.vectorWeight * e.vectorScore + params.textWeight * e.textScore,
    vectorScore: e.vectorScore,
    textScore: e.textScore,
    snippet: e.snippet,
    source: e.source,
  }));

  // Temporal decay
  const decayConfig = { ...DEFAULT_TEMPORAL_DECAY_CONFIG, ...params.temporalDecay };
  const decayed = applyTemporalDecay({
    results: merged,
    temporalDecay: decayConfig,
    fileMtimes: params.fileMtimes,
    nowMs: params.nowMs,
  });

  const sorted = decayed.toSorted((a, b) => b.score - a.score);

  // MMR re-ranking
  const mmrConfig = { ...DEFAULT_MMR_CONFIG, ...params.mmr };
  if (mmrConfig.enabled) {
    return applyMMR(sorted, mmrConfig);
  }

  return sorted;
}
