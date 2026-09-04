import { describe, expect, it } from 'vitest';
import {
  ALL_ACTIONS,
  getAction,
  getRegister,
  planAction,
  encode,
  hzToTrgMask,
  nsToTbins,
  samplesToUs,
  trgMaskToHz,
  usToSamples,
} from '../src/index.js';

describe('unit conversions', () => {
  it('converts microseconds to 25 ns samples', () => {
    expect(usToSamples(1)).toBe(40);
    expect(usToSamples(1300)).toBe(52000); // the Java default buffer size
    expect(usToSamples(650)).toBe(26000); // the Java default pre-trigger
    expect(samplesToUs(52000)).toBe(1300);
  });

  it('keeps the panel maximum inside the 17-bit register field', () => {
    // The Swing label read "Circular Buffer Size (us) [20-3200]".
    expect(usToSamples(3200)).toBe(128000);
    expect(usToSamples(3200)).toBeLessThanOrEqual(0x1ffff);
  });

  it('converts nanoseconds to time bins', () => {
    expect(nsToTbins(25)).toBe(1);
    expect(nsToTbins(1000)).toBe(40);
  });

  it('converts trigger rate to the mask period', () => {
    // The Java hard-coded `40000000 / 10` for its 10 Hz default.
    expect(hzToTrgMask(10)).toBe(4_000_000);
    expect(hzToTrgMask(1)).toBe(40_000_000);
    expect(trgMaskToHz(4_000_000)).toBe(10);
  });

  it('treats a zero rate as no mask rather than dividing by zero', () => {
    expect(hzToTrgMask(0)).toBe(0);
    expect(Number.isFinite(hzToTrgMask(0))).toBe(true);
  });
});

describe('action catalogue', () => {
  it('has unique ids', () => {
    expect(new Set(ALL_ACTIONS.map((a) => a.id)).size).toBe(ALL_ACTIONS.length);
  });

  it('only plans writes to registers that exist, with valid parameters', () => {
    for (const action of ALL_ACTIONS) {
      const writes = planAction(action, {});
      for (const w of writes) {
        const def = getRegister(w.register);
        // Encoding throws on an unknown or out-of-range parameter, so this also
        // checks every action supplies a parameter set the register accepts.
        expect(() => encode(def, w.params, 1)).not.toThrow();
      }
    }
  });

  it('declares every parameter its plan reads', () => {
    for (const action of ALL_ACTIONS) {
      // planAction throws "unknown parameter" for anything not declared.
      expect(() => planAction(action, {})).not.toThrow();
    }
  });
});

describe('run.general', () => {
  it('converts the microsecond panel values into sample counts', () => {
    const [write] = planAction(getAction('run.general'), {
      buffer_us: 1300,
      pretrigger_us: 650,
      mode: 1,
    });
    // GenConfReg0J is the variant the original actually sent; GenConfReg0 is unused.
    expect(write.register).toBe('GenConfReg0J');
    expect(write.params.buff_size).toBe(52000);
    expect(write.params.pretrigger).toBe(26000);
  });

  /**
   * The panel offers separate TRG1/Ext and TRG2 buffers, as the main window did.
   * An earlier version wrote GenConfReg0, which has no second buffer, so the TRG2
   * value was silently discarded.
   */
  it('sends both the TRG1 and TRG2 buffers', () => {
    const [write] = planAction(getAction('run.general'), {
      buffer_us: 1300,
      pretrigger_us: 650,
      buffer2_us: 800,
      pretrigger2_us: 400,
    });
    expect(write.params.buff_size).toBe(52000);
    expect(write.params.pretrigger).toBe(26000);
    expect(write.params.buff_size1).toBe(32000);
    expect(write.params.pretrigger1).toBe(16000);
  });

  it('clamps a pre-trigger that exceeds its buffer, as AdjustBuffer did', () => {
    const [write] = planAction(getAction('run.general'), {
      buffer_us: 1000,
      pretrigger_us: 3000,
    });
    expect(write.params.pretrigger).toBe(40000); // clamped to the 1000 us buffer
  });

  it('clamps the TRG2 buffer to the TRG1 buffer', () => {
    const [write] = planAction(getAction('run.general'), {
      buffer_us: 1000,
      buffer2_us: 3000,
    });
    expect(write.params.buff_size1).toBe(40000);
  });

  it('encodes to nine words with the dual-buffer header', () => {
    const [write] = planAction(getAction('run.general'), {
      buffer_us: 1300,
      pretrigger_us: 650,
      buffer2_us: 1300,
      pretrigger2_us: 650,
      mode: 1,
    });
    const out = encode(getRegister(write.register), write.params, 1);
    expect(out.hexWords.join(' ')).toBe('0001 0702 0000 0001 6590 cb20 6590 cb20 0000');
  });
});

describe('trigger.config', () => {
  it('turns the requested rate into the trigger mask period', () => {
    const [write] = planAction(getAction('trigger.config'), { frequency_hz: 10 });
    expect(write.params.trg_mask).toBe(4_000_000);
  });
});

describe('trigger.config', () => {
  it('configures the trigger and enables it on both planes', () => {
    const writes = planAction(getAction('trigger.config'), {
      double_trigger: true,
      cw_a1: 8,
      nch_a1: 3,
      tdif1_ns: 1000,
    });
    expect(writes.map((w) => w.register)).toEqual([
      'TrgConfReg3',
      'PMTDaqConfReg3',
      'BFDaqConfReg3',
    ]);
    expect(writes[0].params.CWszA1).toBe(8);
    expect(writes[0].params.nch_trgA1).toBe(3);
    expect(writes[0].params.trg_tdif1).toBe(40); // 1000 ns / 25 ns
    expect(writes[1].params.trg2on).toBe(true);
  });

  it('leaves the second trigger off when double trigger is disabled', () => {
    const writes = planAction(getAction('trigger.config'), { double_trigger: false });
    expect(writes[1].params.trg2on).toBe(false);
    expect(writes[2].params.trg2on).toBe(false);
  });
});

describe('per-channel trigger panels', () => {
  it('emits one write per selected channel, as the Java loop did', () => {
    const channels = new Array(12).fill(false);
    channels[0] = true;
    channels[5] = true;
    channels[11] = true;

    const writes = planAction(getAction('pmt.channelTrigger'), { channels, on1: true });
    expect(writes).toHaveLength(3);
    expect(writes.map((w) => w.params.ch_num)).toEqual([0, 5, 11]);
    // Each channel addresses its own register: base 4 plus the channel number.
    expect(writes.map((w) => encode(getRegister(w.register), w.params, 1).regAddr)).toEqual([
      4, 9, 15,
    ]);
  });

  it('plans nothing when no channel is selected', () => {
    expect(planAction(getAction('pmt.channelTrigger'), {})).toHaveLength(0);
  });

  it('applies the same thresholds to every selected channel', () => {
    const channels = new Array(12).fill(true);
    const writes = planAction(getAction('pmt.channelTrigger'), {
      channels,
      athr1: 123,
      tthr1_ns: 500,
    });
    expect(writes).toHaveLength(12);
    for (const w of writes) {
      expect(w.params.athr1).toBe(123);
      expect(w.params.tthr1).toBe(20); // 500 ns / 25 ns
    }
  });

  it('covers all 16 energy-plane trigger channels', () => {
    const channels = new Array(16).fill(true);
    expect(planAction(getAction('bf.channelTrigger'), { channels })).toHaveLength(16);
  });
});

describe('pmt.blr', () => {
  it('converts the abort time and keeps the MAU stage count', () => {
    const channels = new Array(12).fill(false);
    channels[3] = true;
    const [write] = planAction(getAction('pmt.blr'), {
      channels,
      timetoabort_us: 100,
      mau_size: 512,
    });
    expect(write.params.timetoabort).toBe(4000); // 100 µs at 40 MHz
    // The register maps 512 stages onto bits 13-14.
    const out = encode(getRegister('PMTDaqConfReg21_36'), write.params, 1);
    expect(parseInt(out.hexWords[3], 16) & 0x6000).toBe(0x4000);
  });
});

describe('fec.connected', () => {
  it('sends each plane its mask with that plane’s own polarity', () => {
    const one = (n: number) => {
      const m = new Array(n).fill(false);
      m[0] = true;
      return m;
    };
    const writes = planAction(getAction('fec.connected'), {
      trg_cards: one(13),
      pmt_cards: one(16),
      bf_cards: one(24),
      sipm_cards: one(16),
    });
    const words = Object.fromEntries(
      writes.map((w) => [w.register, encode(getRegister(w.register), w.params, 1).hexWords[3]]),
    );
    // Active-low planes clear the bit; active-high planes set it.
    expect(words.TrgConfReg1).toBe('fffe');
    expect(words.SiPMDaqConfReg1).toBe('fffe');
    expect(words.PMTDaqConfReg1).toBe('0001');
    expect(words.BFDaqConfReg1).toBe('0001');
  });
});

describe('fec.throughput', () => {
  it('converts MBytes/s to the byte-rate the register expects', () => {
    const writes = planAction(getAction('fec.throughput'), { throughput_mbs: 120, pmt_on: true });
    expect(writes.map((w) => w.register)).toEqual(['PMTDaqConfReg53', 'BFDaqConfReg53']);
    expect(writes[0].params.throughput).toBe(120_000_000);
  });
});

describe('test.signal', () => {
  it('drives both pulse generators from one set of parameters', () => {
    const writes = planAction(getAction('test.signal'), {
      gen1_on: true,
      gen2_on: false,
      period_us: 10,
      timepulse_us: 1,
    });
    expect(writes.map((w) => w.register)).toEqual(['PMTDaqConfReg56', 'PMTDaqConfReg57']);
    expect(writes[0].params.on).toBe(true);
    expect(writes[1].params.on).toBe(false);
    expect(writes[0].params.timeperiod).toBe(400); // 10 µs at 40 MHz
  });
});

describe('sipm.led — per-board LED control', () => {
  const boardsWith = (...ids: number[]) => {
    const m = new Array(56).fill(false);
    for (const i of ids) m[i] = true;
    return m;
  };

  it('sends one command per selected board, and none for the rest', () => {
    const writes = planAction(getAction('sipm.led'), {
      calon: true,
      boards: boardsWith(0, 7, 42),
    });
    expect(writes).toHaveLength(3);
    expect(writes.map((w) => w.params.fenum)).toEqual([0, 7, 42]);
    expect(writes.every((w) => w.register === 'SiPMFEConfReg5')).toBe(true);
  });

  it('carries the on/off state in calon', () => {
    const on = planAction(getAction('sipm.led'), { calon: true, boards: boardsWith(3) });
    const off = planAction(getAction('sipm.led'), { calon: false, boards: boardsWith(3) });
    expect(on[0].params.calon).toBe(true);
    expect(off[0].params.calon).toBe(false);
    expect(on[0].note).toMatch(/LED on/);
    expect(off[0].note).toMatch(/LED off/);
  });

  it('plans nothing when no board is selected', () => {
    expect(planAction(getAction('sipm.led'), { calon: true })).toHaveLength(0);
  });

  it('sends a zero pulse-off time when the train is disabled', () => {
    const [w] = planAction(getAction('sipm.led'), {
      boards: boardsWith(1),
      timepulseoff: 500,
      train_on: false,
    });
    expect(w.params.timepulseoff).toBe(0);
    const [on] = planAction(getAction('sipm.led'), {
      boards: boardsWith(1),
      timepulseoff: 500,
      train_on: true,
    });
    expect(on.params.timepulseoff).toBe(500);
  });

  it('rounds the period down to a whole number of pulse intervals', () => {
    const [w] = planAction(getAction('sipm.led'), {
      boards: boardsWith(0),
      pulse_period_us: 100, // 4000 samples
      pulse_freq_hz: 3, // pulsefreq = 15
    });
    // 4000 is not divisible by 15; the original truncated to 3990, then sent value-1.
    expect(w.params.trg_mask).toBe(3990 - 1);
  });
});


describe('per-card channel selection', () => {
  /**
   * The energy plane has three FECs of twelve trigger channels each, and every
   * write is addressed to one card. An earlier version used a flat 16-channel mask
   * sent to the whole plane, which both offered channels that do not exist and
   * gave all three FECs identical settings.
   */
  const gridOf = (cards: number, cols: number, ...picks: [number, number][]) => {
    const g = new Array(cards * cols).fill(false);
    for (const [card, ch] of picks) g[card * cols + ch] = true;
    return g;
  };

  it('emits one write per selected card and channel', () => {
    const writes = planAction(getAction('bf.channelTrigger'), {
      channels: gridOf(3, 12, [0, 0], [1, 5], [2, 11]),
    });
    expect(writes).toHaveLength(3);
    expect(writes.map((w) => [w.cardIndex, w.params.ch_num])).toEqual([
      [0, 0],
      [1, 5],
      [2, 11],
    ]);
  });

  it('addresses each write to its own card rather than the whole plane', () => {
    const writes = planAction(getAction('bf.channelTrigger'), {
      channels: gridOf(3, 12, [0, 0], [2, 0]),
    });
    expect(writes.map((w) => w.cardIndex)).toEqual([0, 2]);
    // Same channel number, different cards.
    expect(new Set(writes.map((w) => w.params.ch_num))).toEqual(new Set([0]));
  });

  it('covers all 36 energy-plane trigger channels', () => {
    const all = new Array(36).fill(true);
    const writes = planAction(getAction('bf.channelTrigger'), { channels: all });
    expect(writes).toHaveLength(36);
    expect(writes.map((w) => w.params.ch_num)).toEqual([
      ...Array(12).keys(),
      ...Array(12).keys(),
      ...Array(12).keys(),
    ]);
  });

  it('declares the channel selection as a per-card grid', () => {
    for (const id of ['pmt.channelTrigger', 'bf.channelTrigger', 'pmt.blr']) {
      const spec = getAction(id).params.find((p) => p.name === 'channels');
      expect(spec?.kind).toBe('grid');
      expect(spec && 'cols' in spec && spec.cols).toBe(12);
    }
  });

  it('scales to however many cards the selection covers', () => {
    // A single-FEC PMT plane and a seven-FEC one both work from the same action.
    expect(planAction(getAction('pmt.channelTrigger'), {
      channels: new Array(12).fill(true),
    })).toHaveLength(12);
    expect(planAction(getAction('pmt.channelTrigger'), {
      channels: new Array(84).fill(true),
    })).toHaveLength(84);
  });
});

describe('per-channel settings', () => {
  /**
   * Channels are configured independently — the Swing UI gave each its own row of
   * spinners. A single panel-level threshold set would silently overwrite whatever
   * a channel had been given individually.
   */
  const grid = (n: number, ...on: number[]) => {
    const g = new Array(n).fill(false);
    for (const i of on) g[i] = true;
    return g;
  };

  it('sends each channel its own stored values', () => {
    const writes = planAction(
      getAction('bf.channelTrigger'),
      { channels: grid(36, 0, 13) },
      {},
      { '0:0': { athr1: 111 }, '1:1': { athr1: 222 } },
    );
    expect(writes.map((w) => w.params.athr1)).toEqual([111, 222]);
  });

  it('falls back to the panel value for channels with no override', () => {
    const writes = planAction(
      getAction('bf.channelTrigger'),
      { channels: grid(36, 0, 1), athr1: 500 },
      {},
      { '0:0': { athr1: 111 } },
    );
    expect(writes.map((w) => w.params.athr1)).toEqual([111, 500]);
  });

  it('keeps per-channel enable flags independent', () => {
    const writes = planAction(
      getAction('bf.channelTrigger'),
      { channels: grid(36, 0, 1) },
      {},
      { '0:0': { on1: true }, '0:1': { on1: false } },
    );
    expect(writes.map((w) => w.params.on1)).toEqual([true, false]);
  });

  it('applies per-channel values to the BLR panel too', () => {
    const writes = planAction(
      getAction('pmt.blr'),
      { channels: grid(12, 2, 3) },
      {},
      { '0:2': { mau_thr: 7 }, '0:3': { mau_thr: 9 } },
    );
    expect(writes.map((w) => w.params.mau_thr)).toEqual([7, 9]);
  });
});

describe('trigger sum addresses one card', () => {
  /**
   * BFDaqConfReg16 goes to a single card with that card's own flags. The original
   * picked the FEC from a drop-down and "Activate TRG SUM" repeated the write for
   * each selected one, so a panel spanning the plane would misrepresent it.
   */
  it('emits exactly one write, to the selected card', () => {
    const channels = new Array(12).fill(true);
    for (const card of [0, 1, 2]) {
      const writes = planAction(getAction('bf.triggerSum'), { card, channels, on: true });
      expect(writes).toHaveLength(1);
      expect(writes[0].cardIndex).toBe(card);
      expect(writes[0].register).toBe('BFDaqConfReg16');
    }
  });

  it('carries the selected card’s own flags', () => {
    const [w] = planAction(getAction('bf.triggerSum'), {
      card: 1,
      channels: new Array(12).fill(false),
      on: true,
      lg_hg: true,
    });
    expect(w.params).toMatchObject({ on: true, lg_hg: true });
  });

  it('still writes when no channel is selected, to turn the sum off', () => {
    const writes = planAction(getAction('bf.triggerSum'), { card: 0, on: false });
    expect(writes).toHaveLength(1);
    expect(writes[0].params.on).toBe(false);
  });
});
