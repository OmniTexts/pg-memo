# @omnitexts/pg-memo

A high-performance, enterprise-ready PostgreSQL-based RAG (Retrieval-Augmented Generation) engine for AI agents.

## Features

- **🚀 High Performance**: Bulk indexing using PostgreSQL `UNNEST` operations for 10x faster ingestion.
- **🏮 Chinese Optimized**: Application-layer Chinese segmentation (via `segmentit`) combined with PostgreSQL 'simple' FTS configuration for superior search accuracy without complex DB plugins.
- **📄 Multi-format Support**: Integrated support for Markdown, PDF, Word (`.docx`), and Excel (`.xlsx`).
- **🧩 Structural Chunking**: Smart Markdown splitting that respects heading boundaries (`#` to `######`) for better semantic coherence.
- **🤖 Provider Agnostic**: Native support for OpenAI, Zhipu AI, and Aliyun (DashScope).
- **🔋 Production Ready**: Built-in API retry logic, concurrency control, and CJK-aware token estimation.
- **💾 Lightweight**: Zero native dependencies, works on managed PostgreSQL (Supabase, RDS, etc.).

## Installation

```bash
npm install @omnitexts/pg-memo
# Optional: for PDF/Word/Excel support
npm install mammoth xlsx
```

## Quick Start

```typescript
import { PgMemoryManager } from "@omnitexts/pg-memo";

const manager = new PgMemoryManager({
  connectionString: "postgresql://user:pass@localhost:5432/db",
  schema: "my_app_memory",
  workspaceDir: "./docs",
  embeddingProvider: myProvider, // OpenAI, Zhipu, etc.
  extensions: [".md", ".pdf"],
});

// Sync files to database
await manager.sync();

// Hybrid Search (Vector + Keyword)
const results = await manager.search("如何优化数据库索引?");
console.log(results);
```

## Advanced Features

### Real-time Sync
```typescript
// Watch for file changes and auto-sync
manager.startWatching();

manager.onSync((event) => {
  console.log(`Syncing ${event.files.length} files: ${event.reason}`);
});
```

### Custom Chinese FTS
We use `segmentit` to pre-tokenize Chinese text in the application layer. This allows you to use standard PostgreSQL without installing `zhparser` or `pg_jieba`.

## License
MIT
