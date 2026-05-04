/**
 * Basic Search Example
 *
 * Demonstrates how to initialize PgMemoryManager, index files from a
 * workspace directory, and perform hybrid (vector + keyword) search.
 *
 * Features demonstrated:
 * - Multi-format indexing (.md, .pdf, .docx, .xlsx) via extensions config
 * - Chinese full-text search (segmentit tokenization + PostgreSQL 'simple' config)
 * - Markdown structured chunking (splits by headings for semantic coherence)
 *
 * Run with:
 *   PG_CONNECTION_STRING="postgresql://postgres:123456@localhost:5432/postgres" \
 *   pnpm tsx examples/01-basic-search.ts
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { PgMemoryManager } from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const connectionString =
    process.env.PG_CONNECTION_STRING ||
    "postgresql://postgres:123456@localhost:5432/postgres";
  const schema = "example_basic";

  // Workspace: the fixtures directory containing sample.pdf, sample.docx, sample.xlsx
  const workspace = path.resolve(__dirname, "fixtures");

  const manager = new PgMemoryManager({
    connectionString,
    schema,
    workspaceDir: workspace,
    // Use a mock provider if no API key is present
    embeddingProvider: process.env.OPENAI_API_KEY
      ? new (await import("../src/index.js")).OpenAIEmbeddingProvider()
      : {
          id: "mock",
          model: "mock-model",
          async embedQuery() {
            return new Array(256).fill(0).map(() => Math.random());
          },
          async embedBatch(texts) {
            return texts.map(() => new Array(256).fill(0).map(() => Math.random()));
          },
        },
    vectorDims: 256,
    vectorEnabled: true,
    hybridEnabled: true,
    extensions: [".md", ".pdf", ".docx", ".xlsx"],
  });

  // Sync files from fixtures directory
  console.log(`Workspace: ${workspace}`);
  console.log("Syncing files...");
  await manager.sync();
  console.log("Sync complete.\n");

  const status = manager.status();
  console.log("Status:", JSON.stringify(status, null, 2));

  // Search in both English and Chinese
  const queries = [
    "PostgreSQL full-text search",
    "vector similarity",
    "技术架构",
    "Embedding Providers",
  ];

  for (const q of queries) {
    console.log(`\n── Search: "${q}" ──`);
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
