# pg-memo 🧠

**pg-memo** is a PostgreSQL-based long-term memory and semantic search engine for AI Agents. It combines `pgvector` for vector similarity search and PostgreSQL's native `Full-Text Search` (FTS) to provide a high-performance, scalable, and consistent memory management solution for AI applications.

This project is a standalone refactoring of the SQLite-based memory implementation from `openclaw`.

---

## ✨ Features

- **🚀 Hybrid Search**: Combines semantic vector search (`pgvector`) and keyword search (`tsvector`) with weighted scoring for superior retrieval accuracy.
- **📈 Advanced Re-ranking**:
  - **MMR (Maximal Marginal Relevance)**: Reduces redundancy and increases diversity in search results.
  - **Temporal Decay**: Adjusts scores based on file modification time, giving agents a sense of "recency."
- **🔄 Auto-Sync & Real-time Watching**: Built-in `FileWatcher` (powered by `chokidar`) that automatically indexes and syncs `.md` files in your workspace.
- **💾 Embedding Cache**: Persistent caching layer for embeddings to significantly reduce API costs for repetitive content.
- **🧩 Pluggable Provider Architecture**: Easily integrate with OpenAI, Ollama, Local Transformers, or any custom embedding model.
- **🛡️ Robust Schema Management**: Automated initialization of tables, indexes (HNSW for vectors, GIN for text), and triggers for seamless deployment.

---

## 🏗️ Architecture

`pg-memo` is designed with a decoupled architecture:
- **PgMemoryManager (Engine)**: The core orchestrator handling CRUD operations, indexing pipelines, and search algorithms.
- **EmbeddingProvider (Interface)**: Handles text vectorization.
- **Sync Adapters (Coming Soon)**: Specialized modules to ingest data from various sources (Local Files, Databases, Web, etc.).

---

## 🚀 Quick Start

### 1. Prerequisites

You need a PostgreSQL instance with the `pgvector` extension installed.

```bash
# Install dependencies
pnpm install
```

### 2. Basic Usage

```typescript
import { PgMemoryManager } from "pg-memo";

const manager = new PgMemoryManager({
  connectionString: "postgresql://user:pass@localhost:5432/dbname",
  schema: "my_agent_memory",
  workspaceDir: "./my_docs",
  embeddingProvider: new MyEmbeddingProvider(), // Implement the EmbeddingProvider interface
  vectorEnabled: true,
  hybridEnabled: true,
  vectorDims: 1536, // Match your model's dimensions
});

// 1. Initial sync and start watching for file changes
await manager.startWatching();

// 2. Perform a hybrid search
const results = await manager.search("How to use TypeScript?", {
  maxResults: 5,
  minScore: 0.35,
});

console.log(results);
```

---

## 🛠️ Roadmap

- [ ] **Multi-source Support**: Implement `DatabaseAdapter` and `WebAdapter` in `src/sync/`.
- [ ] **Built-in Providers**: Ship standard adapters for OpenAI, Ollama, and Transformers.js.
- [ ] **Structural Chunking**: Syntax-aware chunking for Markdown (headers/sections) and Code files.
- [ ] **MCP Integration**: A standardized Model Context Protocol server wrapper for plug-and-play use in Claude Desktop.

---

## ⚖️ License

This project is licensed under the [MIT License](LICENSE).
