import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { PgMemoryManager } from "../src/pg-memory-search-manager.js";
import type { EmbeddingProvider } from "../src/types.js";

const PG_URL = process.env.PG_CONNECTION_STRING ?? "postgresql://postgres:123456@localhost:5432/postgres";
const SCHEMA = "memory_test_watch";

/** Fake embedding provider */
class FakeEmbeddingProvider implements EmbeddingProvider {
  readonly id = "fake";
  readonly model = "fake-model-1";
  private readonly dims = 128;

  async embedQuery(text: string): Promise<number[]> {
    return this.textToVec(text);
  }
  async embedBatch(texts: string[]): Promise<number[][]> {
    return texts.map((t) => this.textToVec(t));
  }
  private textToVec(text: string): number[] {
    const vec = new Array(this.dims).fill(0);
    for (let i = 0; i < text.length && i < this.dims; i++) {
      vec[i] = text.charCodeAt(i) / 65535;
    }
    const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
    return vec.map((v) => v / norm);
  }
}

describe("PgMemoryManager file watching", () => {
  let tmpDir: string;
  let manager: PgMemoryManager;

  beforeAll(async () => {
    // Create temp workspace
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pg-memo-test-"));
    await fs.writeFile(
      path.join(tmpDir, "MEMORY.md"),
      "# Project Memory\n\nThis project uses TypeScript for all code.\n",
    );
    const memoryDir = path.join(tmpDir, "memory");
    await fs.mkdir(memoryDir, { recursive: true });
    await fs.writeFile(
      path.join(memoryDir, "architecture.md"),
      "# Architecture\n\nWe use PostgreSQL for data storage.\n",
    );

    // Clean old schema
    const { createPgPool } = await import("../src/pg-client.js");
    const pool = await createPgPool({ connectionString: PG_URL, schema: SCHEMA });
    const client = await pool.connect();
    await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    client.release();
    await pool.end();

    manager = new PgMemoryManager({
      connectionString: PG_URL,
      schema: SCHEMA,
      workspaceDir: tmpDir,
      embeddingProvider: new FakeEmbeddingProvider(),
      hybridEnabled: true,
      vectorEnabled: true,
      vectorDims: 128,
      sync: { watch: true, debounceMs: 500, intervalMinutes: 0 },
    });
  });

  afterAll(async () => {
    await manager?.close();
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("should scan workspace and index all md files", async () => {
    await manager.syncWorkspace();
    const status = manager.status();
    // Should have indexed files
    const results = await manager.search("TypeScript", { maxResults: 5, minScore: 0 });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].path).toBe("MEMORY.md");
  });

  it("should pick up a new file after syncWorkspace", async () => {
    // Add a new file
    await fs.writeFile(
      path.join(tmpDir, "memory", "new-feature.md"),
      "# New Feature\n\nAdded Redis caching layer for performance.\n",
    );
    await manager.syncWorkspace();

    const results = await manager.search("Redis caching", { maxResults: 5, minScore: 0 });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].path).toBe("memory/new-feature.md");
  });

  it("should update index when file content changes", async () => {
    // Modify existing file
    await fs.writeFile(
      path.join(tmpDir, "MEMORY.md"),
      "# Project Memory\n\nThis project now uses Rust for performance-critical code.\n",
    );
    await manager.syncWorkspace();

    const results = await manager.search("Rust performance", { maxResults: 5, minScore: 0 });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].snippet).toContain("Rust");
  });

  it("should start watching and auto-sync on file change", async () => {
    await manager.startWatching();

    // Give watcher a moment to start
    await new Promise((r) => setTimeout(r, 500));

    // Modify file while watcher is running
    await fs.writeFile(
      path.join(tmpDir, "MEMORY.md"),
      "# Project Memory\n\nLive watching test with Go microservices.\n",
    );

    // Wait for debounce + sync
    await new Promise((r) => setTimeout(r, 3000));

    const results = await manager.search("Go microservices", { maxResults: 5, minScore: 0 });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].snippet).toContain("Go microservices");
  });
});
