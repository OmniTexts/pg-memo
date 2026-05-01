import type { PgClient } from "../pg-client.js";
import type { MemorySource, SearchRowResult } from "../types.js";

const FTS_QUERY_TOKEN_RE = /[\p{L}\p{N}_]+/gu;

/** Build a tsquery string from raw input: "term1" & "term2" */
export function buildTsQuery(raw: string): string | null {
  const tokens =
    raw
      .match(FTS_QUERY_TOKEN_RE)
      ?.map((t) => t.trim())
      .filter(Boolean) ?? [];
  if (tokens.length === 0) return null;
  return tokens.map((t) => `'${t.replaceAll("'", "''")}'`).join(" & ");
}

/**
 * Convert ts_rank_cd to a [0, 1] score.
 */
export function tsRankToScore(rank: number): number {
  if (!Number.isFinite(rank)) return 1 / (1 + 999);
  if (rank < 0) {
    const relevance = -rank;
    return relevance / (1 + relevance);
  }
  return 1 / (1 + rank);
}

/** Fallback keyword scoring when FTS results are weak */
export function scoreFallbackKeywordResult(params: {
  query: string;
  path: string;
  text: string;
  ftsScore: number;
}): number {
  const queryTokens = [
    ...new Set(
      (params.query.match(FTS_QUERY_TOKEN_RE) ?? []).map((t) => t.toLowerCase()),
    ),
  ];
  if (queryTokens.length === 0) return params.ftsScore;

  const textTokens = (params.text.match(FTS_QUERY_TOKEN_RE) ?? []).map((t) =>
    t.toLowerCase(),
  );
  const textTokenSet = new Set(textTokens);
  const pathLower = params.path.toLowerCase();
  const overlap = queryTokens.filter((t) => textTokenSet.has(t)).length;
  const uniqueQueryOverlap = overlap / Math.max(new Set(queryTokens).size, 1);
  const density = overlap / Math.max(textTokenSet.size, 1);
  const pathBoost = queryTokens.reduce(
    (score, token) => score + (pathLower.includes(token) ? 0.18 : 0),
    0,
  );
  const textLengthBoost = Math.min(params.text.length / 160, 0.18);
  const lexicalBoost = uniqueQueryOverlap * 0.45 + density * 0.2 + pathBoost + textLengthBoost;
  return Math.min(1, params.ftsScore + lexicalBoost);
}

/** Full-text search using PostgreSQL tsvector */
export async function searchKeyword(params: {
  client: PgClient;
  ftsConfig: string;
  providerModel: string | undefined;
  query: string;
  limit: number;
  snippetMaxChars: number;
  sourceFilter: { sql: string; params: string[] };
  boostFallbackRanking?: boolean;
}): Promise<Array<SearchRowResult & { textScore: number }>> {
  if (params.limit <= 0) return [];

  const tsQuery = buildTsQuery(params.query);
  if (!tsQuery) return [];

  // Build query with sequentially numbered placeholders
  const queryParams: unknown[] = [tsQuery]; // $1 = tsquery
  let paramIdx = 2;

  let modelClause = "";
  if (params.providerModel) {
    modelClause = ` AND model = $${paramIdx}`;
    queryParams.push(params.providerModel);
    paramIdx++;
  }

  let sourceSql = "";
  if (params.sourceFilter.params.length > 0) {
    const placeholders = params.sourceFilter.params.map(() => `$${paramIdx++}`).join(", ");
    sourceSql = ` AND source IN (${placeholders})`;
    queryParams.push(...params.sourceFilter.params);
  }

  const limitPlaceholder = `$${paramIdx}`;
  queryParams.push(params.limit);

  const res = await params.client.query(
    `WITH query AS (SELECT to_tsquery('${params.ftsConfig}', $1) AS q)
     SELECT id, path, source, start_line, end_line, text,
            ts_rank_cd(search_vec, query.q) AS rank
       FROM chunks, query
      WHERE search_vec @@ query.q${modelClause}${sourceSql}
      ORDER BY rank ASC
      LIMIT ${limitPlaceholder}`,
    queryParams,
  );

  return (res.rows as Array<{
    id: string;
    path: string;
    source: string;
    start_line: number;
    end_line: number;
    text: string;
    rank: number;
  }>).map((row) => {
    const textScore = tsRankToScore(row.rank);
    const score = params.boostFallbackRanking
      ? scoreFallbackKeywordResult({
          query: params.query,
          path: row.path,
          text: row.text,
          ftsScore: textScore,
        })
      : textScore;
    return {
      id: row.id,
      path: row.path,
      startLine: row.start_line,
      endLine: row.end_line,
      score,
      textScore,
      snippet: truncateUtf16Safe(row.text, params.snippetMaxChars),
      source: row.source as MemorySource,
    };
  });
}

function truncateUtf16Safe(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars);
}
