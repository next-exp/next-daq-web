import { promises as fs } from 'node:fs';
import path from 'node:path';

/**
 * Reading and writing the detector configuration files.
 *
 * The format is the one the Java produced: `AddConfig.main(line, value)` wrote
 * `line + value` followed by a blank line, where `line` always ended in a colon
 * and could itself contain colons — for example
 * `"BF FEC 1 BFs TRG A:" + channelName + " selected TRG 1:"`. A key is therefore
 * everything before the final colon, and the value everything after it.
 */

export type ConfigMap = Map<string, string>;

export interface ParsedConfig {
  entries: ConfigMap;
  /** Lines that could not be parsed, with their 1-based line numbers. */
  malformed: { line: number; text: string }[];
}

export function parseConfig(text: string): ParsedConfig {
  const entries: ConfigMap = new Map();
  const malformed: { line: number; text: string }[] = [];

  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (line === '') return;
    const idx = line.lastIndexOf(':');
    if (idx <= 0) {
      malformed.push({ line: i + 1, text: line });
      return;
    }
    entries.set(line.slice(0, idx), line.slice(idx + 1));
  });

  return { entries, malformed };
}

/** Serialise back to the on-disk format, including the trailing blank lines. */
export function serialiseConfig(entries: ConfigMap): string {
  let out = '';
  for (const [key, value] of entries) out += `${key}:${value}\n\n`;
  return out;
}

export class ConfigStore {
  constructor(private readonly dataDir: string) {}

  private resolve(name: string): string {
    // Keep reads and writes inside the data directory regardless of the name given.
    const safe = path.basename(name);
    if (safe !== name || safe.startsWith('.')) {
      throw new Error(`Invalid configuration name "${name}"`);
    }
    return path.join(this.dataDir, safe);
  }

  async list(): Promise<string[]> {
    await fs.mkdir(this.dataDir, { recursive: true });
    const files = await fs.readdir(this.dataDir);
    return files.filter((f) => f.endsWith('.txt')).sort();
  }

  async load(name: string): Promise<ParsedConfig> {
    return parseConfig(await fs.readFile(this.resolve(name), 'utf8'));
  }

  async save(name: string, entries: ConfigMap): Promise<void> {
    await fs.mkdir(this.dataDir, { recursive: true });
    const target = this.resolve(name);
    // Write to a temporary file and rename, so an interrupted save cannot leave a
    // half-written configuration in place of a good one.
    const tmp = `${target}.tmp`;
    await fs.writeFile(tmp, serialiseConfig(entries), 'utf8');
    await fs.rename(tmp, target);
  }
}

/**
 * PMT/SiPM gain table, as shipped in `gains.txt`: a tab-separated file with the
 * header `MinRun SensorID ElecID Gain`.
 */
export interface GainRow {
  minRun: number;
  sensorId: number;
  elecId: number;
  gain: number;
}

export function parseGains(text: string): GainRow[] {
  const rows: GainRow[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === '') continue;
    const parts = line.split(/\s+/);
    if (parts[0] === 'MinRun') continue; // header
    if (parts.length < 4) throw new Error(`gains: line ${i + 1} has ${parts.length} columns, expected 4`);
    const [minRun, sensorId, elecId, gain] = parts.map(Number);
    if ([minRun, sensorId, elecId, gain].some((n) => Number.isNaN(n))) {
      throw new Error(`gains: line ${i + 1} contains a non-numeric field`);
    }
    rows.push({ minRun, sensorId, elecId, gain });
  }
  return rows;
}

/** Gain for one sensor at a given run, taking the latest applicable MinRun. */
export function gainFor(rows: GainRow[], sensorId: number, run: number): number | undefined {
  let best: GainRow | undefined;
  for (const r of rows) {
    if (r.sensorId !== sensorId || r.minRun > run) continue;
    if (!best || r.minRun > best.minRun) best = r;
  }
  return best?.gain;
}
