import { promises as fs } from 'node:fs';
import path from 'node:path';

/**
 * Structured run log.
 *
 * The original opened a `FileWriter` per line, appended a formatted string, and
 * wrapped the whole thing in `catch (Exception e) {}` — so log failures were
 * invisible and a partially written line could be the only trace of a fault.
 * Entries are appended as JSON lines here, and write failures surface.
 */

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogEntry {
  at: string;
  level: LogLevel;
  event: string;
  runNumber?: number;
  detail?: Record<string, unknown>;
}

export class RunLog {
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly dataDir: string,
    private readonly fileName = 'run.log.jsonl',
  ) {}

  private get file(): string {
    return path.join(this.dataDir, this.fileName);
  }

  /**
   * Append one entry. Writes are serialised through a promise chain so
   * concurrent callers cannot interleave partial lines.
   */
  append(level: LogLevel, event: string, detail?: Record<string, unknown>, runNumber?: number): Promise<void> {
    const entry: LogEntry = { at: new Date().toISOString(), level, event, runNumber, detail };
    const line = JSON.stringify(entry) + '\n';
    this.queue = this.queue.then(async () => {
      await fs.mkdir(this.dataDir, { recursive: true });
      await fs.appendFile(this.file, line, 'utf8');
    });
    return this.queue;
  }

  info = (event: string, detail?: Record<string, unknown>) => this.append('info', event, detail);
  warn = (event: string, detail?: Record<string, unknown>) => this.append('warn', event, detail);
  error = (event: string, detail?: Record<string, unknown>) => this.append('error', event, detail);

  /** Read back the most recent entries, newest last. */
  async tail(limit = 200): Promise<LogEntry[]> {
    try {
      const text = await fs.readFile(this.file, 'utf8');
      const lines = text.split('\n').filter((l) => l.trim() !== '');
      return lines.slice(-limit).flatMap((l) => {
        try {
          return [JSON.parse(l) as LogEntry];
        } catch {
          return [];
        }
      });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
  }

  /** Flush pending appends; call before shutting down. */
  flush(): Promise<void> {
    return this.queue;
  }
}
