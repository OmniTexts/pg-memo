import crypto from "node:crypto";
import type {
  PgMemorySearchManager,
  MemorySearchResult,
  MemoryProviderStatus,
  MemoryEmbeddingProbeResult,
  MemorySyncProgressUpdate,
  MemorySource,
  EmbeddingProvider,
  PgMemoryConfig,
  FileEntry,
  ChunkEntry,
  ChunkConfig,
  SearchRowResult,
} from "./types.js";
import { DEFAULT_VECTOR_DIMS } from "./types.js";
import { createPgPool, acquireWithSchema, type PgPool, type PgClient } from "./pg-client.js";
import { ensureMemoryIndexSchema, ensureFtsTrigger, dropMemorySchema } from "./schema.js";
import { searchVector } from "./search/vector.js";
import { searchKeyword } from "./search/keyword.js";
import { tokenizeForFts } from "./utils/tokenizer.js";
import { mergeHybridResults } from "./search/hybrid.js";
import {
  loadEmbeddingCache,
  upsertEmbeddingCache,
  collectCachedEmbeddings,
} from "./store/embedding-cache.js";
import { FileWatcher } from "./watch/file-watcher.js";
import { scanWorkspace } from "./utils/file-reader.js";

const SNIPPET_MAX_CHARS = 700;
const META_KEY = "memory_index_meta_v1";

type MemoryIndexMeta = {
  model: string;
  provider: string;
  providerKey: string;
  sources: MemorySource[];
  vectorDims?: number;
  chunkTokens: number;
  chunkOverlap: number;
};

export class PgMemoryManager implements PgMemorySearchManager {
  private pool: PgPool | null = null;
  private readonly config: Required<
    Pick<PgMemoryConfig, "connectionString" | "schema">
  > &
    PgMemoryConfig;
  private readonly ftsConfig: string;
  private readonly vectorDims: number;
  private readonly hybridEnabled: boolean;
  private readonly vectorEnabled: boolean;
  private readonly sources: Set<MemorySource>;
  private readonly queryConfig: {
    maxResults: number;
    minScore: number;
    vectorWeight: number;
    textWeight: number;
    candidateMultiplier: number;
    mmr: { enabled: boolean; lambda: number };
    temporalDecay: { enabled: boolean; halfLifeDays: number };
  };

  private ftsAvailable = false;
  private vectorAvailable = false;
  private schemaReady = false;
  private closed = false;
  private dirty = true;
  private syncing: Promise<void> | null = null;

  private embeddingProvider: EmbeddingProvider | null;
  private providerKey: string | null = null;
  private watcher: FileWatcher | null = null;
  private readonly chunkConfig: ChunkConfig;

  constructor(config: PgMemoryConfig) {
    this.config = { ...config };
    this.embeddingProvider = config.embeddingProvider ?? null;
    this.ftsConfig = config.ftsConfig ?? "simple";
    this.vectorDims = config.vectorDims ?? DEFAULT_VECTOR_DIMS;
    this.vectorEnabled = config.vectorEnabled !== false;
    this.hybridEnabled = config.hybridEnabled !== false;
    this.sources = new Set(config.sources ?? ["memory"]);
    this.chunkConfig = config.chunking ?? { tokens: 400, overlap: 80 };

    const q = config.query ?? {};
    this.queryConfig = {
      maxResults: q.maxResults ?? 6,
      minScore: q.minScore ?? 0.35,
      vectorWeight: q.vectorWeight ?? 0.7,
      textWeight: q.textWeight ?? 0.3,
      candidateMultiplier: q.candidateMultiplier ?? 4,
      mmr: {
        enabled: q.mmr?.enabled ?? false,
        lambda: q.mmr?.lambda ?? 0.7,
      },
      temporalDecay: {
        enabled: q.temporalDecay?.enabled ?? false,
        halfLifeDays: q.temporalDecay?.halfLifeDays ?? 30,
      },
    };
  }

  /** Lazy init: connect pool and ensure schema */
  private async ensureReady(): Promise<void> {
    if (this.schemaReady) return;
    this.pool = await createPgPool(this.config);
    const client = await acquireWithSchema(this.pool, this.config.schema);
    try {
      const result = await ensureMemoryIndexSchema(client, {
        vectorDims: this.vectorDims,
        ftsConfig: this.ftsConfig,
        cacheEnabled: true,
        vectorEnabled: this.vectorEnabled,
        ftsEnabled: this.hybridEnabled,
      });
      this.vectorAvailable = result.vectorAvailable;
      this.ftsAvailable = result.ftsAvailable;
      if (this.ftsAvailable) {
        await ensureFtsTrigger(client, this.ftsConfig, this.config.schema);
      }
      this.schemaReady = true;
    } finally {
      client.release();
    }
  }

  /** Acquire a client with the correct schema */
  private async client(): Promise<PgClient> {
    await this.ensureReady();
    return acquireWithSchema(this.pool!, this.config.schema);
  }

  private computeProviderKey(): string {
    if (!this.embeddingProvider) return "";
    return `${this.embeddingProvider.id}:${this.embeddingProvider.model}`;
  }

  private async ensureProviderInitialized(): Promise<void> {
    this.providerKey = this.computeProviderKey();
  }

  // ─────────────────── search ───────────────────

  async search(
    query: string,
    opts?: {
      maxResults?: number;
      minScore?: number;
      sessionKey?: string;
      sources?: MemorySource[];
    },
  ): Promise<MemorySearchResult[]> {
    await this.ensureReady();
    await this.ensureProviderInitialized();

    const client = await this.client();
    try {
      const minScore = opts?.minScore ?? this.queryConfig.minScore;
      const maxResults = opts?.maxResults ?? this.queryConfig.maxResults;
      const candidates = Math.min(
        200,
        Math.max(1, Math.floor(maxResults * this.queryConfig.candidateMultiplier)),
      );

      const searchSources =
        opts?.sources && opts.sources.length > 0
          ? [...new Set(opts.sources)].filter((s) => this.sources.has(s))
          : [...this.sources];

      if (opts?.sources && opts.sources.length > 0 && searchSources.length === 0) {
        return [];
      }

      const sourceFilter = this.buildSourceFilter(searchSources);

      // Check if there's indexed content
      const hasContent = await this.hasIndexedContent(client);
      if (!hasContent) return [];

      // FTS-only mode
      if (!this.embeddingProvider) {
        if (!this.hybridEnabled || !this.ftsAvailable) return [];
        const keywordResults = await searchKeyword({
          client,
          ftsConfig: this.ftsConfig,
          providerModel: undefined,
          query,
          limit: candidates,
          snippetMaxChars: SNIPPET_MAX_CHARS,
          sourceFilter,
          boostFallbackRanking: true,
        });
        const sorted = keywordResults.toSorted((a, b) => b.score - a.score);
        return sorted
          .filter((e) => e.score >= minScore)
          .slice(0, maxResults)
          .map(({ textScore, ...r }) => r);
      }

      // Hybrid: vector + keyword
      const keywordResults =
        this.hybridEnabled && this.ftsAvailable
          ? await searchKeyword({
              client,
              ftsConfig: this.ftsConfig,
              providerModel: this.embeddingProvider.model,
              query,
              limit: candidates,
              snippetMaxChars: SNIPPET_MAX_CHARS,
              sourceFilter,
            }).catch(() => [])
          : [];

      const queryVec = await this.embeddingProvider.embedQuery(query);
      const hasVector = queryVec.some((v) => v !== 0);
      const vectorResults =
        hasVector && this.vectorAvailable
          ? await searchVector({
              client,
              providerModel: this.embeddingProvider.model,
              queryVec,
              limit: candidates,
              snippetMaxChars: SNIPPET_MAX_CHARS,
              sourceFilter,
            }).catch(() => [])
          : [];

      if (!this.hybridEnabled || !this.ftsAvailable) {
        return vectorResults
          .filter((e) => e.score >= minScore)
          .slice(0, maxResults);
      }

      // Load file mtimes for temporal decay
      const fileMtimes = this.queryConfig.temporalDecay.enabled
        ? await this.loadFileMtimes(client)
        : undefined;

      const merged = mergeHybridResults({
        vector: vectorResults.map((r) => ({
          id: r.id,
          path: r.path,
          startLine: r.startLine,
          endLine: r.endLine,
          source: r.source,
          snippet: r.snippet,
          score: r.score,
        })),
        keyword: keywordResults,
        vectorWeight: this.queryConfig.vectorWeight,
        textWeight: this.queryConfig.textWeight,
        mmr: this.queryConfig.mmr,
        temporalDecay: this.queryConfig.temporalDecay,
        fileMtimes,
      });

      const strict = merged.filter((e) => e.score >= minScore);
      if (strict.length > 0) return strict.slice(0, maxResults);

      // Relaxed fallback for keyword-only matches
      const relaxedMinScore = Math.min(minScore, this.queryConfig.textWeight);
      const keywordKeys = new Set(
        keywordResults.map(
          (e) => `${e.source}:${e.path}:${e.startLine}:${e.endLine}`,
        ),
      );
      return merged
        .filter((e) =>
          keywordKeys.has(`${e.source}:${e.path}:${e.startLine}:${e.endLine}`),
        )
        .filter((e) => e.score >= relaxedMinScore)
        .slice(0, maxResults);
    } finally {
      client.release();
    }
  }

  private async hasIndexedContent(client: PgClient): Promise<boolean> {
    const res = await client.query("SELECT 1 AS found FROM chunks LIMIT 1");
    return res.rows.length > 0;
  }

  private buildSourceFilter(sources: MemorySource[]): {
    sql: string;
    params: string[];
  } {
    if (sources.length === 0) return { sql: "", params: [] };
    const placeholders = sources.map((_, i) => `$${i + 1}`).join(", ");
    return { sql: ` AND source IN (${placeholders})`, params: [...sources] };
  }

  private async loadFileMtimes(client: PgClient): Promise<Map<string, number>> {
    const res = await client.query("SELECT path, mtime FROM files");
    const map = new Map<string, number>();
    for (const row of res.rows as Array<{ path: string; mtime: string }>) {
      map.set(row.path, Number(row.mtime));
    }
    return map;
  }

  // ─────────────────── sync ───────────────────

  async sync(params?: {
    reason?: string;
    force?: boolean;
    sessionFiles?: string[];
    progress?: (update: MemorySyncProgressUpdate) => void;
  }): Promise<void> {
    await this.ensureReady();
    await this.ensureProviderInitialized();

    if (this.syncing) return this.syncing;
    this.syncing = this.runSync(params).finally(() => {
      this.syncing = null;
    });
    return this.syncing;
  }

  private async runSync(params?: {
    reason?: string;
    force?: boolean;
    sessionFiles?: string[];
    progress?: (update: MemorySyncProgressUpdate) => void;
  }): Promise<void> {
    const client = await this.client();
    try {
      const meta = await this.readMeta(client);
      const needsFullReindex = params?.force || !meta;

      if (needsFullReindex) {
        await this.runAtomicReindex(client, params?.progress);

        // Scan workspace and sync files after schema rebuild
        if (this.config.workspaceDir) {
          const files = await scanWorkspace(
            this.config.workspaceDir,
            this.config.extraPaths ?? [],
            this.chunkConfig,
            {
              extensions: this.config.extensions,
              readers: this.config.readers,
            },
          );
          if (files.length > 0) {
            await this.syncFiles(files, { force: true, progress: params?.progress });
          }
        }
        return;
      }

      // Incremental sync: caller provides files via syncFiles()
      // For now, just mark as clean
      this.dirty = false;
    } finally {
      client.release();
    }
  }

  /**
   * Sync provided files into the index. Call this after preparing FileEntry[] objects.
   * This is the main entry point for callers (e.g. openclaw integration) to feed data.
   */
  async syncFiles(
    files: FileEntry[],
    opts?: { force?: boolean; progress?: (update: MemorySyncProgressUpdate) => void },
  ): Promise<void> {
    await this.ensureReady();
    const client = await this.client();
    try {
      const meta = await this.readMeta(client);
      const needsFullReindex = opts?.force || !meta;
      const existingHashes = needsFullReindex
        ? new Map<string, string>()
        : await this.loadExistingHashes(client);

      const total = files.reduce((n, f) => n + f.chunks.length, 0);
      let completed = 0;

      for (const file of files) {
        if (!needsFullReindex && existingHashes.get(file.path) === file.hash) {
          completed += file.chunks.length;
          opts?.progress?.({ completed, total });
          continue;
        }

        await this.indexFile(client, file);
        completed += file.chunks.length;
        opts?.progress?.({ completed, total, label: `Indexed ${file.path}` });
      }

      // Remove files from DB that no longer exist on disk
      const diskPaths = new Set(files.map((f) => f.path));
      for (const [dbPath] of existingHashes) {
        if (!diskPaths.has(dbPath)) {
          await client.query("DELETE FROM chunks WHERE path = $1", [dbPath]);
          await client.query("DELETE FROM files WHERE path = $1", [dbPath]);
        }
      }

      // Write meta
      const newMeta: MemoryIndexMeta = {
        model: this.embeddingProvider?.model ?? "fts-only",
        provider: this.embeddingProvider?.id ?? "none",
        providerKey: this.providerKey ?? "",
        sources: [...this.sources],
        vectorDims: this.vectorAvailable ? this.vectorDims : undefined,
        chunkTokens: 400,
        chunkOverlap: 80,
      };
      await this.writeMeta(client, newMeta);
      this.dirty = false;
    } finally {
      client.release();
    }
  }

  private async indexFile(client: PgClient, file: FileEntry): Promise<void> {
    const providerModel = this.embeddingProvider?.model ?? "fts-only";

    // Delete old chunks for this path+source
    await client.query(
      "DELETE FROM chunks_vec WHERE id IN (SELECT id FROM chunks WHERE path = $1 AND source = $2)",
      [file.path, file.source],
    );
    await client.query("DELETE FROM chunks WHERE path = $1 AND source = $2", [
      file.path,
      file.source,
    ]);

    // Upsert file record
    await client.query(
      `INSERT INTO files (path, source, hash, mtime, size)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (path) DO UPDATE SET hash = EXCLUDED.hash, mtime = EXCLUDED.mtime, size = EXCLUDED.size`,
      [file.path, file.source, file.hash, file.mtime, file.size],
    );

    if (file.chunks.length === 0) return;

    // Load embedding cache
    const hashes = file.chunks.map((c) => c.hash);
    const cached = await loadEmbeddingCache({
      client,
      enabled: true,
      provider: this.embeddingProvider
        ? { id: this.embeddingProvider.id, model: this.embeddingProvider.model }
        : null,
      providerKey: this.providerKey,
      hashes,
    });
    const { embeddings, missing } = collectCachedEmbeddings({
      chunks: file.chunks,
      cached,
    });

    // Generate missing embeddings
    if (missing.length > 0 && this.embeddingProvider) {
      const texts = missing.map((m) => m.chunk.text);
      const batchEmbeddings = await this.embeddingProvider.embedBatch(texts);
      for (let i = 0; i < missing.length; i++) {
        embeddings[missing[i].index] = batchEmbeddings[i] ?? [];
      }

      // Write to cache
      await upsertEmbeddingCache({
        client,
        enabled: true,
        provider: {
          id: this.embeddingProvider.id,
          model: this.embeddingProvider.model,
        },
        providerKey: this.providerKey,
        entries: missing.map((m, i) => ({
          hash: m.chunk.hash,
          embedding: batchEmbeddings[i] ?? [],
        })),
      });
    }

    // Batch insert chunks using UNNEST
    const now = Date.now();
    if (file.chunks.length > 0) {
      const ids: string[] = [];
      const paths: string[] = [];
      const sources: string[] = [];
      const startLines: number[] = [];
      const endLines: number[] = [];
      const hashes: string[] = [];
      const models: string[] = [];
      const texts: string[] = [];
      const searchTexts: string[] = [];
      const embeddingJsons: string[] = [];
      const timestamps: number[] = [];

      // Deduplicate IDs in the batch to prevent Postgres error
      const uniqueIds = new Set<string>();
      const dedupedIndices: number[] = [];
      for (let i = 0; i < file.chunks.length; i++) {
        if (!uniqueIds.has(file.chunks[i].id)) {
          uniqueIds.add(file.chunks[i].id);
          dedupedIndices.push(i);
        } else {
          console.warn(`[pg-memo] Duplicate chunk ID found in batch for ${file.path}: ${file.chunks[i].id}`);
        }
      }

      for (const i of dedupedIndices) {
        const chunk = file.chunks[i];
        const emb = embeddings[i] ?? [];
        ids.push(chunk.id);
        paths.push(chunk.path);
        sources.push(chunk.source);
        startLines.push(chunk.startLine);
        endLines.push(chunk.endLine);
        hashes.push(chunk.hash);
        models.push(chunk.model || providerModel);
        texts.push(chunk.text);
        searchTexts.push(tokenizeForFts(chunk.text));
        embeddingJsons.push(JSON.stringify(emb));
        timestamps.push(now);
      }

      await client.query(
        `INSERT INTO chunks (id, path, source, start_line, end_line, hash, model, text, search_text, embedding, updated_at)
         SELECT * FROM UNNEST(
           $1::text[], $2::text[], $3::text[], $4::int[], $5::int[],
           $6::text[], $7::text[], $8::text[], $9::text[], $10::jsonb[], $11::bigint[]
         )
         ON CONFLICT (id) DO UPDATE SET
           text = EXCLUDED.text, search_text = EXCLUDED.search_text,
           embedding = EXCLUDED.embedding,
           hash = EXCLUDED.hash, model = EXCLUDED.model, updated_at = EXCLUDED.updated_at`,
        [ids, paths, sources, startLines, endLines, hashes, models, texts, searchTexts, embeddingJsons, timestamps],
      );

      // Batch insert vectors if available
      if (this.vectorAvailable) {
        const vecIds: string[] = [];
        const vecEmbeddings: string[] = [];
        for (const i of dedupedIndices) {
          const emb = embeddings[i] ?? [];
          if (emb.length > 0) {
            vecIds.push(file.chunks[i].id);
            vecEmbeddings.push(`[${emb.join(",")}]`);
          }
        }
        if (vecIds.length > 0) {
          await client.query(
            `INSERT INTO chunks_vec (id, embedding)
             SELECT * FROM UNNEST($1::text[], $2::vector[])
             ON CONFLICT (id) DO UPDATE SET embedding = EXCLUDED.embedding`,
            [vecIds, vecEmbeddings],
          );
        }
      }
    }
  }

  private async runAtomicReindex(
    client: PgClient,
    progress?: (update: MemorySyncProgressUpdate) => void,
  ): Promise<void> {
    progress?.({ completed: 0, total: 0, label: "Dropping old index..." });

    // DDL operations use IF NOT EXISTS, so they are safe outside a transaction.
    // Wrapping in a transaction causes cascading failures (e.g. HNSW dim limit
    // aborts the entire transaction, blocking subsequent FTS setup).
    await dropMemorySchema(client);
    await ensureMemoryIndexSchema(client, {
      vectorDims: this.vectorDims,
      ftsConfig: this.ftsConfig,
      cacheEnabled: true,
      vectorEnabled: this.vectorEnabled,
      ftsEnabled: this.hybridEnabled,
    });

    progress?.({ completed: 0, total: 0, label: "Ready for reindex" });
  }

  private async loadExistingHashes(client: PgClient): Promise<Map<string, string>> {
    const res = await client.query("SELECT path, hash FROM files");
    const map = new Map<string, string>();
    for (const row of res.rows as Array<{ path: string; hash: string }>) {
      map.set(row.path, row.hash);
    }
    return map;
  }

  // ─────────────────── meta ───────────────────

  private async readMeta(client: PgClient): Promise<MemoryIndexMeta | null> {
    const res = await client.query("SELECT value FROM meta WHERE key = $1", [META_KEY]);
    if (res.rows.length === 0) return null;
    try {
      return JSON.parse(res.rows[0].value);
    } catch {
      return null;
    }
  }

  private async writeMeta(client: PgClient, meta: MemoryIndexMeta): Promise<void> {
    await client.query(
      `INSERT INTO meta (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [META_KEY, JSON.stringify(meta)],
    );
  }

  // ─────────────────── status ───────────────────

  status(): MemoryProviderStatus {
    return {
      backend: "postgresql",
      provider: this.embeddingProvider?.id ?? "none",
      model: this.embeddingProvider?.model,
      dirty: this.dirty,
      dbPath: `${this.config.connectionString} schema=${this.config.schema}`,
      sources: [...this.sources],
      fts: {
        enabled: this.hybridEnabled,
        available: this.ftsAvailable,
      },
      vector: {
        enabled: this.vectorEnabled,
        available: this.vectorAvailable,
        dims: this.vectorAvailable ? this.vectorDims : undefined,
      },
    };
  }

  // ─────────────────── probes ───────────────────

  async probeEmbeddingAvailability(): Promise<MemoryEmbeddingProbeResult> {
    await this.ensureReady();
    if (!this.embeddingProvider) {
      return { ok: false, error: "No embedding provider configured" };
    }
    try {
      await this.embeddingProvider.embedQuery("ping");
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }

  async probeVectorAvailability(): Promise<boolean> {
    await this.ensureReady();
    return this.vectorAvailable;
  }

  // ─────────────────── file watching ───────────────────

  /**
   * Start watching workspace for file changes.
   * Requires workspaceDir to be set in config.
   * Changes are automatically synced to PG.
   */
  async startWatching(): Promise<void> {
    if (this.watcher || !this.config.workspaceDir) return;
    await this.ensureReady();
    await this.ensureProviderInitialized();

    this.watcher = new FileWatcher({
      workspaceDir: this.config.workspaceDir,
      extraPaths: this.config.extraPaths,
      debounceMs: this.config.sync?.debounceMs ?? 1500,
      intervalMinutes: this.config.sync?.intervalMinutes ?? 0,
      chunkConfig: this.chunkConfig,
      extensions: this.config.extensions,
      readers: this.config.readers,
      onSync: async (files, reason, deleted) => {
        await this.ensureProviderInitialized();
        if (deleted && deleted.length > 0) {
          const client = await this.client();
          try {
            for (const relPath of deleted) {
              await client.query("DELETE FROM chunks WHERE path = $1", [relPath]);
              await client.query("DELETE FROM files WHERE path = $1", [relPath]);
            }
          } finally {
            client.release();
          }
        }
        if (files.length > 0) {
          await this.syncFiles(files, { progress: (u) => {} });
        }
      },
      log: (level, msg) => {
        if (level === "error") console.error(`[pg-memo] ${msg}`);
        else console.log(`[pg-memo] ${msg}`);
      },
    });

    // Do an initial full sync
    await this.watcher.runFullSync("startup");
    this.watcher.start();
  }

  /** Stop file watching */
  async stopWatching(): Promise<void> {
    if (this.watcher) {
      await this.watcher.stop();
      this.watcher = null;
    }
  }

  /**
   * Manually scan the workspace and sync all supported files to PG.
   * Equivalent to openclaw's force sync.
   */
  async syncWorkspace(opts?: {
    force?: boolean;
    progress?: (update: MemorySyncProgressUpdate) => void;
  }): Promise<void> {
    if (!this.config.workspaceDir) {
      throw new Error("workspaceDir is required for syncWorkspace");
    }
    await this.ensureReady();
    await this.ensureProviderInitialized();

    const { scanWorkspace } = await import("./utils/file-reader.js");
    const files = await scanWorkspace(
      this.config.workspaceDir,
      this.config.extraPaths,
      this.chunkConfig,
      {
        extensions: this.config.extensions,
        readers: this.config.readers,
      },
    );
    await this.syncFiles(files, { force: opts?.force, progress: opts?.progress });
  }

  // ─────────────────── close ───────────────────

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.stopWatching();
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }
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
