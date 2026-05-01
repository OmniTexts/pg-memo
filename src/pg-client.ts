import pg from "pg";
import type { PgMemoryConfig } from "./types.js";

const { Pool } = pg;

export type PgPool = pg.Pool;
export type PgClient = pg.PoolClient;

/** Create a connection pool and ensure the target schema exists */
export async function createPgPool(config: PgMemoryConfig): Promise<PgPool> {
  const pool = new Pool({
    connectionString: config.connectionString,
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });

  // Verify connectivity
  const client = await pool.connect();
  try {
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${quoteIdent(config.schema)}`);
    await client.query(`SET search_path TO ${quoteIdent(config.schema)}, public`);
  } finally {
    client.release();
  }

  return pool;
}

/** Acquire a client with search_path set to the agent's schema */
export async function acquireWithSchema(
  pool: PgPool,
  schema: string,
): Promise<PgClient> {
  const client = await pool.connect();
  await client.query(`SET search_path TO ${quoteIdent(schema)}, public`);
  return client;
}

/** Simple identifier quoting to prevent injection */
export function quoteIdent(name: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new Error(`Invalid identifier: ${name}`);
  }
  return `"${name}"`;
}
