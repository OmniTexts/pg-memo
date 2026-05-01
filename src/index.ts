export { PgMemoryManager, makeChunkId, hashText } from "./pg-memory-search-manager.js";

export type {
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

export { DEFAULT_VECTOR_DIMS } from "./types.js";

export {
  searchVector,
  searchKeyword,
  mergeHybridResults,
  applyMMR,
  applyTemporalDecay,
} from "./search/index.js";

export {
  loadEmbeddingCache,
  upsertEmbeddingCache,
  collectCachedEmbeddings,
} from "./store/embedding-cache.js";

export { FileWatcher, type FileWatcherOptions } from "./watch/file-watcher.js";
export { scanWorkspace, readSingleFile, listMarkdownFiles } from "./utils/file-reader.js";
export { chunkText, hashText as hashTextContent } from "./utils/chunk.js";

export { createPgPool, acquireWithSchema, type PgPool, type PgClient } from "./pg-client.js";
export { ensureMemoryIndexSchema, dropMemorySchema } from "./schema.js";
