/**
 * 文件监控演示脚本
 *
 * 用法：
 *   PG_CONNECTION_STRING="postgresql://postgres:123456@localhost:5432/postgres" \
 *   pnpm tsx scripts/demo-watch.ts
 *
 * 启动后：
 *   1. 自动扫描 workspace 下所有 md 文件并写入 PG
 *   2. 开始监控文件变化
 *   3. 你可以去修改 workspace 下的任意 md 文件
 *   4. 终端会打印数据库变化
 *   5. 按 Ctrl+C 退出
 */

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { PgMemoryManager } from "../src/pg-memory-search-manager.js";
import type { EmbeddingProvider } from "../src/types.js";

const PG_URL = process.env.PG_CONNECTION_STRING ?? "postgresql://postgres:123456@localhost:5432/postgres";
const SCHEMA = "demo_watch";

// ── 模拟 embedding provider（用于测试，生产环境换成真实的）──
class DemoEmbeddingProvider implements EmbeddingProvider {
  readonly id = "demo";
  readonly model = "demo-model";
  private readonly dims = 256;

  async embedQuery(text: string): Promise<number[]> {
    return this.hashToVec(text);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return texts.map((t) => this.hashToVec(t));
  }

  private hashToVec(text: string): number[] {
    const vec = new Array(this.dims).fill(0);
    for (let i = 0; i < text.length; i++) {
      vec[i % this.dims] += text.charCodeAt(i) / 65535;
    }
    const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
    return vec.map((v) => v / norm);
  }
}

async function queryDB(schema: string): Promise<void> {
  const { createPgPool } = await import("../src/pg-client.js");
  const pool = await createPgPool({ connectionString: PG_URL, schema });
  const client = await pool.connect();
  try {
    const files = await client.query("SELECT path, hash FROM files ORDER BY path");
    const chunks = await client.query(
      "SELECT path, start_line, end_line, left(text, 60) AS preview FROM chunks ORDER BY path, start_line",
    );
    console.log("\n── 当前数据库状态 ──");
    console.log(`files (${files.rows.length}):`);
    for (const r of files.rows) console.log(`  ${r.path}  hash=${r.hash.slice(0, 12)}...`);
    console.log(`chunks (${chunks.rows.length}):`);
    for (const r of chunks.rows)
      console.log(`  ${r.path}:${r.start_line}-${r.end_line}  "${r.preview.trim()}"`);
  } finally {
    client.release();
    await pool.end();
  }
}

async function main() {
  // 创建临时 workspace
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pg-memo-demo-"));
  console.log(`Workspace: ${tmpDir}\n`);

  await fs.writeFile(
    path.join(tmpDir, "MEMORY.md"),
    "# 项目记忆\n\n这是一个 AI agent 项目。\n使用 TypeScript 和 PostgreSQL。\n",
  );
  const memoryDir = path.join(tmpDir, "memory");
  await fs.mkdir(memoryDir, { recursive: true });
  await fs.writeFile(
    path.join(memoryDir, "技术栈.md"),
    "# 技术栈\n\n- Node.js 22\n- PostgreSQL 16\n- pgvector\n",
  );

  // 清理旧 schema
  const { createPgPool } = await import("../src/pg-client.js");
  const pool = await createPgPool({ connectionString: PG_URL, schema: SCHEMA });
  const c = await pool.connect();
  await c.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  c.release();
  await pool.end();

  // 创建 manager 并启动监控
  const manager = new PgMemoryManager({
    connectionString: PG_URL,
    schema: SCHEMA,
    workspaceDir: tmpDir,
    embeddingProvider: new DemoEmbeddingProvider(),
    hybridEnabled: true,
    vectorEnabled: true,
    vectorDims: 256,
    sync: { watch: true, debounceMs: 1000, intervalMinutes: 0 },
  });

  console.log("启动监控...\n");
  await manager.startWatching();

  // 显示初始数据库状态
  await queryDB(SCHEMA);

  console.log("\n── 现在可以去修改文件了 ──");
  console.log(`  ${tmpDir}/MEMORY.md`);
  console.log(`  ${tmpDir}/memory/技术栈.md`);
  console.log(`  或者在 ${tmpDir}/memory/ 下新建 .md 文件`);
  console.log("\n等待文件变化...\n");

  // 监控变化并展示
  let lastHash = "";
  setInterval(async () => {
    await queryDB(SCHEMA);
  }, 5000);

  // 优雅退出
  process.on("SIGINT", async () => {
    console.log("\n\n停止监控...");
    await manager.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
    console.log("已清理，退出。");
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
