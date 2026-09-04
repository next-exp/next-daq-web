import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseConfig } from '../src/store/config.js';
import { importLegacyConfig, looksLegacy } from '../src/store/legacy.js';

/**
 * Configuration files written by the DATE-era control application key each
 * setting by a human-readable description rather than by panel and parameter, so
 * they cannot be read back directly. The values are already in the units the
 * panels use, so importing is a translation of keys.
 *
 * The fixture is a real production file for a 4-fold-coincidence alpha run.
 */
const FIXTURE = fileURLToPath(new URL('./fixtures/legacy-config.txt', import.meta.url));
const load = async () => parseConfig(await fs.readFile(FIXTURE, 'utf8'));

describe('legacy configuration import', () => {
  it('recognises the format', async () => {
    expect(looksLegacy(await load())).toBe(true);
  });

  it('does not mistake one of our own files for it', () => {
    const ours = parseConfig('run.general:buffer_us:2400\n\nrun.general:mode:1\n');
    expect(looksLegacy(ours)).toBe(false);
  });

  it('imports the general run settings in the units the panel uses', async () => {
    const r = importLegacyConfig(await load());
    // "GEN:Buffer Size 1:350" is already microseconds.
    expect(r.settings['run.general']).toMatchObject({
      buffer_us: 350,
      pretrigger_us: 250,
      buffer2_us: 3200,
      pretrigger2_us: 1600,
      mode: 1,
      run_code: 2,
      num_triggers: 20,
    });
  });

  it('imports the trigger coincidence settings', async () => {
    const r = importLegacyConfig(await load());
    // The file is a 4-fold coincidence run, as its name says.
    expect(r.settings['trigger.config']).toMatchObject({
      nch_a1: 4,
      cw_a1: 50,
      frequency_hz: 10,
    });
  });

  it('converts throughput from bytes per second to MBytes/s', async () => {
    const r = importLegacyConfig(await load());
    const t = r.settings['fec.throughput'];
    expect(t?.throughput_mbs).toBeGreaterThan(0);
    expect(t?.throughput_mbs).toBeLessThanOrEqual(120);
  });

  it('reads 1 and 0 as booleans', async () => {
    const r = importLegacyConfig(await load());
    for (const v of Object.values(r.settings['pmt.blr'] ?? {})) {
      if (typeof v === 'boolean') expect([true, false]).toContain(v);
    }
    expect(typeof r.settings['pmt.blr']?.on).toBe('boolean');
  });

  it('imports per-channel trigger participation', async () => {
    const r = importLegacyConfig(await load());
    const pmt = r.channels['pmt.channelTrigger'];
    expect(pmt).toBeDefined();
    // Channels are keyed "cardIndex:channel", card indices being zero-based.
    expect(Object.keys(pmt)).toContain('0:0');
    expect(typeof pmt['0:0'].on1).toBe('boolean');
  });

  it('builds channel masks from the per-channel entries', async () => {
    const r = importLegacyConfig(await load());
    const blr = r.settings['pmt.blr']?.channels as boolean[] | undefined;
    expect(Array.isArray(blr)).toBe(true);
    expect(blr!.length).toBeGreaterThanOrEqual(12);
  });

  it('inverts the "disconnected" entries into a connected mask', async () => {
    const entries = new Map([
      ['TRG:PMT FEC 1 disconnected', '0'],
      ['TRG:PMT FEC 2 disconnected', '1'],
    ]);
    const r = importLegacyConfig({ entries, malformed: [] });
    const mask = r.settings['fec.connected']?.pmt_cards as boolean[];
    expect(mask[0]).toBe(true); // not disconnected -> connected
    expect(mask[1]).toBe(false);
  });

  it('skips the "Config" markers, which record an action rather than a value', async () => {
    const r = importLegacyConfig(await load());
    expect(r.unrecognised.some((u) => /:Config/.test(u.shape))).toBe(false);
  });

  it('reports what it could not map, grouped rather than one line each', async () => {
    const r = importLegacyConfig(await load());
    // Grouping keeps a 500-entry file from producing hundreds of near-identical rows.
    expect(r.unrecognised.length).toBeLessThan(20);
    for (const u of r.unrecognised) {
      expect(u.count).toBeGreaterThan(0);
      expect(u.example).toContain(':');
    }
  });

  /**
   * The shortfall is the 24-channel BF sensor mask, which has no register in this
   * set to carry it, plus the BLR coefficients below. Raising this threshold would
   * mean either finding them a home or forcing them somewhere they do not belong.
   */
  it('imports the large majority of a real file', async () => {
    const parsed = await load();
    const r = importLegacyConfig(parsed);
    const markers = [...parsed.entries.keys()].filter((k) => /:Config\b/.test(k)).length;
    const ratio = r.imported / (parsed.entries.size - markers);
    expect(ratio).toBeGreaterThan(0.75);
  });

  /**
   * These hold the physical coefficients as displayed, not the fixed-point values
   * the register carries, so importing them as integers would write 0 or 1 into the
   * baseline restorer. They stay unmapped until that conversion is established.
   */
  it('leaves the BLR coefficients unmapped rather than truncating them', async () => {
    const parsed = await load();
    const r = importLegacyConfig(parsed);
    for (const name of ['BLR coefficient', 'BLR HPF A1', 'BLR HPF G']) {
      const group = r.unrecognised.find((u) => u.shape.endsWith(name));
      expect(group, name).toBeDefined();
      expect(group!.count).toBeGreaterThan(0);
    }
    for (const values of Object.values(r.channels['pmt.blr'] ?? {})) {
      for (const p of ['blr_coefL', 'hpf_A1L', 'hpf_GL']) expect(values[p]).toBeUndefined();
    }
  });
});

describe('per-card masks from a legacy file', () => {
  it('imports every FEC’s trigger-sum mask, not just the first', async () => {
    const r = importLegacyConfig(await load());
    const byCard = r.cards['bf.triggerSum'];
    expect(byCard).toBeDefined();
    // The fixture configures three energy-plane FECs.
    expect(Object.keys(byCard).sort()).toEqual(['0', '1', '2']);
    for (const card of Object.values(byCard)) {
      expect((card.channels as boolean[]).length).toBe(12);
    }
  });

  /**
   * "BF FEC 1:CH 0..23 connected" is the 24-channel sensor mask, a different
   * thing from the 12-bit trigger-sum mask. Forcing one into the other would put
   * half the channels somewhere they do not belong, so it is reported instead.
   */
  it('does not force the 24-channel sensor mask into a 12-bit field', async () => {
    const r = importLegacyConfig(await load());
    expect(r.unrecognised.some((u) => /^BF FEC N:CH N/.test(u.shape))).toBe(true);
    for (const card of Object.values(r.cards['bf.triggerSum'])) {
      expect((card.channels as boolean[]).length).toBe(12);
    }
  });

  it('counts a setting once even when it feeds two panels', async () => {
    const parsed = await load();
    const r = importLegacyConfig(parsed);
    // The high-gain selection reaches both the selector and the trigger sum.
    expect(r.imported).toBeLessThanOrEqual(parsed.entries.size);
  });
});
