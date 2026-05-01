/**
 * Maximal Marginal Relevance (MMR) re-ranking.
 * Direct port from openclaw's mmr.ts for API compatibility.
 *
 * MMR balances relevance with diversity:
 *   λ * relevance - (1-λ) * max_similarity_to_selected
 */

const CJK_RE = /[぀-ゟ゠-ヿ㐀-䶿一-鿿가-힯ᄀ-ᇿ]/;

export type MMRConfig = {
  enabled: boolean;
  lambda: number;
};

export const DEFAULT_MMR_CONFIG: MMRConfig = {
  enabled: false,
  lambda: 0.7,
};

type MMRItem = {
  id: string;
  score: number;
  content: string;
};

function tokenize(text: string): Set<string> {
  const lower = text.toLowerCase();
  const ascii = lower.match(/[a-z0-9_]+/g) ?? [];
  const chars = Array.from(lower);
  const cjkData: { char: string; index: number }[] = [];
  for (let i = 0; i < chars.length; i++) {
    if (CJK_RE.test(chars[i])) cjkData.push({ char: chars[i], index: i });
  }
  const bigrams: string[] = [];
  for (let i = 0; i < cjkData.length - 1; i++) {
    if (cjkData[i + 1].index === cjkData[i].index + 1) {
      bigrams.push(cjkData[i].char + cjkData[i + 1].char);
    }
  }
  const unigrams = cjkData.map((d) => d.char);
  return new Set([...ascii, ...bigrams, ...unigrams]);
}

function jaccardSimilarity(setA: Set<string>, setB: Set<string>): number {
  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  const smaller = setA.size <= setB.size ? setA : setB;
  const larger = setA.size <= setB.size ? setB : setA;
  for (const t of smaller) if (larger.has(t)) intersection++;
  return intersection / (setA.size + setB.size - intersection);
}

function maxSimilarity(
  item: MMRItem,
  selected: MMRItem[],
  cache: Map<string, Set<string>>,
): number {
  if (selected.length === 0) return 0;
  const itemTokens = cache.get(item.id) ?? tokenize(item.content);
  let maxSim = 0;
  for (const s of selected) {
    const sTokens = cache.get(s.id) ?? tokenize(s.content);
    const sim = jaccardSimilarity(itemTokens, sTokens);
    if (sim > maxSim) maxSim = sim;
  }
  return maxSim;
}

/**
 * Re-rank results using MMR. Compatible with openclaw's applyMMRToHybridResults.
 */
export function applyMMR<
  T extends { score: number; snippet: string; path: string; startLine: number },
>(results: T[], config: Partial<MMRConfig> = {}): T[] {
  const { enabled = false, lambda = 0.7 } = config;
  if (!enabled || results.length <= 1) return [...results];

  const clamped = Math.max(0, Math.min(1, lambda));
  if (clamped === 1) return [...results].toSorted((a, b) => b.score - a.score);

  const tokenCache = new Map<string, Set<string>>();
  const itemById = new Map<string, T>();
  const items: MMRItem[] = results.map((r, i) => {
    const id = `${r.path}:${r.startLine}:${i}`;
    itemById.set(id, r);
    tokenCache.set(id, tokenize(r.snippet));
    return { id, score: r.score, content: r.snippet };
  });

  const maxScore = Math.max(...items.map((i) => i.score));
  const minScore = Math.min(...items.map((i) => i.score));
  const range = maxScore - minScore;
  const norm = (s: number) => (range === 0 ? 1 : (s - minScore) / range);

  const selected: MMRItem[] = [];
  const remaining = new Set(items);

  while (remaining.size > 0) {
    let best: MMRItem | null = null;
    let bestScore = -Infinity;
    for (const c of remaining) {
      const relevance = norm(c.score);
      const sim = maxSimilarity(c, selected, tokenCache);
      const mmrScore = clamped * relevance - (1 - clamped) * sim;
      if (mmrScore > bestScore || (mmrScore === bestScore && c.score > (best?.score ?? -Infinity))) {
        bestScore = mmrScore;
        best = c;
      }
    }
    if (!best) break;
    selected.push(best);
    remaining.delete(best);
  }

  return selected.map((item) => itemById.get(item.id)!);
}
