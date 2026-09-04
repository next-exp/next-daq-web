import { describe, expect, it } from 'vitest';
import {
  FLASH_RELOAD_WAIT_MS,
  encode,
  getAction,
  getRegister,
  planAction,
} from '../src/index.js';

/** Word 3 of ProgCmd carries the programming control bits. */
const progWord = (params: Record<string, unknown>): number =>
  parseInt(encode(getRegister('ProgCmd'), params as never, 1).hexWords[3], 16);

describe('soft reset', () => {
  it('stops acquisition with the reset bit set', () => {
    const writes = planAction(getAction('run.softReset'), {});
    expect(writes).toHaveLength(1);
    expect(writes[0].register).toBe('AcqCmd');
    // The original sent AcqCmd(n, on_off = 0, rst = 1).
    expect(writes[0].params).toMatchObject({ on_off: 0, rst: 1 });
  });

  it('reprograms nothing', () => {
    expect(planAction(getAction('run.softReset'), {}).map((w) => w.register)).not.toContain(
      'ProgCmd',
    );
  });
});

describe('recover from flash', () => {
  it('broadcasts a flash reload for all cards', () => {
    const [w] = planAction(getAction('fec.recover'), { scope: 0 });
    expect(w.register).toBe('ProgCmd');
    expect(w.target).toBe('broadcast');
    // flash_sel (0x2) | prog_on (0x1); prog_wron stays clear.
    expect(progWord(w.params)).toBe(0x0003);
  });

  it('targets a single plane when asked', () => {
    expect(planAction(getAction('fec.recover'), { scope: 1 })[0].target).toBe('bf');
    expect(planAction(getAction('fec.recover'), { scope: 2 })[0].target).toBe('pmt');
    expect(planAction(getAction('fec.recover'), { scope: 3 })[0].target).toBe('sipm');
  });

  it('reloads each selected front-end board individually', () => {
    const boards = new Array(56).fill(false);
    boards[0] = true;
    boards[3] = true;
    const writes = planAction(getAction('fec.recover'), { scope: 4, boards });
    expect(writes).toHaveLength(2);
    expect(writes.map((w) => w.board)).toEqual([0, 3]);
    expect(writes.every((w) => w.target === 'feBoard')).toBe(true);
  });

  it('plans nothing when board scope is chosen with no boards selected', () => {
    expect(planAction(getAction('fec.recover'), { scope: 4 })).toHaveLength(0);
  });

  it('never sets the flash write-enable bit', () => {
    // Recovery reloads from flash; it must not put the card into a writable state.
    for (const scope of [0, 1, 2, 3]) {
      const [w] = planAction(getAction('fec.recover'), { scope });
      expect(w.params.prog_wron).toBe(false);
      expect(progWord(w.params) & 0x0004).toBe(0);
    }
  });
});

describe('hard reset', () => {
  it('chains soft reset, flash reload and a second soft reset', () => {
    const writes = planAction(getAction('run.hardReset'), {});
    expect(writes.map((w) => w.register)).toEqual(['AcqCmd', 'ProgCmd', 'AcqCmd']);
    expect(writes[0].params).toMatchObject({ on_off: 0, rst: 1 });
    expect(writes[1].target).toBe('broadcast');
    expect(writes[2].params).toMatchObject({ on_off: 0, rst: 1 });
  });

  it('waits for the cards to come back, defaulting to the original 60 seconds', () => {
    const writes = planAction(getAction('run.hardReset'), {});
    expect(writes[1].waitAfterMs).toBe(FLASH_RELOAD_WAIT_MS);
    expect(FLASH_RELOAD_WAIT_MS).toBe(60_000);
  });

  it('waits only after the reload, not after the soft resets', () => {
    const writes = planAction(getAction('run.hardReset'), {});
    expect(writes[0].waitAfterMs).toBeUndefined();
    expect(writes[2].waitAfterMs).toBeUndefined();
  });

  it('allows a longer wait for a slower crate', () => {
    const writes = planAction(getAction('run.hardReset'), { reload_wait_s: 120 });
    expect(writes[1].waitAfterMs).toBe(120_000);
  });
});
