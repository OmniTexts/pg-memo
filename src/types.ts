/** Memory source type, compatible with openclaw's MemorySource */
export type MemorySource = "memory" | "sessions";

/**
 * File reader adapter — extracts plain text from a specific file format.
 * Register custom readers via PgMemoryConfig.readers.
 */
export interface FileReader {
  /** File extensions this reader handles (e.g. [".pdf"]) */
  extensions: string[];
  /** Extract text content from a file */
  read(
    filePath: string,
    workspaceDir: string,
    chunkConfig: ChunkConfig,
    options?: { media?: MediaConfig; audio?: AudioConfig },
  ): Promise<{ content: string; metadata?: Record<string, any> }>;
}

/** Search result, compatible with openclaw's MemorySearchResult */
export type MemorySearchResult = {
  path: string;
  startLine: number;
  endLine: number;
  score: number;
  vectorScore?: number;
  textScore?: number;
  snippet: string;
  source: MemorySource;
  citation?: string;
};

/** Sync progress update */
export type MemorySyncProgressUpdate = {
  completed: number;
  total: number;
  label?: string;
};

/** Provider status */
export type MemoryProviderStatus = {
  backend: "postgresql";
  provider: string;
  model?: string;
  files?: number;
  chunks?: number;
  dirty?: boolean;
  dbPath?: string;
  sources?: MemorySource[];
  fts?: { enabled: boolean; available: boolean; error?: string };
  vector?: {
    enabled: boolean;
    available?: boolean;
    dims?: number;
  };
};

/** Embedding probe result */
export type MemoryEmbeddingProbeResult = {
  ok: boolean;
  error?: string;
};

/**
 * Core interface, structurally compatible with openclaw's MemorySearchManager.
 * Consumers (e.g. openclaw) can use this directly without importing openclaw internals.
 */
export interface PgMemorySearchManager {
  search(
    query: string,
    opts?: {
      maxResults?: number;
      minScore?: number;
      sessionKey?: string;
      sources?: MemorySource[];
    },
  ): Promise<MemorySearchResult[]>;

  sync(params?: {
    reason?: string;
    force?: boolean;
    sessionFiles?: string[];
    progress?: (update: MemorySyncProgressUpdate) => void;
  }): Promise<void>;

  status(): MemoryProviderStatus;

  probeEmbeddingAvailability(): Promise<MemoryEmbeddingProbeResult>;
  probeVectorAvailability(): Promise<boolean>;

  close?(): Promise<void>;
}

/** Embedding provider interface */
export interface EmbeddingProvider {
  id: string;
  model: string;
  embedQuery(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}

/** Configuration for PgMemorySearchManager */
export type PgMemoryConfig = {
  /** PostgreSQL connection string */
  connectionString: string;
  /** Schema name for this agent's memory tables */
  schema: string;
  /** Workspace directory containing MEMORY.md and memory/ files */
  workspaceDir?: string;
  /** Additional file paths to watch and index */
  extraPaths?: string[];
  /** Embedding provider (nullable for FTS-only mode) */
  embeddingProvider?: EmbeddingProvider | null;
  /** Enable vector search (requires pgvector extension) */
  vectorEnabled?: boolean;
  /** Enable hybrid FTS + vector search */
  hybridEnabled?: boolean;
  /** Max vector dimensions (default 1536) */
  vectorDims?: number;
  /** FTS tokenizer: "english" | "simple" | custom postgres config */
  ftsConfig?: string;
  /** Sources to index */
  sources?: MemorySource[];
  /** Chunking config */
  chunking?: ChunkConfig;
  /** Search config */
  query?: {
    maxResults?: number;
    minScore?: number;
    vectorWeight?: number;
    textWeight?: number;
    candidateMultiplier?: number;
    mmr?: { enabled: boolean; lambda?: number };
    temporalDecay?: { enabled: boolean; halfLifeDays?: number };
  };
  /** Supported file extensions (default [".md"]). E.g. [".md", ".txt", ".pdf", ".docx", ".xlsx"] */
  extensions?: string[];
  /** Custom file readers for non-text formats. Built-in readers handle .md/.txt. */
  readers?: FileReader[];
  /** Sync / watch config */
  sync?: {
    /** Watch workspace for file changes (default true if workspaceDir set) */
    watch?: boolean;
    /** Debounce delay in ms after file change (default 1500) */
    debounceMs?: number;
    /** Periodic full sync interval in minutes (0 = disabled) */
    intervalMinutes?: number;
  };
  /** Media/Image storage configuration */
  media?: MediaConfig;
  /** Audio transcription configuration */
  audio?: AudioConfig;
};

export interface MediaConfig {
  /** Folder to save images locally (used as temp dir for cloud uploads) */
  rootPath?: string;
  /** URL prefix for images in markdown (e.g. your R2 public domain) */
  baseUrl?: string;
  /** Cloudflare R2 / S3 configuration */
  s3?: S3Config;
}

export interface AudioConfig {
  rootPath?: string; // Path to store generated transcripts
  provider: 'mimo' | 'whisper' | 'none';
  apiKey?: string;
  diarization?: boolean; // Whether to separate speakers
  concurrency?: number; // How many chunks to process in parallel
}

export interface S3Config {
  bucket: string;
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export type ChunkConfig = { tokens: number; overlap: number };

/** File entry for indexing */
export type FileEntry = {
  path: string;
  hash: string;
  mtime: number;
  size: number;
  source: MemorySource;
  content: string;
  metadata?: Record<string, any>;
  /** Chunked text segments */
  chunks: ChunkEntry[];
};

/** A single chunk with text and optional embedding */
export type ChunkEntry = {
  id: string;
  path: string;
  source: MemorySource;
  startLine: number;
  endLine: number;
  hash: string;
  model: string;
  text: string;
  embedding?: number[];
};

/** Internal search row from PG */
export type SearchRowResult = {
  id: string;
  path: string;
  startLine: number;
  endLine: number;
  score: number;
  snippet: string;
  source: MemorySource;
};

/** Default max dimensions. pgvector 0.8.0 HNSW index supports up to 2000.
 *  text-embedding-3-small = 1536, text-embedding-3-large = 3072 (needs IVFFlat or no index). */
export const DEFAULT_VECTOR_DIMS = 1536;
