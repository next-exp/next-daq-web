import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { ALL_ACTIONS } from '@next-daq/shared';
import { SettingsStore } from '../src/store/settings.js';
import { parseConfig, serialiseConfig } from '../src/store/config.js';

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'next-settings-'));
afterAll(() => fs.rm(tmp, { recursive: true, force: true }));

const boards = (...ids: number[]) => {
  const m = new Array(56).fill(false);
  for (const i of ids) m[i] = true;
  return m;
};

describe('current configuration', () => {
  it('falls back to each panel’s declared defaults', () => {
    const s = new SettingsStore(tmp);
    // run.general defaults to a 1300 µs buffer, matching the Java's 52000 samples.
    expect(s.get('run.general').buffer_us).toBe(1300);
  });

  it('remembers values set for a panel', () => {
    const s = new SettingsStore(tmp);
    s.set('run.general', { buffer_us: 2000 });
    expect(s.get('run.general').buffer_us).toBe(2000);
    // Untouched parameters keep their defaults.
    expect(s.get('run.general').pretrigger_us).toBe(650);
  });

  it('rejects an unknown panel rather than storing junk', () => {
    const s = new SettingsStore(tmp);
    expect(() => s.set('nope.missing', { x: 1 })).toThrow(/Unknown configuration action/);
  });

  it('covers every panel in a full snapshot', () => {
    const s = new SettingsStore(tmp);
    expect(Object.keys(s.all()).sort()).toEqual(ALL_ACTIONS.map((a) => a.id).sort());
  });
});

describe('saving and restoring', () => {
  it('round-trips settings through the key:value file format', () => {
    const a = new SettingsStore(tmp);
    a.set('run.general', { buffer_us: 2400, pretrigger_us: 1200, mode: 3 });
    a.set('sipm.led', { calon: true, boards: boards(0, 7, 42) });
    a.set('pmt.blr', { mau_size: 512, timetoabort_us: 100 });

    // Through the same serialiser the detector config files use.
    const text = serialiseConfig(a.toEntries());
    const b = new SettingsStore(tmp);
    const result = b.fromEntries(parseConfig(text).entries);

    expect(result.skipped).toEqual([]);
    expect(result.applied).toBeGreaterThan(0);
    expect(b.get('run.general')).toMatchObject({ buffer_us: 2400, pretrigger_us: 1200, mode: 3 });
    expect(b.get('pmt.blr')).toMatchObject({ mau_size: 512, timetoabort_us: 100 });
    expect(b.get('sipm.led').calon).toBe(true);
    expect(b.get('sipm.led').boards).toEqual(boards(0, 7, 42));
  });

  it('writes masks as a readable run of 0s and 1s', () => {
    const s = new SettingsStore(tmp);
    s.set('sipm.led', { boards: boards(0, 2) });
    expect(s.toEntries().get('sipm.led:boards')).toBe('101' + '0'.repeat(53));
  });

  it('writes booleans as 1 and 0', () => {
    const s = new SettingsStore(tmp);
    s.set('sipm.led', { calon: true, train_on: false });
    expect(s.toEntries().get('sipm.led:calon')).toBe('1');
    expect(s.toEntries().get('sipm.led:train_on')).toBe('0');
  });

  it('round-trips every panel with no loss', () => {
    const a = new SettingsStore(tmp);
    // Give every numeric parameter a distinct non-default value.
    let n = 1;
    for (const action of ALL_ACTIONS) {
      const params: Record<string, unknown> = {};
      for (const spec of action.params) {
        if (spec.kind === 'int') params[spec.name] = Math.min(spec.max, spec.min + (n++ % 7) + 1);
        else if (spec.kind === 'bool') params[spec.name] = n++ % 2 === 0;
        else if (spec.kind === 'mask')
          params[spec.name] = Array.from({ length: spec.count }, (_, i) => i % 3 === 0);
      }
      a.set(action.id, params as never);
    }
    const b = new SettingsStore(tmp);
    b.fromEntries(parseConfig(serialiseConfig(a.toEntries())).entries);
    expect(b.all()).toEqual(a.all());
  });

  it('reports values it could not read instead of dropping them silently', () => {
    const s = new SettingsStore(tmp);
    const r = s.fromEntries(
      new Map([
        ['run.general:buffer_us', 'not-a-number'],
        ['sipm.led:boards', 'xyz'],
        ['run.general:mode', '2'],
      ]),
    );
    expect(r.applied).toBe(1);
    expect(r.skipped).toHaveLength(2);
    expect(r.skipped[0]).toMatch(/buffer_us/);
    expect(s.get('run.general').mode).toBe(2);
  });

  it('ignores settings for a panel that no longer exists', () => {
    const s = new SettingsStore(tmp);
    expect(() => s.replaceAll({ 'gone.panel': { x: 1 }, 'run.general': { mode: 4 } })).not.toThrow();
    expect(s.get('run.general').mode).toBe(4);
  });

  it('pads a mask that is shorter than the panel expects', () => {
    const s = new SettingsStore(tmp);
    s.fromEntries(new Map([['sipm.led:boards', '11']]));
    const m = s.get('sipm.led').boards as boolean[];
    expect(m).toHaveLength(56);
    expect(m.slice(0, 3)).toEqual([true, true, false]);
  });
});

describe('persistence across restarts', () => {
  it('reloads the settings written to disk', async () => {
    const dir = await fs.mkdtemp(path.join(tmp, 'restart-'));
    const a = new SettingsStore(dir);
    a.set('run.general', { buffer_us: 3000 });
    await a.saveToDisk();

    const b = new SettingsStore(dir);
    await b.loadFromDisk();
    expect(b.get('run.general').buffer_us).toBe(3000);
  });

  it('starts from defaults when nothing has been saved', async () => {
    const dir = await fs.mkdtemp(path.join(tmp, 'fresh-'));
    const s = new SettingsStore(dir);
    await expect(s.loadFromDisk()).resolves.toBeUndefined();
    expect(s.get('run.general').buffer_us).toBe(1300);
  });
});

/** A fresh store per assertion, so one test cannot leak state into another. */
const store = () => new SettingsStore(tmp);

describe('unapplied changes', () => {
  /**
   * A panel can be edited without being sent, and nothing in the console said so.
   * "Pending" is the difference between what the panel holds and what was last
   * applied — including its per-channel values.
   */
  it('is not pending before anything is edited', () => {
    // Otherwise every panel would be flagged from startup.
    expect(store().isPending('run.general')).toBe(false);
  });

  it('is pending once edited but never applied', () => {
    const s = store();
    s.set('run.general', { buffer_us: 2000 });
    expect(s.isPending('run.general')).toBe(true);
  });

  it('clears once applied', () => {
    const s = store();
    s.set('run.general', { buffer_us: 2000 });
    s.markApplied('run.general');
    expect(s.isPending('run.general')).toBe(false);
  });

  it('becomes pending again on a later edit', () => {
    const s = store();
    s.set('run.general', { buffer_us: 2000 });
    s.markApplied('run.general');
    s.set('run.general', { buffer_us: 2400 });
    expect(s.isPending('run.general')).toBe(true);
  });

  it('is not pending when an edit restores the applied value', () => {
    const s = store();
    s.set('run.general', { buffer_us: 2000 });
    s.markApplied('run.general');
    s.set('run.general', { buffer_us: 2400 });
    s.set('run.general', { buffer_us: 2000 });
    expect(s.isPending('run.general')).toBe(false);
  });

  it('notices a per-channel edit, not only panel values', () => {
    const s = store();
    s.markApplied('pmt.channelTrigger');
    expect(s.isPending('pmt.channelTrigger')).toBe(false);
    s.setChannels('pmt.channelTrigger', ['0:0'], { athr1: 5 });
    expect(s.isPending('pmt.channelTrigger')).toBe(true);
  });

  it('lists every pending panel and nothing else', () => {
    const s = store();
    s.set('run.general', { buffer_us: 2000 });
    s.set('trigger.config', { frequency_hz: 20 });
    s.markApplied('trigger.config');
    expect(s.pendingPanels()).toEqual(['run.general']);
  });

  it('marks applied panels pending again after the applied state is cleared', () => {
    // A reset means the cards no longer hold what the panel was told to send.
    const s = store();
    s.set('run.general', { buffer_us: 2000 });
    s.markApplied('run.general');
    s.clearApplied();
    expect(s.isPending('run.general')).toBe(true);
  });
});

describe('opening a panel is not an edit', () => {
  /**
   * Selecting a panel loads its values and the console writes them back. Asking
   * whether anything is stored therefore marked every panel the operator merely
   * opened as having unapplied changes.
   */
  it('is not pending after its own values are stored unchanged', () => {
    const s = store();
    s.set('run.general', s.get('run.general'));
    expect(s.isPending('run.general')).toBe(false);
  });

  it('is not pending when the stored values equal the declared defaults', () => {
    const s = store();
    s.set('run.general', s.defaults('run.general'));
    expect(s.isPending('run.general')).toBe(false);
  });

  it('still notices a real edit made after opening', () => {
    const s = store();
    s.set('run.general', s.get('run.general'));
    expect(s.isPending('run.general')).toBe(false);
    s.set('run.general', { buffer_us: 2400 });
    expect(s.isPending('run.general')).toBe(true);
  });

  it('is not pending when a channel map is stored but empty', () => {
    const s = store();
    s.setChannels('pmt.channelTrigger', ['0:0'], {});
    expect(s.isPending('pmt.channelTrigger')).toBe(false);
  });

  it('leaves no panel marked on a freshly opened console', () => {
    const s = store();
    // Simulate the console loading every panel in turn.
    for (const id of ['run.general', 'trigger.config', 'pmt.blr', 'sipm.led']) {
      s.set(id, s.get(id));
    }
    expect(s.pendingPanels()).toEqual([]);
  });
});
