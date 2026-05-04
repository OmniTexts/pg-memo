# pg-memo Examples

Self-contained examples demonstrating pg-memo's core features. Each example is independent and can be run directly with `tsx`.

## Prerequisites

- PostgreSQL running on `localhost:5432` (e.g. via Docker)
- Node.js 18+

```bash
# Start PostgreSQL with Docker
docker run -d --name postgres -p 5432:5432 \
  -e POSTGRES_PASSWORD=123456 postgres
```

## Quick Start

```bash
cd pg-memo

# Basic search (PDF + DOCX + XLSX indexing)
PG_CONNECTION_STRING="postgresql://postgres:123456@localhost:5432/postgres" \
  pnpm tsx examples/01-basic-search.ts

# File watcher (real-time sync)
PG_CONNECTION_STRING="postgresql://postgres:123456@localhost:5432/postgres" \
  pnpm tsx examples/02-watch-files.ts

# Chinese documents & multi-format
PG_CONNECTION_STRING="postgresql://postgres:123456@localhost:5432/postgres" \
  pnpm tsx examples/03-chinese-docs.ts
```

## Examples

| File | Description |
|------|-------------|
| `01-basic-search.ts` | Initialize PgMemoryManager, index fixtures, run hybrid search (Chinese FTS + structured chunking) |
| `02-watch-files.ts` | Real-time file watcher with temp directory, auto-changes, PDF detection |
| `03-chinese-docs.ts` | Index PDF/DOCX/XLSX, search with Chinese and English queries (heading-aware chunking) |

## Key Features Demonstrated

- **Chinese Full-Text Search**: Uses [segmentit](https://github.com/linonetwo/segmentit) to pre-tokenize Chinese text into space-separated tokens, then PostgreSQL's `simple` tsvector config for indexing. This enables word-level Chinese search instead of exact-match-only.

- **Structured Chunking**: `.md` and `.docx` files are split by headings (`#` to `######`) for semantically coherent chunks. Oversized sections are further subdivided by paragraphs with configurable overlap.

- **Multi-Format Readers**: Pluggable `FileReader` interface supports `.md`, `.pdf`, `.docx`, `.xlsx`. Readers auto-register based on available dependencies (`mammoth`, `pdfjs-dist`, `xlsx`).

## Fixtures

The `fixtures/` directory contains small sample files used by the examples:

| File | Size | Content |
|------|------|---------|
| `sample.pdf` | 1.6 KB | Pg-memo feature overview (English) |
| `sample.docx` | 37 KB | Architecture documentation (Chinese, with headings) |
| `sample.xlsx` | 5.7 KB | Embedding providers comparison + file format list (2 sheets) |

These files are self-contained and meaningful for search testing. To regenerate them:

```bash
python3 scripts/create-fixtures.py
```

## Embedding Providers

Examples use a mock provider by default (random vectors). To use a real provider:

```bash
# OpenAI
OPENAI_API_KEY="sk-..." pnpm tsx examples/01-basic-search.ts

# Zhipu AI
ZHIPU_API_KEY="..." pnpm tsx examples/03-chinese-docs.ts
```

Available providers:
- `OpenAIEmbeddingProvider` — text-embedding-3-small/large
- `GoogleEmbeddingProvider` — text-embedding-004
- `ZhipuEmbeddingProvider` — embedding-3
- `AliyunEmbeddingProvider` — text-embedding-v2
