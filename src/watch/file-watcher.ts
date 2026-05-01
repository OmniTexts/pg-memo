import path from "node:path";
import chokidar, { type FSWatcher } from "chokidar";
import { readSingleFile } from "../utils/file-reader.js";
import type { FileEntry, ChunkConfig } from "../types.js";

const IGNORED_DIRS = new Set([
  ".git", "node_modules", ".pnpm-store", ".venv", "venv",
  ".tox", "__pycache__", "dist", "build",
]);

export type FileWatcherOptions = {
  /** Workspace directory to watch */
  workspaceDir: string;
  /** Additional paths to watch */
  extraPaths?: string[];
  /** Debounce delay in ms after file change before syncing */
  debounceMs?: number;
  /** Interval in minutes for periodic full sync (0 = disabled) */
  intervalMinutes?: number;
  /** Chunking config */
  chunkConfig?: ChunkConfig;
  /** Callback when files are ready to sync */
  onSync: (files: FileEntry[], reason: string, deleted?: string[]) => Promise<void>;
  /** Logger */
  log?: (level: string, msg: string) => void;
};

/**
 * Watches a workspace directory for markdown file changes.
 * Handles debouncing, dirty tracking, and periodic sync.
 */
export class FileWatcher {
  private watcher: FSWatcher | null = null;
  private intervalTimer: ReturnType<typeof setInterval> | null = null;
  private dirtyFiles = new Set<string>();
  private deletedFiles = new Set<string>();
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private syncing = false;
  private closed = false;

  private readonly opts: Required<
    Pick<FileWatcherOptions, "workspaceDir" | "extraPaths" | "debounceMs" | "intervalMinutes" | "onSync" | "log">
  > &
    FileWatcherOptions;

  constructor(opts: FileWatcherOptions) {
    this.opts = {
      workspaceDir: opts.workspaceDir,
      extraPaths: opts.extraPaths ?? [],
      debounceMs: opts.debounceMs ?? 1500,
      intervalMinutes: opts.intervalMinutes ?? 0,
      chunkConfig: opts.chunkConfig,
      onSync: opts.onSync,
      log: opts.log ?? (() => {}),
    };
  }

  /** Start watching for file changes and optionally periodic sync */
  start(): void {
    if (this.watcher) return;

    const watchPaths: string[] = [this.opts.workspaceDir];
    for (const extra of this.opts.extraPaths) {
      watchPaths.push(path.resolve(this.opts.workspaceDir, extra));
    }

    // Build ignore globs from IGNORED_DIRS
    const ignoreGlobs: string[] = [];
    for (const dir of IGNORED_DIRS) {
      ignoreGlobs.push(`**/${dir}/**`);
    }

    this.watcher = chokidar.watch(watchPaths, {
      ignoreInitial: true,
      usePolling: true,
      interval: 500,
      ignored: ignoreGlobs,
      awaitWriteFinish: {
        stabilityThreshold: this.opts.debounceMs,
        pollInterval: 100,
      },
    });

    const markDirty = (filePath: string) => {
      if (this.closed) return;
      if (!filePath.endsWith(".md")) return;
      // Normalize to workspace-relative path
      const relPath = path
        .relative(this.opts.workspaceDir, filePath)
        .replaceAll(path.sep, "/");
      this.dirtyFiles.add(relPath);
      this.scheduleSync();
    };

    this.watcher.on("add", markDirty);
    this.watcher.on("change", markDirty);
    this.watcher.on("unlink", (filePath) => {
      if (this.closed) return;
      if (!filePath.endsWith(".md")) return;
      const relPath = path
        .relative(this.opts.workspaceDir, filePath)
        .replaceAll(path.sep, "/");
      this.deletedFiles.add(relPath);
      this.scheduleSync();
    });

    this.opts.log("info", `Watching ${watchPaths.length} paths for .md changes`);

    // Periodic sync
    if (this.opts.intervalMinutes > 0) {
      const ms = this.opts.intervalMinutes * 60 * 1000;
      this.intervalTimer = setInterval(() => {
        this.runFullSync("interval");
      }, ms);
      this.opts.log("info", `Periodic sync every ${this.opts.intervalMinutes} min`);
    }
  }

  /** Stop watching */
  async stop(): Promise<void> {
    this.closed = true;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
  }

  /** Manually trigger a full sync of all md files */
  async runFullSync(reason = "manual"): Promise<void> {
    if (this.syncing) return;
    this.syncing = true;
    try {
      const { scanWorkspace } = await import("../utils/file-reader.js");
      const files = await scanWorkspace(
        this.opts.workspaceDir,
        this.opts.extraPaths,
        this.opts.chunkConfig,
      );
      this.dirtyFiles.clear();
      this.deletedFiles.clear();
      await this.opts.onSync(files, reason);
    } catch (err) {
      this.opts.log("error", `Full sync failed (${reason}): ${String(err)}`);
    } finally {
      this.syncing = false;
      if (this.dirtyFiles.size > 0 || this.deletedFiles.size > 0) this.scheduleSync();
    }
  }

  private scheduleSync(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.flushDirty();
    }, this.opts.debounceMs);
  }

  private async flushDirty(): Promise<void> {
    const hasChanges = this.dirtyFiles.size > 0 || this.deletedFiles.size > 0;
    if (!hasChanges || this.syncing) return;

    const filesToSync = Array.from(this.dirtyFiles);
    const filesToDelete = Array.from(this.deletedFiles);
    this.dirtyFiles.clear();
    this.deletedFiles.clear();
    this.syncing = true;

    try {
      // Read only the changed files
      const entries: FileEntry[] = [];
      for (const relPath of filesToSync) {
        const absPath = path.join(this.opts.workspaceDir, relPath);
        const entry = await readSingleFile(
          absPath,
          this.opts.workspaceDir,
          this.opts.chunkConfig,
        );
        if (entry) entries.push(entry);
      }
      if (entries.length > 0 || filesToDelete.length > 0) {
        await this.opts.onSync(entries, "watch", filesToDelete);
      }
    } catch (err) {
      this.opts.log("error", `Watch sync failed: ${String(err)}`);
    } finally {
      this.syncing = false;
    }
  }
}
