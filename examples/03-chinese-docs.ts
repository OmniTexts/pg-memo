/**
 * Multi-format & Chinese Documents Example
 *
 * Demonstrates indexing PDF, DOCX, and XLSX files from a workspace directory,
 * and searching with both Chinese and English queries.
 *
 * Features demonstrated:
 * - Chinese FTS: segmentit pre-tokenizes Chinese text into space-separated
 *   tokens, then PostgreSQL 'simple' tsvector config indexes them
 * - DOCX heading-aware chunking: mammoth converts to markdown, chunkMarkdown
 *   splits by headings for semantically coherent chunks
 * - PDF/XLSX text extraction with pluggable readers
 *
 * Run with:
 *   PG_CONNECTION_STRING="postgresql://postgres:123456@localhost:5432/postgres" \
 *   pnpm tsx examples/03-chinese-docs.ts
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { PgMemoryManager } from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const connectionString =
    process.env.PG_CONNECTION_STRING ||
    "postgresql://postgres:123456@localhost:5432/postgres";
  const schema = "example_vlm";

  // Workspace: fixtures directory with sample.pdf, sample.docx, sample.xlsx
  const workspace = path.resolve(__dirname, "fixtures");

  const manager = new PgMemoryManager({
    connectionString,
    schema,
    workspaceDir: workspace,
    // Use Zhipu if available, otherwise mock
    embeddingProvider: process.env.ZHIPU_API_KEY
      ? new (await import("../src/index.js")).ZhipuEmbeddingProvider({
          model: "embedding-3",
          dimensions: 2048,
        })
      : {
          id: "mock",
          model: "mock-model",
          async embedQuery() {
            return new Array(2048).fill(0).map(() => Math.random());
          },
          async embedBatch(texts) {
            return texts.map(() => new Array(2048).fill(0).map(() => Math.random()));
          },
        },
    vectorDims: 2048,
    vectorEnabled: true,
    hybridEnabled: true,
    extensions: [".md", ".pdf", ".docx", ".xlsx"],
  });

  console.log(`Workspace: ${workspace}`);
  console.log("Supported formats: .md, .pdf, .docx, .xlsx\n");

  // Sync and index all files
  console.log("Syncing...");
  await manager.sync();
  console.log("Sync complete.\n");

  // Show status
  const status = manager.status();
  console.log("Status:", JSON.stringify(status, null, 2));

  // Search: Chinese content from DOCX
  const queries = [
    { q: "技术架构", desc: "Chinese: from DOCX headings" },
    { q: "存储层", desc: "Chinese: from DOCX section" },
    { q: "Embedding Providers", desc: "English: from XLSX sheet" },
    { q: "PostgreSQL vector", desc: "English: from PDF content" },
    { q: "全文检索", desc: "Chinese: from DOCX content" },
    { q: "file watching", desc: "English: from PDF content" },
  ];

  for (const { q, desc } of queries) {
    console.log(`\n── Search: "${q}" (${desc}) ──`);
    const results = await manager.search(q, { maxResults: 3 });
    if (results.length === 0) {
      console.log("  (no results)");
    }
    for (const r of results) {
      console.log(
        `  [${r.score.toFixed(3)}] ${r.path}:${r.startLine}-${r.endLine}`,
      );
      console.log(`    ${r.snippet.replace(/\n/g, " ").slice(0, 100)}`);
    }
  }

  if (manager.close) await manager.close();
}

main().catch(console.error);
