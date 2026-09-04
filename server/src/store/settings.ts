import { promises as fs } from 'node:fs';
import path from 'node:path';
import { ALL_ACTIONS, getAction, type Params } from '@next-daq/shared';

/**
 * The current configuration: the parameter values held by every operator panel.
 *
 * The original tracked this as hundreds of Swing widgets read back on demand, with
 * a "Save Configuration" checkbox that appended each setting to a file as it was
 * applied — so the saved file reflected whatever had been pressed, not the state of
 * the panels. Here the values are the source of truth, held server-side so they
 * survive a browser reload, and a save writes all of them at once.
 */

/** A setting key in the saved file: `<panel id>:<parameter>`. */
const keyFor = (actionId: string, param: string): string => `${actionId}:${param}`;

export type SettingsMap = Record<string, Params>;

export class SettingsStore {
  private settings: SettingsMap = {};

  constructor(private readonly dataDir: string) {}

  private get file(): string {
    return path.join(this.dataDir, 'current-settings.json');
  }

  /** Values for one panel, falling back to its declared defaults. */
  get(actionId: string): Params {
    const action = getAction(actionId);
    const stored = this.settings[actionId] ?? {};
    const out: Params = {};
    for (const spec of action.params) {
      if (spec.name in stored) {
        out[spec.name] = stored[spec.name];
      } else if (spec.kind === 'mask') {
        out[spec.name] = new Array(spec.count).fill(false);
      } else if (spec.kind === 'coefArray') {
        out[spec.name] = [0, 0];
      } else if (spec.kind === 'bool') {
        out[spec.name] = spec.default ?? false;
      } else {
        out[spec.name] = spec.default ?? 0;
      }
    }
    return out;
  }

  all(): SettingsMap {
    return Object.fromEntries(ALL_ACTIONS.map((a) => [a.id, this.get(a.id)]));
  }

  set(actionId: string, params: Params): void {
    getAction(actionId); // reject an unknown panel rather than storing junk
    this.settings[actionId] = { ...this.settings[actionId], ...params };
  }

  replaceAll(settings: SettingsMap): void {
    this.settings = {};
    for (const [id, params] of Object.entries(settings)) {
      try {
        this.set(id, params);
      } catch {
        // A panel that no longer exists is skipped rather than failing the load.
      }
    }
  }

  /* ------------------------------------------------------- file persistence */

  async loadFromDisk(): Promise<void> {
    try {
      this.settings = JSON.parse(await fs.readFile(this.file, 'utf8')) as SettingsMap;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }

  async saveToDisk(): Promise<void> {
    await fs.mkdir(this.dataDir, { recursive: true });
    const tmp = `${this.file}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(this.settings, null, 2), 'utf8');
    await fs.rename(tmp, this.file);
  }

  /* ------------------------------------------------- Config.txt conversion */

  /**
   * Flatten the current settings into the `key:value` form used by the detector
   * configuration files, so a saved setup is readable and diffable.
   *
   * Masks are written as a run of 0/1 characters, one per channel, matching how the
   * original recorded them ("SiPM sensor connected mask:1111...").
   */
  toEntries(): Map<string, string> {
    const out = new Map<string, string>();
    for (const action of ALL_ACTIONS) {
      const values = this.get(action.id);
      for (const spec of action.params) {
        const v = values[spec.name];
        let text: string;
        if (Array.isArray(v)) {
          text =
            spec.kind === 'mask'
              ? (v as boolean[]).map((b) => (b ? '1' : '0')).join('')
              : (v as number[]).join(',');
        } else if (typeof v === 'boolean') {
          text = v ? '1' : '0';
        } else {
          text = String(v);
        }
        out.set(keyFor(action.id, spec.name), text);
      }
    }
    return out;
  }

  /**
   * Restore settings from a parsed configuration file.
   * Returns what was applied and what could not be, rather than failing silently.
   */
  fromEntries(entries: Map<string, string>): { applied: number; skipped: string[] } {
    const skipped: string[] = [];
    let applied = 0;

    for (const action of ALL_ACTIONS) {
      const params: Params = {};
      for (const spec of action.params) {
        const raw = entries.get(keyFor(action.id, spec.name));
        if (raw === undefined) continue;

        if (spec.kind === 'mask') {
          if (!/^[01]*$/.test(raw)) {
            skipped.push(`${keyFor(action.id, spec.name)}: not a 0/1 mask`);
            continue;
          }
          const bits = new Array(spec.count).fill(false);
          for (let i = 0; i < Math.min(spec.count, raw.length); i++) bits[i] = raw[i] === '1';
          params[spec.name] = bits;
        } else if (spec.kind === 'coefArray') {
          const nums = raw.split(',').map(Number);
          if (nums.some(Number.isNaN)) {
            skipped.push(`${keyFor(action.id, spec.name)}: not a number list`);
            continue;
          }
          params[spec.name] = nums;
        } else if (spec.kind === 'bool') {
          params[spec.name] = raw === '1' || raw.toLowerCase() === 'true';
        } else {
          const n = Number(raw);
          if (Number.isNaN(n)) {
            skipped.push(`${keyFor(action.id, spec.name)}: "${raw}" is not a number`);
            continue;
          }
          params[spec.name] = n;
        }
        applied++;
      }
      if (Object.keys(params).length > 0) this.set(action.id, params);
    }

    return { applied, skipped };
  }
}
