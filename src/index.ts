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
  FileReader,
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
export { scanWorkspace, readSingleFile, listMarkdownFiles, listFiles } from "./utils/file-reader.js";
export { chunkText, hashText as hashTextContent } from "./utils/chunk.js";

export {
  textReader,
  pdfReader,
  docxReader,
  xlsxReader,
  buildReaderMap,
  getReader,
  DEFAULT_EXTENSIONS,
  builtinReaders,
} from "./sync/index.js";

export { createPgPool, acquireWithSchema, type PgPool, type PgClient } from "./pg-client.js";
export { ensureMemoryIndexSchema, dropMemorySchema } from "./schema.js";

export {
  OpenAIEmbeddingProvider,
  GoogleEmbeddingProvider,
  ZhipuEmbeddingProvider,
  AliyunEmbeddingProvider,
} from "./providers/index.js";
export type {
  OpenAIEmbeddingOptions,
  GoogleEmbeddingOptions,
  ZhipuEmbeddingOptions,
  AliyunEmbeddingOptions,
} from "./providers/index.js";
