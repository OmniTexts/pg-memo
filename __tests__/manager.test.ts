import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PgMemoryManager } from "../src/pg-memory-search-manager.js";
import type { FileEntry, EmbeddingProvider } from "../src/types.js";

const PG_URL = process.env.PG_CONNECTION_STRING ?? "postgresql://postgres:123456@localhost:5432/postgres";
const SCHEMA = "memory_test_e2e";

/** Fake embedding provider that returns deterministic vectors */
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
    // Normalize
    const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
    return vec.map((v) => v / norm);
  }
}

function makeFiles(): FileEntry[] {
  return [
    {
      path: "MEMORY.md",
      hash: "abc123",
      mtime: Date.now(),
      size: 200,
      source: "memory",
      chunks: [
        {
          id: "chunk-1",
          path: "MEMORY.md",
          source: "memory",
          startLine: 1,
          endLine: 5,
          hash: "h1",
          model: "fake-model-1",
          text: "TypeScript is a strongly typed programming language that builds on JavaScript.",
        },
        {
          id: "chunk-2",
          path: "MEMORY.md",
          source: "memory",
          startLine: 6,
          endLine: 10,
          hash: "h2",
          model: "fake-model-1",
          text: "PostgreSQL is a powerful open source relational database system.",
        },
        {
          id: "chunk-3",
          path: "MEMORY.md",
          source: "memory",
          startLine: 11,
          endLine: 15,
          hash: "h3",
          model: "fake-model-1",
          text: "Vector embeddings allow semantic similarity search across text documents.",
        },
      ],
    },
  ];
}

describe("PgMemoryManager", () => {
  let manager: PgMemoryManager;

  beforeAll(async () => {
    // Clean up
    const { createPgPool } = await import("../src/pg-client.js");
    const pool = await createPgPool({ connectionString: PG_URL, schema: SCHEMA });
    const client = await pool.connect();
    await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    client.release();
    await pool.end();

    manager = new PgMemoryManager({
      connectionString: PG_URL,
      schema: SCHEMA,
      embeddingProvider: new FakeEmbeddingProvider(),
      hybridEnabled: true,
      vectorEnabled: true,
      vectorDims: 128,
    });
  });

  afterAll(async () => {
    await manager?.close();
  });

  it("should create schema and sync files", async () => {
    await manager.syncFiles(makeFiles());
    const status = manager.status();
    expect(status.backend).toBe("postgresql");
    expect(status.vector?.available).toBe(true);
    expect(status.fts?.available).toBe(true);
  });

  it("should find results via keyword search", async () => {
    const results = await manager.search("TypeScript language", {
      maxResults: 5,
      minScore: 0,
    });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].path).toBe("MEMORY.md");
    expect(results[0].textScore).toBeGreaterThan(0);
  });

  it("should find results via vector search", async () => {
    const results = await manager.search("database system", {
      maxResults: 5,
      minScore: 0,
    });
    expect(results.length).toBeGreaterThan(0);
    const paths = results.map((r) => r.path);
    expect(paths).toContain("MEMORY.md");
  });

  it("should merge hybrid results", async () => {
    const results = await manager.search("semantic vector search", {
      maxResults: 3,
      minScore: 0,
    });
    expect(results.length).toBeGreaterThan(0);
    // The chunk about vector embeddings should score highest
    expect(results[0].snippet).toContain("Vector embeddings");
  });

  it("should report status correctly", async () => {
    const status = manager.status();
    expect(status.backend).toBe("postgresql");
    expect(status.sources).toEqual(["memory"]);
    expect(status.vector?.enabled).toBe(true);
    expect(status.vector?.dims).toBe(128);
  });

  it("should probe embedding availability", async () => {
    const result = await manager.probeEmbeddingAvailability();
    expect(result.ok).toBe(true);
  });

  it("should handle incremental sync (same hash = skip)", async () => {
    const files = makeFiles();
    // Same hash → should skip
    await manager.syncFiles(files);
    const status = manager.status();
    expect(status.dirty).toBe(false);
  });

  it("should handle incremental sync (changed hash = reindex)", async () => {
    const files = makeFiles();
    files[0].hash = "changed-hash";
    files[0].chunks[0].text = "Updated: TypeScript is a great language for building web apps.";
    await manager.syncFiles(files);
    const results = await manager.search("great language", {
      maxResults: 5,
      minScore: 0,
    });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].snippet).toContain("Updated:");
  });
});
