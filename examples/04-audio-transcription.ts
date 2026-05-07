import { PgMemoryManager } from '../src/pg-memory-search-manager.js';
import { ZhipuEmbeddingProvider } from '../src/providers/zhipu.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

// Simple manual .env parsing to avoid dependency issues
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.join(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    const [key, value] = line.split('=');
    if (key && value) process.env[key.trim()] = value.trim();
  });
}

/**
 * Example: Audio Transcription & Search
 * This demo shows how pg-memo automatically transcribes audio files
 * using Xiaomi MiMo and makes them searchable with speaker labels.
 */
async function main() {
  const connectionString = process.env.PG_CONNECTION_STRING || "postgresql://postgres:123456@localhost:5432/postgres";
  const zhipuApiKey = process.env.ZHIPU_API_KEY;
  const xiaomiApiKey = process.env.XIAOMI_API_KEY;

  if (!zhipuApiKey || !xiaomiApiKey) {
    console.error("Please set ZHIPU_API_KEY and XIAOMI_API_KEY in .env");
    return;
  }

  // Use examples/fixtures for audio testing
  const workspaceDir = path.join(__dirname, 'fixtures');

  // 1. Initialize Manager with Audio Config
  const manager = new PgMemoryManager({
    connectionString,
    schema: "audio_test_final",
    workspaceDir,
    vectorDims: 2048, // Match Zhipu embedding-3
    embeddingProvider: new ZhipuEmbeddingProvider(zhipuApiKey),
    audio: {
      provider: 'mimo',
      apiKey: xiaomiApiKey,
      diarization: true,
      rootPath: path.join(workspaceDir, '.transcripts')
    }
  });

  console.log("--- pg-memo Audio Integration Demo ---");

  // 2. Prepare workspace and fixture
  const fixturePath = path.join(workspaceDir, 'podcast_fixture_5min.m4a');

  if (!fs.existsSync(fixturePath)) {
    console.error(`Fixture not found! Please ensure ${fixturePath} exists.`);
    return;
  }

  console.log(`Processing audio fixture: ${fixturePath}`);

  // 3. Sync the workspace
  console.log("Syncing workspace (this involves MiMo ASR call)...");
  await manager.sync();

  console.log("\n✅ Sync Complete! Let's try to search for something from the podcast.");

  // 4. Test Search
  const queries = [
    "比尔盖茨",
    "三个播客",
    "许哲"
  ];

  for (const query of queries) {
    console.log(`\n🔍 Searching for: "${query}"`);
    const results = await manager.search(query, { maxResults: 3, minScore: 0.1 }); 
    
    if (results.length === 0) {
      console.log("No results found.");
    }

    results.forEach((res, i) => {
      console.log(`[Result ${i + 1}] Score: ${res.score.toFixed(3)}`);
      console.log(`Source: ${res.path}`);
      console.log(`Content Snippet: ${res.snippet.trim().substring(0, 150)}...`);
    });
  }

  await manager.close();
}

main().catch(console.error);
