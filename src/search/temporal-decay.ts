/**
 * Temporal decay for search results.
 * Direct port from openclaw's temporal-decay.ts.
 */

export type TemporalDecayConfig = {
  enabled: boolean;
  halfLifeDays: number;
};

export const DEFAULT_TEMPORAL_DECAY_CONFIG: TemporalDecayConfig = {
  enabled: false,
  halfLifeDays: 30,
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function calculateDecayMultiplier(ageInDays: number, halfLifeDays: number): number {
  if (!Number.isFinite(halfLifeDays) || halfLifeDays <= 0) return 1;
  const lambda = Math.LN2 / halfLifeDays;
  const age = Math.max(0, ageInDays);
  if (!Number.isFinite(age)) return 1;
  return Math.exp(-lambda * age);
}

/**
 * Apply temporal decay to results using file mtime.
 * In pg-memo, we store mtime in the files table so no fs.stat is needed.
 */
export function applyTemporalDecay<
  T extends { path: string; score: number },
>(params: {
  results: T[];
  temporalDecay?: Partial<TemporalDecayConfig>;
  fileMtimes?: Map<string, number>;
  nowMs?: number;
}): T[] {
  const config = { ...DEFAULT_TEMPORAL_DECAY_CONFIG, ...params.temporalDecay };
  if (!config.enabled) return [...params.results];

  const nowMs = params.nowMs ?? Date.now();

  return params.results.map((entry) => {
    const mtime = params.fileMtimes?.get(entry.path);
    if (!mtime) return entry;
    const ageDays = Math.max(0, nowMs - mtime) / DAY_MS;
    const decayed = entry.score * calculateDecayMultiplier(ageDays, config.halfLifeDays);
    return { ...entry, score: decayed };
  });
}
