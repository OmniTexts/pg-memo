import type { PgClient } from "../pg-client.js";
import type { MemorySource, SearchRowResult } from "../types.js";

const VECTOR_KNN_OVERSAMPLE_FACTOR = 8;

/** Search using pgvector cosine distance */
export async function searchVector(params: {
  client: PgClient;
  providerModel: string;
  queryVec: number[];
  limit: number;
  snippetMaxChars: number;
  sourceFilter: { sql: string; params: string[] };
}): Promise<SearchRowResult[]> {
  if (params.queryVec.length === 0 || params.limit <= 0) {
    return [];
  }

  const vecLiteral = `[${params.queryVec.join(",")}]`;
  const candidateLimit = params.limit * VECTOR_KNN_OVERSAMPLE_FACTOR;

  // Build query with sequentially numbered placeholders
  const queryParams: unknown[] = [vecLiteral]; // $1 = vector
  let paramIdx = 2;

  const modelClause = ` AND c.model = $${paramIdx}`;
  queryParams.push(params.providerModel);
  paramIdx++;

  let sourceSql = "";
  if (params.sourceFilter.params.length > 0) {
    const placeholders = params.sourceFilter.params.map(() => `$${paramIdx++}`).join(", ");
    sourceSql = ` AND c.source IN (${placeholders})`;
    queryParams.push(...params.sourceFilter.params);
  }

  const limitPlaceholder = `$${paramIdx}`;
  queryParams.push(candidateLimit);

  const res = await params.client.query(
    `SELECT c.id, c.path, c.start_line, c.end_line, c.text,
            c.source,
            (v.embedding <=> $1::vector) AS dist
       FROM chunks_vec v
       JOIN chunks c ON c.id = v.id
      WHERE 1=1${modelClause}${sourceSql}
      ORDER BY v.embedding <=> $1::vector
      LIMIT ${limitPlaceholder}`,
    queryParams,
  );

  const rows = res.rows as Array<{
    id: string;
    path: string;
    start_line: number;
    end_line: number;
    text: string;
    source: string;
    dist: number;
  }>;

  // If we got fewer results than requested, expand to full vector count
  let finalRows = rows;
  if (rows.length < params.limit) {
    // Count query: only model and source params
    const countParams: unknown[] = [params.providerModel];
    let countIdx = 2;
    let countSourceSql = "";
    if (params.sourceFilter.params.length > 0) {
      const placeholders = params.sourceFilter.params.map(() => `$${countIdx++}`).join(", ");
      countSourceSql = ` AND source IN (${placeholders})`;
      countParams.push(...params.sourceFilter.params);
    }
    const countRes = await params.client.query(
      `SELECT COUNT(*)::int AS c FROM chunks c WHERE model = $1${countSourceSql}`,
      countParams,
    );
    const matchingChunks = Number(countRes.rows[0]?.c ?? 0);
    if (matchingChunks > rows.length) {
      // Full scan query — reuse same placeholder structure but without LIMIT
      const fullParams: unknown[] = [vecLiteral, params.providerModel];
      let fullIdx = 3;
      let fullSourceSql = "";
      if (params.sourceFilter.params.length > 0) {
        const placeholders = params.sourceFilter.params.map(() => `$${fullIdx++}`).join(", ");
        fullSourceSql = ` AND c.source IN (${placeholders})`;
        fullParams.push(...params.sourceFilter.params);
      }
      const fullRes = await params.client.query(
        `SELECT c.id, c.path, c.start_line, c.end_line, c.text,
                c.source,
                (v.embedding <=> $1::vector) AS dist
           FROM chunks_vec v
           JOIN chunks c ON c.id = v.id
          WHERE c.model = $2${fullSourceSql}
          ORDER BY v.embedding <=> $1::vector`,
        fullParams,
      );
      finalRows = fullRes.rows;
    }
  }

  return finalRows.slice(0, params.limit).map((row) => ({
    id: row.id,
    path: row.path,
    startLine: row.start_line,
    endLine: row.end_line,
    score: 1 - row.dist,
    snippet: truncateUtf16Safe(row.text, params.snippetMaxChars),
    source: row.source as MemorySource,
  }));
}

function truncateUtf16Safe(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars);
}
