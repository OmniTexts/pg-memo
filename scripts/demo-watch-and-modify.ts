/**
 * 自动化演示：修改文件 → 自动同步到 PG
 */

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { PgMemoryManager } from "../src/pg-memory-search-manager.js";
import type { EmbeddingProvider } from "../src/types.js";

const PG_URL = process.env.PG_CONNECTION_STRING ?? "postgresql://postgres:123456@localhost:5432/postgres";
const SCHEMA = "demo_auto";

class DemoProvider implements EmbeddingProvider {
  readonly id = "demo";
  readonly model = "demo";
  private readonly dims = 256;
  async embedQuery(t: string) { return this.toVec(t); }
  async embedBatch(ts: string[]) { return ts.map((t) => this.toVec(t)); }
  private toVec(t: string) {
    const v = new Array(this.dims).fill(0);
    for (let i = 0; i < t.length; i++) v[i % this.dims] += t.charCodeAt(i) / 65535;
    const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
    return v.map((x) => x / n);
  }
}

async function dumpDB(schema: string, label: string) {
  const { createPgPool } = await import("../src/pg-client.js");
  const pool = await createPgPool({ connectionString: PG_URL, schema });
  const client = await pool.connect();
  try {
    const r = await client.query(
      "SELECT path, start_line, left(text, 50) AS preview FROM chunks ORDER BY path, start_line",
    );
    console.log(`\n${label} — ${r.rows.length} chunks:`);
    for (const row of r.rows) console.log(`  ${row.path}:${row.start_line}  "${row.preview.trim()}"`);
  } finally {
    client.release();
    await pool.end();
  }
}

async function main() {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pg-memo-demo-"));
  console.log(`Workspace: ${tmpDir}\n`);

  // 初始文件 + 目录（chokidar 需要目录存在才能监控其中新增的文件）
  await fs.mkdir(path.join(tmpDir, "memory"), { recursive: true });
  await fs.writeFile(path.join(tmpDir, "MEMORY.md"), "# 记忆\n\n版本 1：初始内容。\n");

  // 清理
  const { createPgPool } = await import("../src/pg-client.js");
  const pool = await createPgPool({ connectionString: PG_URL, schema: SCHEMA });
  const c = await pool.connect();
  await c.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  c.release();
  await pool.end();

  const manager = new PgMemoryManager({
    connectionString: PG_URL,
    schema: SCHEMA,
    workspaceDir: tmpDir,
    embeddingProvider: new DemoProvider(),
    hybridEnabled: true,
    vectorEnabled: true,
    vectorDims: 256,
    sync: { watch: true, debounceMs: 800 },
  });

  // 启动监控（会做首次全量同步）
  await manager.startWatching();
  await dumpDB(SCHEMA, "初始状态");

  // ── 操作 1：修改已有文件 ──
  console.log("\n── 修改 MEMORY.md（版本 1 → 版本 2）──");
  await fs.writeFile(path.join(tmpDir, "MEMORY.md"), "# 记忆\n\n版本 2：内容已更新！增加了 Redis 缓存。\n");
  await new Promise((r) => setTimeout(r, 2500)); // 等 debounce + sync
  await dumpDB(SCHEMA, "修改后");

  // ── 操作 2：新增文件 ──
  console.log("\n── 新增 memory/架构.md ──");
  await fs.writeFile(
    path.join(tmpDir, "memory", "架构.md"),
    "# 系统架构\n\n采用微服务架构，使用 Kubernetes 编排。\n",
  );
  await new Promise((r) => setTimeout(r, 2500));
  await dumpDB(SCHEMA, "新增文件后");

  // ── 操作 3：再修改 ──
  console.log("\n── 再次修改 MEMORY.md（版本 2 → 版本 3）──");
  await fs.writeFile(
    path.join(tmpDir, "MEMORY.md"),
    "# 记忆\n\n版本 3：最终版本，迁移到了 Rust 重写核心模块。\n",
  );
  await new Promise((r) => setTimeout(r, 2500));
  await dumpDB(SCHEMA, "再次修改后");

  await manager.close();
  await fs.rm(tmpDir, { recursive: true, force: true });
  console.log("\n清理完毕。");
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
