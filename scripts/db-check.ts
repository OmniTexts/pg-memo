import { PgMemoryManager } from "../src/index.js";

const connectionString = process.env.PG_CONNECTION_STRING ?? "postgresql://postgres:postgres@localhost:5432/postgres";

async function main() {
  console.log("Connecting to:", connectionString.replace(/:[^@]+@/, ":***@"));

  const manager = new PgMemoryManager({
    connectionString,
    schema: "memory_test",
    hybridEnabled: true,
    vectorEnabled: true,
  });

  console.log("Syncing schema...");
  await manager.sync({ force: true });

  const status = manager.status();
  console.log("\nStatus:", JSON.stringify(status, null, 2));

  console.log("\nProbing embedding...");
  const probe = await manager.probeEmbeddingAvailability();
  console.log("Embedding probe:", probe);

  console.log("\nProbing vector...");
  const vecOk = await manager.probeVectorAvailability();
  console.log("Vector available:", vecOk);

  await manager.close();
  console.log("\nDone.");
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
