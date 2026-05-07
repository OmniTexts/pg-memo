# 数据库架构与多媒体存储

本文档说明了 `pg-memo` 使用的数据库结构以及多媒体资源（图片）的管理方式。

## 1. 数据库结构

`pg-memo` 使用 PostgreSQL 存储文档元数据、文本块和向量嵌入。其设计旨在实现高性能的混合搜索（向量 + 全文检索）。

### 1.1 核心数据表

#### `files` (文件表)
存储每个已索引文件的元数据。
| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `path` | `TEXT` (主键) | 文件的相对路径。 |
| `source` | `TEXT` | 来源标识（默认 'memory'）。 |
| `hash` | `TEXT` | 文件内容的 MD5 哈希，用于检测变更。 |
| `mtime` | `BIGINT` | 文件最后修改时间。 |
| `size` | `BIGINT` | 文件大小（字节）。 |

#### `chunks` (文本块表)
存储文档的实际文本片段。
| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `id` | `TEXT` (主键) | 唯一 ID（路径 + 行范围的哈希）。 |
| `path` | `TEXT` | 对应 `files.path`。 |
| `text` | `TEXT` | 原始文本内容。 |
| `search_text`| `TEXT` | 经过分词（segmentit）后的文本，用于中文 FTS。 |
| `search_vec` | `tsvector` | PostgreSQL 全文检索向量。 |
| `start_line` | `INTEGER` | 原始文件中的起始行号。 |
| `end_line` | `INTEGER` | 原始文件中的结束行号。 |
| `hash` | `TEXT` | 文本内容的 MD5 哈希。 |

#### `chunks_vec` (向量表)
存储高维向量嵌入（需安装 `pgvector` 扩展）。
| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `id` | `TEXT` (主键) | 关联 `chunks.id`。 |
| `embedding` | `vector(N)` | 向量数据（如 1536 或 2048 维）。 |

#### `embedding_cache` (向量缓存)
持久化 LLM 向量结果，以节省 API 成本。
| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `hash` | `TEXT` (主键) | 原始文本的 MD5 哈希。 |
| `provider` | `TEXT` | LLM 供应商（如 'zhipu', 'openai'）。 |
| `embedding` | `TEXT` | JSON 编码的向量数据。 |

---

## 2. 多媒体资源存储

在处理多模态文档（如 PDF）时，`pg-memo` 会提取嵌入式图片，并采用“内容寻址”方式进行管理。

### 2.1 图片识别
- **MD5 哈希**：每张提取出的图片都会进行 MD5 哈希处理，文件名为 `[hash].[ext]`。
- **去重**：如果多个文档包含同一张图片，系统只会保存一份，从而节省空间和 API 调用成本。

### 2.2 存储模式

#### 本地模式 (默认)
- **目录**：图片保存在 `media/` 文件夹（可通过 `media.rootPath` 自定义）。
- **Markdown 引用**：以 `![图片描述](media/hash.png)` 形式注入索引。

#### 云端模式 (Cloudflare R2 / S3)
- **自动上传**：如果配置了 `media.s3` 凭据，图片会自动同步到云端。
- **访问前缀**：你可以设置 `media.baseUrl`（如 `https://cdn.example.com/`），确保图片在任何地方都可访问。
