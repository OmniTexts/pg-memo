# Database Architecture & Multimedia Storage

This document describes the database schema used by `pg-memo` and how multimedia resources (images) are managed.

## 1. Database Schema

`pg-memo` uses a PostgreSQL schema to store document metadata, text chunks, and vector embeddings. It is designed for high-performance hybrid search (Vector + Full-Text Search).

### 1.1 Core Tables

#### `files`
Stores metadata for each indexed file.
| Column | Type | Description |
| :--- | :--- | :--- |
| `path` | `TEXT` (PK) | Workspace-relative path to the file. |
| `source` | `TEXT` | Source identifier (default: 'memory'). |
| `hash` | `TEXT` | MD5 hash of file content to detect changes. |
| `mtime` | `BIGINT` | Last modification time of the file. |
| `size` | `BIGINT` | File size in bytes. |

#### `chunks`
Stores the actual text segments of a document.
| Column | Type | Description |
| :--- | :--- | :--- |
| `id` | `TEXT` (PK) | Unique ID (hash of path + line range). |
| `path` | `TEXT` | Reference to `files.path`. |
| `text` | `TEXT` | The raw text content of the chunk. |
| `search_text`| `TEXT` | Pre-tokenized text for Chinese FTS (using `segmentit`). |
| `search_vec` | `tsvector` | PostgreSQL full-text search vector. |
| `start_line` | `INTEGER` | Starting line number in the original file. |
| `end_line` | `INTEGER` | Ending line number in the original file. |
| `hash` | `TEXT` | MD5 hash of the chunk text. |

#### `chunks_vec`
Stores high-dimensional vector embeddings (requires `pgvector`).
| Column | Type | Description |
| :--- | :--- | :--- |
| `id` | `TEXT` (PK) | References `chunks.id`. |
| `embedding` | `vector(N)` | The vector embedding (e.g., 1536 or 2048 dims). |

#### `embedding_cache`
Persistent cache for LLM embedding results to save cost.
| Column | Type | Description |
| :--- | :--- | :--- |
| `hash` | `TEXT` (PK) | MD5 hash of the original text. |
| `provider` | `TEXT` | LLM provider (e.g., 'zhipu', 'openai'). |
| `embedding` | `TEXT` | JSON-encoded vector. |

---

## 2. Multimedia Resource Storage

When processing multimodal documents (like PDFs), `pg-memo` extracts embedded images and manages them using a content-addressable storage (CAS) approach.

### 2.1 Image Identification
- **MD5 Hashing**: Every extracted image is hashed (MD5). The filename is set to `[hash].[ext]`.
- **Deduplication**: If multiple documents contain the same image, it is only stored once and reused across indices.

### 2.2 Storage Modes

#### Local Mode (Default)
- **Directory**: Images are saved to a `media/` folder (customizable via `media.rootPath`).
- **Markdown Reference**: Injected as `![Image Description](media/hash.png)`.

#### Cloud Mode (Cloudflare R2 / S3)
- **Automatic Upload**: If `media.s3` credentials are provided, images are automatically uploaded to the cloud bucket.
- **Base URL**: You can set a `media.baseUrl` (e.g., `https://cdn.example.com/`) to ensure images are accessible from anywhere.

---

## 3. Audio Transcription Pipeline (Podcast/Audio)

`pg-memo` integrates the **Xiaomi MiMo V2.5 ASR** engine to transform long-form audio into a searchable knowledge base.

### 3.1 Automated Transcription Flow
1. **File Scanning**: The system automatically scans `workspaceDir` for `.mp3`, `.m4a`, and `.wav` files.
2. **ASR Processing**: Uses the MiMo model for speech-to-text, with optional **Speaker Diarization** enabled.
3. **Transcript Persistence**: Generated Markdown transcripts are stored in a hidden `.transcripts/` directory, containing timestamps, speaker labels, and structured content tables.
4. **Semantic Indexing**: Transcribed text is automatically chunked and indexed with vector embeddings, making it searchable via natural language queries.

### 3.2 Speaker Diarization
When `audio.diarization: true` is enabled, transcripts are rendered as standard Markdown tables:
- **Timestamps**: Precisely locate audio segments.
- **Role Labels**: e.g., `Speaker 1`, `Speaker 2`.
- **Retrieval Enhancement**: Search results return specific conversation snippets with attribution, significantly improving the utility of podcast indexing.
