import fs from "node:fs/promises";
import path from "node:path";
import { hashText, type ChunkConfig, chunkText } from "./chunk.js";
import type { FileEntry } from "../types.js";

const IGNORED_DIRS = new Set([
  ".git", "node_modules", ".pnpm-store", ".venv", "venv",
  ".tox", "__pycache__", "dist", "build",
]);

/**
 * Recursively find all .md files under a directory.
 */
export async function listMarkdownFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  await walkDir(dir, results);
  return results.sort();
}

async function walkDir(dir: string, results: string[]): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) {
        await walkDir(fullPath, results);
      }
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      results.push(fullPath);
    }
  }
}

/**
 * Read a single md file and produce a FileEntry with chunks.
 */
export async function readFileEntry(
  filePath: string,
  workspaceDir: string,
  chunkConfig?: ChunkConfig,
): Promise<FileEntry | null> {
  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch {
    return null;
  }
  if (!stat.isFile()) return null;

  const content = await fs.readFile(filePath, "utf-8");
  const relPath = path.relative(workspaceDir, filePath);
  // Normalize to forward slashes for cross-platform consistency
  const normalizedPath = relPath.replaceAll(path.sep, "/");

  const chunks = chunkText(content, normalizedPath, chunkConfig).map((c) => ({
    ...c,
    model: "", // will be set by the embedding provider
  }));

  return {
    path: normalizedPath,
    hash: hashText(content),
    mtime: Math.floor(stat.mtimeMs),
    size: stat.size,
    source: "memory" as const,
    chunks,
  };
}

/**
 * Scan a workspace directory and produce FileEntry[] for all md files.
 */
export async function scanWorkspace(
  workspaceDir: string,
  extraPaths: string[] = [],
  chunkConfig?: ChunkConfig,
): Promise<FileEntry[]> {
  const files: FileEntry[] = [];

  // Scan workspace dir
  const mdFiles = await listMarkdownFiles(workspaceDir);
  for (const f of mdFiles) {
    const entry = await readFileEntry(f, workspaceDir, chunkConfig);
    if (entry) files.push(entry);
  }

  // Scan extra paths
  for (const extra of extraPaths) {
    const resolved = path.resolve(workspaceDir, extra);
    let stat;
    try {
      stat = await fs.stat(resolved);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      const extraMd = await listMarkdownFiles(resolved);
      for (const f of extraMd) {
        const entry = await readFileEntry(f, workspaceDir, chunkConfig);
        if (entry) files.push(entry);
      }
    } else if (stat.isFile() && resolved.endsWith(".md")) {
      const entry = await readFileEntry(resolved, workspaceDir, chunkConfig);
      if (entry) files.push(entry);
    }
  }

  return files;
}

/**
 * Read a single file by path (for incremental sync of a changed file).
 */
export async function readSingleFile(
  filePath: string,
  workspaceDir: string,
  chunkConfig?: ChunkConfig,
): Promise<FileEntry | null> {
  return readFileEntry(filePath, workspaceDir, chunkConfig);
}
