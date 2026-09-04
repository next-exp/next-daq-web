import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_TOPOLOGY,
  encode,
  getAction,
  getRegister,
  parseMcs,
  parseMcsRecords,
  planAction,
} from '@next-daq/shared';
import { FlashSession } from '../src/control/flash.js';
import { RunLog } from '../src/store/log.js';
import { loadTopology } from '../src/config.js';
import type { CardLink } from '../src/net/link.js';

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'next-review-'));
afterAll(() => fs.rm(tmp, { recursive: true, force: true }));

describe('a failed send must not strand an ACK waiter', () => {
  /**
   * The waiter used to be armed before the datagram was sent, so a send failure
   * left a promise nothing awaited. Its timer later rejected it, and an unhandled
   * rejection terminates the process under Node's default policy.
   */
  it('fails cleanly when the link refuses to send', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);

    const link = { send: vi.fn().mockRejectedValue(new Error('CardLink is not running')) };
    const session = new FlashSession(link as unknown as CardLink, {
      host: '10.0.0.9',
      port: 6009,
      eraseTimeoutMs: 50,
      writeTimeoutMs: 50,
      maxRetries: 0,
    });

    const result = await session.run(':00000001FF');
    expect(result.phase).toBe('failed');

    // Well past any timer the old code would have left armed.
    await new Promise((r) => setTimeout(r, 150));
    process.off('unhandledRejection', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });
});

describe('run log survives a write failure', () => {
  it('keeps logging after one append fails', async () => {
    const dir = path.join(tmp, 'log-recovery');
    const log = new RunLog(dir, 'x.jsonl');

    const spy = vi.spyOn(fs, 'appendFile').mockRejectedValueOnce(new Error('ENOSPC'));
    await log.info('first');   // fails
    spy.mockRestore();

    await log.info('second');  // must still reach disk
    await log.info('third');

    const entries = await log.tail();
    expect(entries.map((e) => e.event)).toEqual(['second', 'third']);
  });
});

describe('numeric parameters reject nonsense', () => {
  /** Coercing to 0 turned `on_off: "start"` into a Stop command that reported success. */
  it('throws rather than silently encoding zero', () => {
    expect(() => planAction(getAction('run.acquisition'), { on_off: 'start' as never })).toThrow(
      /not a finite number/,
    );
  });

  it('still accepts a genuine zero', () => {
    const [w] = planAction(getAction('run.acquisition'), { on_off: 0 });
    expect(w.params.on_off).toBe(0);
  });
});

describe('panel maxima fit their register fields', () => {
  /**
   * A panel value that overflows its register field corrupts whatever is packed
   * beside it. These were advertised as valid and silently mis-encoded.
   */
  const maxOf = (actionId: string, name: string): number => {
    const spec = getAction(actionId).params.find((p) => p.name === name);
    return spec && 'max' in spec ? spec.max : Number.NaN;
  };

  it('keeps the 12-bit time thresholds inside 4095 time bins', () => {
    for (const p of ['tthr1_ns', 'tthr2_ns']) {
      expect(maxOf('pmt.channelTrigger', p) / 25).toBeLessThanOrEqual(4095);
    }
  });

  it('keeps the 8-bit pulse extensions inside 255 time bins', () => {
    for (const p of ['maskthr1', 'maskthr2']) {
      expect(maxOf('pmt.channelTrigger', p) / 25).toBeLessThanOrEqual(255);
    }
  });

  it('keeps the test-pulse period inside its 30-bit field', () => {
    expect(maxOf('test.signal', 'period_us') * 40).toBeLessThanOrEqual(0x3fffffff);
  });

  it('encodes a maximum-valued channel trigger without spilling between fields', () => {
    const [w] = planAction(getAction('pmt.channelTrigger'), {
      channels: [true, ...new Array(11).fill(false)],
      tthr1_ns: maxOf('pmt.channelTrigger', 'tthr1_ns'),
      athr4: 0,
      maskthr1: maxOf('pmt.channelTrigger', 'maskthr1'),
      maskthr2: maxOf('pmt.channelTrigger', 'maskthr2'),
    });
    const words = encode(getRegister(w.register), w.params, 1).hexWords;
    // athr4 occupies the top nibble of word 6; it must stay 0.
    expect(parseInt(words[6], 16) >> 12).toBe(0);
    // The two 8-bit mask fields must not bleed into each other.
    const maskWord = parseInt(words[16], 16);
    expect(maskWord >> 8).toBe(255);
    expect(maskWord & 0xff).toBe(255);
  });

  it('splits a large pulse period without sign extension', () => {
    const [gen] = planAction(getAction('test.signal'), {
      gen1_on: true,
      period_us: maxOf('test.signal', 'period_us'),
    });
    const words = encode(getRegister('PMTDaqConfReg56'), gen.params, 1).hexWords;
    // Reconstruct arithmetically — `<< 16` here would hit the same signed-shift
    // trap this test exists to catch.
    const period = parseInt(words[6], 16) * 0x10000 + parseInt(words[7], 16);
    expect(period).toBe(gen.params.timeperiod);
    expect(gen.params.timeperiod).toBeLessThanOrEqual(0x3fffffff);
  });
});

describe('Intel HEX segment records', () => {
  const rec = (type: number, address: number, data: number[]): string => {
    const bytes = [data.length, (address >> 8) & 0xff, address & 0xff, type, ...data];
    bytes.push((-bytes.reduce((a, b) => a + b, 0)) & 0xff);
    return ':' + bytes.map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join('');
  };
  const EOF_REC = rec(0x01, 0, []);

  /** A segment record is a byte offset of S << 4, not a 64K page of S >> 12. */
  it('applies the full segment value, not just its top nibble', () => {
    const img = parseMcs(
      [rec(0x02, 0, [0x01, 0x00]), rec(0x00, 0x0000, [0xaa]), EOF_REC].join('\n'),
    );
    expect(img.blocks[0].address).toBe(0x1000);
  });

  it('handles a segment whose low bits are set', () => {
    const img = parseMcs(
      [rec(0x02, 0, [0x12, 0x34]), rec(0x00, 0x0080, [0xbb]), EOF_REC].join('\n'),
    );
    expect(img.blocks[0].address).toBe((0x1234 << 4) + 0x0080);
  });

  it('agrees between the block parser and the record parser', () => {
    const text = [rec(0x02, 0, [0x01, 0x00]), rec(0x00, 0x0000, [0xaa]), EOF_REC].join('\n');
    expect(parseMcsRecords(text)[0].address).toBe(parseMcs(text).blocks[0].address);
  });
});

describe('topology configuration merge', () => {
  const write = async (name: string, body: unknown): Promise<string> => {
    const file = path.join(tmp, name);
    await fs.writeFile(file, JSON.stringify(body), 'utf8');
    return file;
  };

  /** A shallow spread dropped every sibling of an overridden nested field. */
  it('merges nested groups instead of replacing them', async () => {
    const t = await loadTopology(await write('partial.json', { ports: { java: 6010 } }));
    expect(t.ports.java).toBe(6010);
    expect(t.ports.feCmd).toBe(DEFAULT_TOPOLOGY.ports.feCmd);
    expect(t.ports.fe).toBe(DEFAULT_TOPOLOGY.ports.fe);
  });

  it('loads the shipped example configuration', async () => {
    const example = fileURLToPath(new URL('../../topology.example.json', import.meta.url));
    await expect(loadTopology(example)).resolves.toBeDefined();
  });
});

// Imported late so the example-config test can resolve a repo-relative path.
import { fileURLToPath } from 'node:url';
