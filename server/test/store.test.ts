import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  ConfigStore,
  gainFor,
  parseConfig,
  parseGains,
  serialiseConfig,
} from '../src/store/config.js';
import { RunLog } from '../src/store/log.js';
import { DEFAULT_TOPOLOGY, TopologyError, validateTopology } from '@next-daq/shared';

const REAL = '/Users/roberto/java/Envio_Comandos_NEXT_JULIETT_vDHDALL';
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'next-daq-'));
afterAll(() => fs.rm(tmp, { recursive: true, force: true }));

describe('config format', () => {
  it('splits at the final colon, so keys may contain colons', () => {
    const { entries } = parseConfig('BF FEC 1 BFs TRG A:CH 0  BF 12 selected TRG 1:1');
    expect(entries.get('BF FEC 1 BFs TRG A:CH 0  BF 12 selected TRG 1')).toBe('1');
  });

  it('keeps the long SiPM mask value intact', () => {
    const mask = '1'.repeat(64);
    const { entries } = parseConfig(`FE0:SiPM sensor connected mask:${mask}:1`);
    expect(entries.get(`FE0:SiPM sensor connected mask:${mask}`)).toBe('1');
  });

  it('reports malformed lines instead of dropping them silently', () => {
    const { entries, malformed } = parseConfig('good:1\nnocolon\n');
    expect(entries.size).toBe(1);
    expect(malformed).toEqual([{ line: 2, text: 'nocolon' }]);
  });

  it('round-trips the real Config.txt without losing entries', async () => {
    const text = await fs.readFile(path.join(REAL, 'Config.txt'), 'utf8');
    const first = parseConfig(text);
    expect(first.entries.size).toBeGreaterThan(50);
    expect(first.malformed).toEqual([]);
    const second = parseConfig(serialiseConfig(first.entries));
    expect(second.entries).toEqual(first.entries);
  });

  it('round-trips the ATCA config.txt', async () => {
    const text = await fs.readFile(
      '/Users/roberto/java/ATCAFlashProgramming_v1/config.txt',
      'utf8',
    );
    const first = parseConfig(text);
    expect(first.malformed).toEqual([]);
    expect(parseConfig(serialiseConfig(first.entries)).entries).toEqual(first.entries);
  });
});

describe('ConfigStore', () => {
  it('saves and reloads a configuration', async () => {
    const store = new ConfigStore(tmp);
    await store.save('test.txt', new Map([['GEN:Buffer Size', '800']]));
    expect((await store.load('test.txt')).entries.get('GEN:Buffer Size')).toBe('800');
    expect(await store.list()).toContain('test.txt');
  });

  it('refuses to escape the data directory', async () => {
    const store = new ConfigStore(tmp);
    await expect(store.save('../escape.txt', new Map())).rejects.toThrow(/Invalid configuration/);
    await expect(store.load('/etc/passwd')).rejects.toThrow(/Invalid configuration/);
  });
});

describe('gains', () => {
  it('parses the real gains.txt', async () => {
    const rows = parseGains(await fs.readFile(path.join(REAL, 'gains.txt'), 'utf8'));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).toEqual({ minRun: 0, sensorId: 0, elecId: 0, gain: 24.75 });
  });

  it('rejects a malformed row rather than silently skipping it', () => {
    expect(() => parseGains('MinRun\tSensorID\tElecID\tGain\n0\t1\tx\t2')).toThrow(/non-numeric/);
    expect(() => parseGains('0\t1\t2')).toThrow(/expected 4/);
  });

  it('selects the latest applicable gain for a run', () => {
    const rows = parseGains(
      ['MinRun\tSensorID\tElecID\tGain', '0\t5\t5\t10', '100\t5\t5\t20'].join('\n'),
    );
    expect(gainFor(rows, 5, 50)).toBe(10);
    expect(gainFor(rows, 5, 150)).toBe(20);
    expect(gainFor(rows, 9, 150)).toBeUndefined();
  });
});

describe('RunLog', () => {
  it('appends structured entries and reads them back', async () => {
    const log = new RunLog(tmp, 'x.jsonl');
    await log.info('command_sent', { register: 'AcqCmd' });
    await log.error('trigger_failure', { consecutiveInvalid: 3 });
    const entries = await log.tail();
    expect(entries.map((e) => e.event)).toEqual(['command_sent', 'trigger_failure']);
    expect(entries[1].level).toBe('error');
  });

  it('serialises concurrent appends without interleaving', async () => {
    const log = new RunLog(tmp, 'concurrent.jsonl');
    await Promise.all(Array.from({ length: 50 }, (_, i) => log.info('e', { i })));
    const entries = await log.tail(100);
    expect(entries).toHaveLength(50);
    expect(entries.map((e) => e.detail?.i)).toEqual([...Array(50).keys()]);
  });

  it('returns an empty tail when no log exists yet', async () => {
    expect(await new RunLog(tmp, 'missing.jsonl').tail()).toEqual([]);
  });
});

describe('topology validation', () => {
  it('accepts the default topology', () => {
    expect(() => validateTopology(DEFAULT_TOPOLOGY)).not.toThrow();
  });

  it('rejects a malformed address', () => {
    expect(() =>
      validateTopology({
        ...DEFAULT_TOPOLOGY,
        cards: [{ id: 'X', label: 'X', host: '10.0.0.999', plane: 'trg' }],
      }),
    ).toThrow(TopologyError);
  });

  it('rejects two cards sharing an address', () => {
    expect(() =>
      validateTopology({
        ...DEFAULT_TOPOLOGY,
        cards: [
          { id: 'A', label: 'A', host: '10.0.0.1', plane: 'bf' },
          { id: 'B', label: 'B', host: '10.0.0.1', plane: 'bf' },
        ],
      }),
    ).toThrow(/share address/);
  });

  it('rejects duplicate card ids', () => {
    expect(() =>
      validateTopology({
        ...DEFAULT_TOPOLOGY,
        cards: [
          { id: 'A', label: 'A', host: '10.0.0.1', plane: 'bf' },
          { id: 'A', label: 'A2', host: '10.0.0.2', plane: 'bf' },
        ],
      }),
    ).toThrow(/duplicate id/);
  });

  it('rejects an out-of-range port', () => {
    expect(() =>
      validateTopology({ ...DEFAULT_TOPOLOGY, ports: { java: 0, fec: 1, fe: 2 } }),
    ).toThrow(/ports.java/);
  });
});
