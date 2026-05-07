import fs from "node:fs/promises";
import path from "node:path";
import { hashText, makeChunkId, type ChunkConfig, chunkText, chunkMarkdown } from "./chunk.js";
import type { FileEntry, FileReader } from "../types.js";
import { buildReaderMap, getReader, DEFAULT_EXTENSIONS } from "../sync/index.js";
import { tokenizeForFts } from "./tokenizer.js";

const IGNORED_DIRS = new Set([
  ".git", "node_modules", ".pnpm-store", ".venv", "venv",
  ".tox", "__pycache__", "dist", "build",
]);

/**
 * Recursively find all files matching the given extensions under a directory.
 */
export async function listFiles(
  dir: string,
  extensions: Set<string>,
): Promise<string[]> {
  const results: string[] = [];
  await walkDir(dir, results, extensions);
  return results.sort();
}

/**
 * Recursively find all .md files under a directory.
 * Kept for backward compatibility.
 */
export async function listMarkdownFiles(dir: string): Promise<string[]> {
  return listFiles(dir, new Set([".md"]));
}

async function walkDir(
  dir: string,
  results: string[],
  extensions: Set<string>,
): Promise<void> {
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
        await walkDir(fullPath, results, extensions);
      }
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (extensions.has(ext)) {
        results.push(fullPath);
      }
    }
  }
}

/**
 * Read a single file using the appropriate reader and produce a FileEntry with chunks.
 */
export async function readFileEntry(
  filePath: string,
  workspaceDir: string,
  chunkConfig: ChunkConfig,
  readerMap?: Map<string, FileReader>,
  options?: { media?: any; audio?: any }
): Promise<FileEntry | null> {
  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch {
    return null;
  }
  if (!stat.isFile()) return null;

  let content: string;
  let metadata: Record<string, any> | undefined;
  const ext = path.extname(filePath).toLowerCase();

  if (readerMap) {
    const reader = getReader(ext, readerMap);
    if (!reader) return null;
    try {
      const result = await reader.read(filePath, workspaceDir, chunkConfig, options);
      content = result.content;
      metadata = result.metadata;
    } catch (err) {
      console.warn(`[pg-memo] Failed to read ${filePath}: ${err}`);
      return null;
    }
  } else {
    // Fallback: plain text read (backward compat)
    content = await fs.readFile(filePath, "utf-8");
  }

  const relPath = path.relative(workspaceDir, filePath);
  // Normalize to forward slashes for cross-platform consistency
  const normalizedPath = relPath.replaceAll(path.sep, "/");

  // Use heading-aware chunking for structured formats
  const useHeadingChunk = ext === ".md" || ext === ".mdx" || ext === ".docx";
  const chunker = useHeadingChunk ? chunkMarkdown : chunkText;
  const chunks = chunker(content, chunkConfig);

  return {
    path: normalizedPath,
    content,
    hash: hashText(content),
    mtime: Math.floor(stat.mtimeMs),
    size: stat.size,
    source: "memory" as const,
    metadata,
    chunks: chunks.map((c, i) => ({
      id: makeChunkId(normalizedPath, c.startLine, c.endLine),
      path: normalizedPath,
      source: "memory" as const,
      text: c.text,
      startLine: c.startLine,
      endLine: c.endLine,
      hash: hashText(c.text),
      model: "",
    })),
  };
}

/**
 * Scan a workspace directory and produce FileEntry[] for all supported files.
 */
export async function scanWorkspace(
  workspaceDir: string,
  extraPaths: string[] = [],
  chunkConfig: ChunkConfig,
  options?: {
    extensions?: string[];
    readers?: FileReader[];
    media?: any;
    audio?: any;
  },
): Promise<FileEntry[]> {
  const exts = options?.extensions ?? DEFAULT_EXTENSIONS;
  const extSet = new Set(exts.map((e) => (e.startsWith(".") ? e : `.${e}`)));
  const readerMap = buildReaderMap(options?.readers ?? []);

  const entries: FileEntry[] = [];

  // Scan workspace dir
  console.log(`[scanWorkspace] Scanning ${workspaceDir} for extensions: ${[...extSet].join(', ')}`);
  const found = await listFiles(workspaceDir, extSet);
  console.log(`[scanWorkspace] Found ${found.length} files total.`);
  for (const f of found) {
    console.log(`[scanWorkspace] Processing: ${f}`);
    const entry = await readFileEntry(f, workspaceDir, chunkConfig, readerMap, {
      media: options?.media,
      audio: options?.audio,
    });
    if (entry) entries.push(entry);
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
      const extraFound = await listFiles(resolved, extSet);
      for (const f of extraFound) {
        const entry = await readFileEntry(f, workspaceDir, chunkConfig, readerMap, options);
        if (entry) entries.push(entry);
      }
    } else if (stat.isFile()) {
      const ext = path.extname(resolved).toLowerCase();
      if (extSet.has(ext)) {
        const entry = await readFileEntry(resolved, workspaceDir, chunkConfig, readerMap, options);
        if (entry) entries.push(entry);
      }
    }
  }

  return entries;
}

/**
 * Read a single file by path (for incremental sync of a changed file).
 */
export async function readSingleFile(
  filePath: string,
  workspaceDir: string,
  chunkConfig: ChunkConfig = { tokens: 400, overlap: 80 },
  readers?: FileReader[],
  options?: { media?: any; audio?: any }
): Promise<FileEntry | null> {
  const readerMap = readers ? buildReaderMap(readers) : undefined;
  return readFileEntry(filePath, workspaceDir, chunkConfig, readerMap, options);
}
