import { describe, expect, it } from 'vitest';
import {
  RUN_CODES,
  RUN_CODE_BITS,
  RUN_CODE_OPTIONS,
  encode,
  getAction,
  getRegister,
  planAction,
  runCodeLabel,
} from '../src/index.js';

describe('run codes', () => {
  it('carries every code the original offered', () => {
    expect(RUN_CODES.map((c) => c.code)).toEqual([
      0, 1, 2, 3, 10, 11, 12, 20, 21, 22, 23, 30, 31, 32, 33, 40, 41, 42, 50, 51, 60, 61, 62,
    ]);
  });

  it('labels a code with its description and qualifier', () => {
    expect(runCodeLabel(RUN_CODES.find((c) => c.code === 21)!)).toBe(
      '21 — Kr-83 + Th-228 (source at lateral port)',
    );
    expect(runCodeLabel(RUN_CODES.find((c) => c.code === 20)!)).toBe('20 — Kr-83');
  });

  it('offers them as a drop-down on the general configuration panel', () => {
    const spec = getAction('run.general').params.find((p) => p.name === 'run_code');
    expect(spec?.kind).toBe('enum');
    expect(spec && 'options' in spec && spec.options).toHaveLength(RUN_CODE_OPTIONS.length);
  });

  /**
   * The field occupies bits 4-11 of the flags word. An earlier version declared it
   * as four bits, which would have rejected every code above 15 — that is most of
   * the calibration and source runs.
   */
  it('accepts the highest code in use', () => {
    expect(2 ** RUN_CODE_BITS - 1).toBeGreaterThanOrEqual(62);
    const [w] = planAction(getAction('run.general'), { run_code: 62 });
    expect(w.params.run_code).toBe(62);
  });

  it('places the code in bits 4-11 without disturbing its neighbours', () => {
    const [w] = planAction(getAction('run.general'), {
      run_code: 62,
      mode: 1,
      dual_mode: true,
    });
    const flags = parseInt(encode(getRegister('GenConfReg0J'), w.params, 1).hexWords[3], 16);
    expect((flags >> 4) & 0xff).toBe(62);
    expect(flags & 0x7).toBe(1); // mode
    expect(flags & 0x8).toBe(0x8); // data mode
  });

  it('encodes every code without overflowing into the buffer flags', () => {
    for (const { code } of RUN_CODES) {
      const [w] = planAction(getAction('run.general'), { run_code: code });
      const flags = parseInt(encode(getRegister('GenConfReg0J'), w.params, 1).hexWords[3], 16);
      // Bits 12-15 belong to the buffer and pre-trigger high bits.
      expect(flags & 0xf000, `code ${code}`).toBe(0);
      expect((flags >> 4) & 0xff).toBe(code);
    }
  });
});
