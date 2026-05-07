# @omnitexts/pg-memo

A high-performance, enterprise-ready PostgreSQL-based RAG (Retrieval-Augmented Generation) engine for AI agents, now featuring **Multimodal Knowledge Extraction**.

## 🚀 Key Features

- **👁️ Multimodal PDF Parsing**: Integrated **Python (PyMuPDF)** + **Zhipu GLM-4V** pipeline for layout-aware text and image extraction.
- **🖼️ Vision-Enhanced Indexing**: Automatically converts PDF images, hexagrams, and symbols into searchable text descriptions via VLM.
- **📦 Smart Media Storage**: Supports both local persistence and **Cloudflare R2 / S3-compatible** cloud storage for extracted images.
- **⚡ High Performance**: Bulk indexing using PostgreSQL `UNNEST` operations for 10x faster ingestion.
- **🏮 Chinese Optimized**: Application-layer Chinese segmentation (via `segmentit`) combined with PostgreSQL 'simple' FTS configuration.
- **📄 Multi-format Support**: Native support for Markdown, PDF, Word (`.docx`), and Excel (`.xlsx`).
- **🧩 Structural Chunking**: Heading-aware splitting for better semantic coherence.
- **🤖 Provider Agnostic**: Native support for OpenAI, Zhipu AI, and Aliyun (DashScope).
- **💾 Lightweight**: Zero native dependencies, works on managed PostgreSQL (Supabase, RDS, etc.).

## 📦 Installation

```bash
npm install @omnitexts/pg-memo
# For PDF/Word/Excel support
npm install mammoth xlsx @aws-sdk/client-s3
```

> **Note**: For advanced PDF multimodal extraction, ensure `python3` with `pymupdf` and `zhipuai` is installed.

## 🛠️ Quick Start

```typescript
import { PgMemoryManager } from "@omnitexts/pg-memo";

const manager = new PgMemoryManager({
  connectionString: "postgresql://user:pass@localhost:5432/db",
  schema: "my_app_memory",
  workspaceDir: "./docs",
  embeddingProvider: zhipuProvider,
  // Multimodal Media Configuration
  media: {
    baseUrl: "https://pub-xxx.r2.dev/", // Your public domain (Local or R2)
    s3: {
      bucket: "my-bucket",
      endpoint: "https://<id>.r2.cloudflarestorage.com",
      accessKeyId: "...",
      secretAccessKey: "..."
    }
  }
});

// Sync and search
await manager.sync();
const results = await manager.search("乾卦九三爻的含义");
```

## 💎 Advanced Optimizations

### 1. Vision-Enhanced PDF Extraction
We've bridged Node.js with a Python-based extraction engine that:
- **Deduplicates Images**: Uses MD5 hashing to avoid redundant VLM API calls and storage.
- **Layout Awareness**: Maintains correct reading order between text and images.
- **VLM Tagging**: Automatically injects `![description](url)` into the index, making visual content fully searchable.

### 2. Flexible Image Persistence
- **Local Mode**: Automatically saves images to a `media/` subfolder relative to your files.
- **Cloud Mode**: Seamlessly uploads to Cloudflare R2 or S3, enabling global accessibility for your agent's knowledge base.

### 3. Real-time Sync & Watch
```typescript
manager.startWatching(); // Auto-sync on file changes with debounce support
```

## 📄 License
MIT
