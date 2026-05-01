import type { PgClient } from "../pg-client.js";

type EmbeddingProviderRef = {
  id: string;
  model: string;
};

/** Load cached embeddings by hash */
export async function loadEmbeddingCache(params: {
  client: PgClient;
  enabled: boolean;
  provider: EmbeddingProviderRef | null;
  providerKey: string | null;
  hashes: string[];
}): Promise<Map<string, number[]>> {
  if (!params.enabled || !params.provider || !params.providerKey || params.hashes.length === 0) {
    return new Map();
  }

  const unique: string[] = [];
  const seen = new Set<string>();
  for (const hash of params.hashes) {
    if (!hash || seen.has(hash)) continue;
    seen.add(hash);
    unique.push(hash);
  }
  if (unique.length === 0) return new Map();

  const out = new Map<string, number[]>();
  const batchSize = 400;

  for (let start = 0; start < unique.length; start += batchSize) {
    const batch = unique.slice(start, start + batchSize);
    const placeholders = batch.map((_, i) => `$${i + 4}`).join(", ");
    const res = await params.client.query(
      `SELECT hash, embedding FROM embedding_cache
        WHERE provider = $1 AND model = $2 AND provider_key = $3
          AND hash IN (${placeholders})`,
      [params.provider.id, params.provider.model, params.providerKey, ...batch],
    );
    for (const row of res.rows as Array<{ hash: string; embedding: string }>) {
      try {
        out.set(row.hash, JSON.parse(row.embedding));
      } catch {}
    }
  }
  return out;
}

/** Upsert embeddings into cache */
export async function upsertEmbeddingCache(params: {
  client: PgClient;
  enabled: boolean;
  provider: EmbeddingProviderRef | null;
  providerKey: string | null;
  entries: Array<{ hash: string; embedding: number[] }>;
  now?: number;
}): Promise<void> {
  if (!params.enabled || !params.provider || !params.providerKey || params.entries.length === 0) {
    return;
  }

  const now = params.now ?? Date.now();

  for (const entry of params.entries) {
    const embedding = entry.embedding ?? [];
    await params.client.query(
      `INSERT INTO embedding_cache (provider, model, provider_key, hash, embedding, dims, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (provider, model, provider_key, hash) DO UPDATE SET
         embedding = EXCLUDED.embedding,
         dims = EXCLUDED.dims,
         updated_at = EXCLUDED.updated_at`,
      [
        params.provider.id,
        params.provider.model,
        params.providerKey,
        entry.hash,
        JSON.stringify(embedding),
        embedding.length,
        now,
      ],
    );
  }
}

/** Match cached embeddings to chunks, returning hits and missing indices */
export function collectCachedEmbeddings<T extends { hash: string }>(params: {
  chunks: T[];
  cached: Map<string, number[]>;
}): {
  embeddings: number[][];
  missing: Array<{ index: number; chunk: T }>;
} {
  const embeddings: number[][] = Array.from({ length: params.chunks.length }, () => []);
  const missing: Array<{ index: number; chunk: T }> = [];

  for (let i = 0; i < params.chunks.length; i++) {
    const chunk = params.chunks[i];
    const hit = chunk?.hash ? params.cached.get(chunk.hash) : undefined;
    if (hit && hit.length > 0) {
      embeddings[i] = hit;
    } else if (chunk) {
      missing.push({ index: i, chunk });
    }
  }
  return { embeddings, missing };
}
