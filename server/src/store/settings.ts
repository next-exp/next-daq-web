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
  /**
   * The values last successfully applied, per panel.
   *
   * Edits are recorded as you type, so "what is in the panel" and "what the cards
   * were last told" are different things. Keeping both lets the console show which
   * channels are actually enabled and flag a panel whose edits have not been sent.
   *
   * This is the last commanded state, not a hardware readback — a card that was
   * power-cycled since will not reflect it.
   */
  private applied: SettingsMap = {};
  private appliedAt: Record<string, string> = {};

  /**
   * Per-channel overrides for grid panels, keyed by panel then "cardIndex:channel".
   *
   * Channels are configured independently — the Swing UI gave each one its own row
   * of spinners — so a panel-level value is only a starting point that individual
   * channels override.
   */
  private channels: Record<string, Record<string, Params>> = {};

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
      } else if (spec.kind === 'grid') {
        // Rows depend on the configured topology, so an unset grid is empty and
        // the console fills it in once it knows the card list.
        out[spec.name] = [];
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

  /** Stored overrides for one panel, keyed "cardIndex:channel". */
  channelValues(actionId: string): Record<string, Params> {
    return this.channels[actionId] ?? {};
  }

  /** Values in force for one channel: the panel defaults with its overrides applied. */
  channelValue(actionId: string, key: string): Params {
    return { ...this.get(actionId), ...(this.channels[actionId]?.[key] ?? {}) };
  }

  /** Apply an edit to every named channel. */
  setChannels(actionId: string, keys: string[], params: Params): void {
    getAction(actionId);
    const map = (this.channels[actionId] ??= {});
    for (const key of keys) {
      if (!/^\d+:\d+$/.test(key)) throw new Error(`Invalid channel key "${key}"`);
      map[key] = { ...map[key], ...params };
    }
  }

  /** Record the values that actually reached the cards. */
  markApplied(actionId: string, params: Params): void {
    getAction(actionId);
    this.applied[actionId] = { ...params };
    this.appliedAt[actionId] = new Date().toISOString();
  }

  /**
   * Forget which panels have been applied.
   *
   * A reset clears the cards' configured state, so what the console previously
   * sent no longer describes the hardware. The original did the same, zeroing its
   * setup flags in RST SOFT and disabling Start Run.
   */
  clearApplied(): void {
    this.applied = {};
    this.appliedAt = {};
  }

  /** Values last applied for one panel, or undefined if it has never been applied. */
  getApplied(actionId: string): { params: Params; at: string } | undefined {
    const params = this.applied[actionId];
    return params ? { params, at: this.appliedAt[actionId] } : undefined;
  }

  /** Panels whose current values differ from what was last applied. */
  pendingPanels(): string[] {
    return ALL_ACTIONS.filter((a) => {
      const applied = this.applied[a.id];
      if (!applied) return Object.keys(this.settings[a.id] ?? {}).length > 0;
      return JSON.stringify(this.get(a.id)) !== JSON.stringify({ ...this.get(a.id), ...applied });
    }).map((a) => a.id);
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
      const raw = JSON.parse(await fs.readFile(this.file, 'utf8')) as Record<string, unknown>;
      // Older files held the settings map directly, with no applied history.
      if (raw && typeof raw === 'object' && 'settings' in raw) {
        this.settings = (raw.settings as SettingsMap) ?? {};
        this.applied = (raw.applied as SettingsMap) ?? {};
        this.appliedAt = (raw.appliedAt as Record<string, string>) ?? {};
        this.channels = (raw.channels as Record<string, Record<string, Params>>) ?? {};
      } else {
        this.settings = (raw as SettingsMap) ?? {};
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }

  async saveToDisk(): Promise<void> {
    await fs.mkdir(this.dataDir, { recursive: true });
    const tmp = `${this.file}.tmp`;
    const payload = {
      settings: this.settings,
      applied: this.applied,
      appliedAt: this.appliedAt,
      channels: this.channels,
    };
    await fs.writeFile(tmp, JSON.stringify(payload, null, 2), 'utf8');
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
            spec.kind === 'mask' || spec.kind === 'grid'
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

        if (spec.kind === 'grid') {
          if (!/^[01]*$/.test(raw)) {
            skipped.push(`${keyFor(action.id, spec.name)}: not a 0/1 grid`);
            continue;
          }
          params[spec.name] = [...raw].map((c) => c === '1');
        } else if (spec.kind === 'mask') {
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
