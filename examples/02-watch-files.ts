/**
 * File Watcher Example
 *
 * Demonstrates real-time synchronization between the file system and PostgreSQL.
 * Creates a temporary workspace, starts watching it, and reflects changes in the DB.
 * Also copies a sample PDF from fixtures to test multi-format detection.
 *
 * The watcher auto-detects file changes (create, modify, delete) and incrementally
 * syncs only changed files. Multi-format support (.md, .pdf, .docx, .xlsx) is
 * enabled via the extensions config.
 *
 * Run with:
 *   PG_CONNECTION_STRING="postgresql://postgres:123456@localhost:5432/postgres" \
 *   pnpm tsx examples/02-watch-files.ts
 */

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { PgMemoryManager } from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PG_URL =
  process.env.PG_CONNECTION_STRING ??
  "postgresql://postgres:123456@localhost:5432/postgres";
const SCHEMA = "example_watch";

async function main() {
  // 1. Setup a temporary workspace
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pg-memo-watch-"));
  console.log(`\nWorkspace created at: ${tmpDir}`);

  // Create some initial files
  await fs.writeFile(
    path.join(tmpDir, "README.md"),
    "# Project Memory\nInitial content about PostgreSQL and pgvector.\n",
  );
  const subDir = path.join(tmpDir, "docs");
  await fs.mkdir(subDir);
  await fs.writeFile(
    path.join(subDir, "tech.md"),
    "# Tech Stack\n- Node.js\n- PostgreSQL\n- pgvector\n",
  );

  // 2. Initialize Manager with Watch enabled
  const manager = new PgMemoryManager({
    connectionString: PG_URL,
    schema: SCHEMA,
    workspaceDir: tmpDir,
    embeddingProvider: {
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
    extensions: [".md", ".pdf", ".docx", ".xlsx"],
    sync: {
      watch: true,
      debounceMs: 500,
    },
  });

  console.log("Starting file watcher...");
  await manager.startWatching();

  // 3. Periodic status logging
  const interval = setInterval(async () => {
    const status = manager.status();
    console.log(
      `[Status] Files: ${status.files}, Chunks: ${status.chunks}`,
    );
  }, 3000);

  // 4. Simulate changes
  setTimeout(async () => {
    console.log("\n[Auto] Updating README.md...");
    await fs.writeFile(
      path.join(tmpDir, "README.md"),
      "# Project Memory\nUpdated content! Added Redis support.\n",
    );
  }, 2000);

  setTimeout(async () => {
    console.log("[Auto] Adding new file: docs/api.md...");
    await fs.writeFile(
      path.join(subDir, "api.md"),
      "# API Reference\nRESTful endpoints for search and sync.\n",
    );
  }, 5000);

  setTimeout(async () => {
    // Copy sample PDF from fixtures to test multi-format detection
    const fixturesDir = path.resolve(__dirname, "fixtures");
    const srcPdf = path.join(fixturesDir, "sample.pdf");
    try {
      await fs.access(srcPdf);
      console.log("[Auto] Copying sample.pdf from fixtures...");
      await fs.copyFile(srcPdf, path.join(tmpDir, "sample.pdf"));
    } catch {
      console.log("[Auto] Skipping PDF copy (fixtures not found)");
    }
  }, 8000);

  // Handle exit
  process.on("SIGINT", async () => {
    clearInterval(interval);
    console.log("\n\nStopping...");
    await manager.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
    console.log("Cleaned up temp directory. Exit.");
    process.exit(0);
  });
}

main().catch(console.error);
