import type { PgClient } from "./pg-client.js";
import { quoteIdent } from "./pg-client.js";
import { DEFAULT_VECTOR_DIMS } from "./types.js";

/**
 * Ensure the memory index schema exists in the current search_path schema.
 * Equivalent to openclaw's ensureMemoryIndexSchema() but for PostgreSQL.
 */
export async function ensureMemoryIndexSchema(
  client: PgClient,
  options: {
    vectorDims?: number;
    ftsConfig?: string;
    cacheEnabled?: boolean;
    vectorEnabled?: boolean;
    ftsEnabled?: boolean;
  } = {},
): Promise<{ ftsAvailable: boolean; vectorAvailable: boolean }> {
  const dims = options.vectorDims ?? DEFAULT_VECTOR_DIMS;
  const ftsConfig = options.ftsConfig ?? "english";
  const cacheEnabled = options.cacheEnabled ?? true;
  const vectorEnabled = options.vectorEnabled ?? true;
  const ftsEnabled = options.ftsEnabled ?? true;

  // --- Core tables ---

  await client.query(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS files (
      path TEXT PRIMARY KEY,
      source TEXT NOT NULL DEFAULT 'memory',
      hash TEXT NOT NULL,
      mtime BIGINT NOT NULL,
      size BIGINT NOT NULL
    );
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS chunks (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'memory',
      start_line INTEGER NOT NULL,
      end_line INTEGER NOT NULL,
      hash TEXT NOT NULL,
      model TEXT NOT NULL,
      text TEXT NOT NULL,
      embedding JSONB NOT NULL DEFAULT '[]',
      updated_at BIGINT NOT NULL DEFAULT 0
    );
  `);

  // Ensure columns exist (migration-safe)
  await ensureColumn(client, "files", "source", "TEXT NOT NULL DEFAULT 'memory'");
  await ensureColumn(client, "chunks", "source", "TEXT NOT NULL DEFAULT 'memory'");

  // --- Embedding cache ---

  if (cacheEnabled) {
    await client.query(`
      CREATE TABLE IF NOT EXISTS embedding_cache (
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        provider_key TEXT NOT NULL,
        hash TEXT NOT NULL,
        embedding TEXT NOT NULL,
        dims INTEGER,
        updated_at BIGINT NOT NULL,
        PRIMARY KEY (provider, model, provider_key, hash)
      );
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_embedding_cache_updated_at
        ON embedding_cache(updated_at);
    `);
  }

  // --- Vector table (pgvector) ---

  let vectorAvailable = false;
  if (vectorEnabled) {
    try {
      await client.query("CREATE EXTENSION IF NOT EXISTS vector;");

      // Chunks with vector embeddings — separate table because pgvector
      // requires a typed column, and we want to keep chunks lightweight.
      await client.query(`
        CREATE TABLE IF NOT EXISTS chunks_vec (
          id TEXT PRIMARY KEY REFERENCES chunks(id) ON DELETE CASCADE,
          embedding vector(${dims})
        );
      `);

      vectorAvailable = true;
    } catch (err) {
      console.warn("pgvector table creation failed:", err);
    }

    // HNSW index is optional — pgvector 0.8.0 limits to 2000 dims.
    // If it fails, brute-force search still works (just slower).
    if (vectorAvailable) {
      try {
        await client.query(`
          CREATE INDEX IF NOT EXISTS idx_chunks_vec_embedding
            ON chunks_vec USING hnsw (embedding vector_cosine_ops);
        `);
      } catch (err) {
        console.warn(
          `HNSW index skipped (dims=${dims} may exceed 2000 limit, fallback to brute-force):`,
          (err as Error).message,
        );
      }
    }
  }

  // --- Full-text search (tsvector) ---

  let ftsAvailable = false;
  if (ftsEnabled) {
    try {
      // pg_trgm for trigram-based search (replaces SQLite FTS5 trigram tokenizer)
      await client.query("CREATE EXTENSION IF NOT EXISTS pg_trgm;");

      // Add tsvector column
      await client.query(`
        ALTER TABLE chunks
          ADD COLUMN IF NOT EXISTS search_vec tsvector;
      `);

      // Populate search_vec for existing rows
      await client.query(`
        UPDATE chunks SET search_vec = to_tsvector('${ftsConfig}', coalesce(text, ''))
        WHERE search_vec IS NULL;
      `);

      // GIN index on tsvector
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_chunks_search_vec
          ON chunks USING GIN(search_vec);
      `);

      // GIN trigram index on text for fallback substring search
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_chunks_text_trgm
          ON chunks USING GIN(text gin_trgm_ops);
      `);

      ftsAvailable = true;
    } catch (err) {
      console.warn("FTS unavailable:", err);
    }
  }

  // --- Standard indexes ---

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_chunks_path ON chunks(path);
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_chunks_source ON chunks(source);
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_chunks_model ON chunks(model);
  `);

  return { ftsAvailable, vectorAvailable };
}

/** Trigger to auto-update search_vec on INSERT/UPDATE */
export async function ensureFtsTrigger(
  client: PgClient,
  ftsConfig: string,
  schema: string,
): Promise<void> {
  const funcName = quoteIdent(schema) + ".chunks_search_vec_update";
  const triggerName = "trg_chunks_search_vec";

  await client.query(`
    CREATE OR REPLACE FUNCTION ${funcName}() RETURNS trigger AS $$
    BEGIN
      NEW.search_vec := to_tsvector('${ftsConfig}', coalesce(NEW.text, ''));
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  // Drop existing trigger in this schema (if any) to avoid cross-schema collision
  await client.query(`
    DO $$ BEGIN
      IF EXISTS (
        SELECT 1 FROM pg_trigger t
        JOIN pg_class c ON t.tgrelid = c.oid
        JOIN pg_namespace n ON c.relnamespace = n.oid
        WHERE t.tgname = '${triggerName}' AND n.nspname = '${schema}'
      ) THEN
        EXECUTE 'DROP TRIGGER ${triggerName} ON ${quoteIdent(schema)}.chunks';
      END IF;
    END $$;
  `);

  await client.query(`
    CREATE TRIGGER ${quoteIdent(triggerName)}
      BEFORE INSERT OR UPDATE OF text ON ${quoteIdent(schema)}.chunks
      FOR EACH ROW
      EXECUTE FUNCTION ${funcName}();
  `);
}

async function ensureColumn(
  client: PgClient,
  table: string,
  column: string,
  definition: string,
): Promise<void> {
  const res = await client.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = $1 AND column_name = $2
  `, [table, column]);

  if (res.rows.length === 0) {
    await client.query(`ALTER TABLE ${quoteIdent(table)} ADD COLUMN ${quoteIdent(column)} ${definition}`);
  }
}

/** Drop all tables in the schema (for atomic reindex) */
export async function dropMemorySchema(client: PgClient): Promise<void> {
  await client.query("DROP TABLE IF EXISTS chunks_vec CASCADE");
  await client.query("DROP TABLE IF EXISTS embedding_cache CASCADE");
  await client.query("DROP TABLE IF EXISTS chunks CASCADE");
  await client.query("DROP TABLE IF EXISTS files CASCADE");
  await client.query("DROP TABLE IF EXISTS meta CASCADE");
}
