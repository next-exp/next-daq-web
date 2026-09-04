import { describe, expect, it } from 'vitest';
import { ALL_REGISTERS, getRegister } from '../src/registers/index.js';
import { encode } from '../src/encode.js';
import { channelMask, Words, header } from '../src/words.js';

/** Convenience: encode and return the words as a hex string. */
const hex = (id: string, params: Record<string, unknown> = {}, seq = 1): string =>
  encode(getRegister(id), params as never, seq).hexWords.join(' ');

describe('word primitives', () => {
  it('serialises words big-endian', () => {
    expect(new Words().push(0x1234, 0xabcd).toBuffer()).toEqual(
      Buffer.from([0x12, 0x34, 0xab, 0xcd]),
    );
  });

  it('truncates to 16 bits like the Java byte casts', () => {
    expect(new Words().push(0x1_2345).toHexWords()).toEqual(['2345']);
  });

  it('packs the header as (nw << 8) | cmd', () => {
    expect(header(5, 2)).toBe(0x0502);
  });
});

describe('channelMask polarity', () => {
  // These are the exact literals the Java emitted per selected card.
  it('active-low clears the selected bit, starting from 0xFFFF', () => {
    expect(channelMask([true], 13, 'low')).toEqual([0xfffe]);
    expect(channelMask([false, true], 13, 'low')).toEqual([0xfffd]);
    expect(channelMask([], 13, 'low')).toEqual([0xffff]);
  });

  it('active-high sets the selected bit, starting from 0', () => {
    expect(channelMask([true], 16, 'high')).toEqual([0x0001]);
    expect(channelMask([false, false, true], 16, 'high')).toEqual([0x0004]);
  });

  it('spreads 64 channels over four words, low index first', () => {
    const sel = new Array(64).fill(false);
    sel[0] = true;
    sel[16] = true;
    sel[47] = true;
    sel[63] = true;
    expect(channelMask(sel, 64, 'high')).toEqual([0x0001, 0x0001, 0x8000, 0x8000]);
  });
});

describe('golden vectors transcribed from the Java encoders', () => {
  it('GenConfReg0 matches the hand-computed words', () => {
    // buff_size 52000 = 0xCB20 (bit16 = 0), pretrigger 26000 = 0x6590 (bit16 = 0),
    // mode 1, run_code 0, dm_on false -> flags word = 0x0001.
    expect(hex('GenConfReg0', { pretrigger: 26000, buff_size: 52000, mhit_size: 0, mode: 1 })).toBe(
      '0001 0502 0000 0001 6590 cb20 0000',
    );
  });

  it('GenConfReg0 lifts bit 16 of buffer and pre-trigger into the flags word', () => {
    // 100000 = 0x186A0 -> bit16 set, low word 0x86A0. Flags bit15 = buffer, bit14 = pretrigger.
    const words = hex('GenConfReg0', {
      pretrigger: 100000,
      buff_size: 100000,
      mode: 0,
    }).split(' ');
    expect(words[3]).toBe('c000');
    expect(words[4]).toBe('86a0');
    expect(words[5]).toBe('86a0');
  });

  it('TrgConfReg1 sends an active-low FEC mask', () => {
    const cards = new Array(13).fill(false);
    cards[0] = true;
    cards[12] = true;
    expect(hex('TrgConfReg1', { cards })).toBe('0001 0202 0001 effe');
  });

  it('PMTDaqConfReg1 sends an active-high FEC mask for the same intent', () => {
    const cards = new Array(16).fill(false);
    cards[0] = true;
    cards[12] = true;
    expect(hex('PMTDaqConfReg1', { cards })).toBe('0001 0202 0001 1001');
  });

  it('AcqCmd splits the timestamp across words 3-5', () => {
    // Fixed timestamp so the vector is deterministic.
    const ms = 1_700_000_000_123;
    const out = hex('AcqCmd', { trg_events: 0, on_off: 1, rst: 0, timestamp_ms: ms }).split(' ');
    expect(out[1]).toBe('0400'); // nw = 4, cmd = 0
    expect(out[2]).toBe('0001'); // on_off = 1
    expect(parseInt(out[3], 16) & 0x3ff).toBe(ms % 1024);
    const upper = (parseInt(out[4], 16) << 16) | parseInt(out[5], 16);
    expect(upper >>> 0).toBe(Math.floor(ms / 1024));
  });

  it('PMTDaqConfReg4_19 derives the register address from the channel', () => {
    expect(encode(getRegister('PMTDaqConfReg4_19'), { ch_num: 0 }, 1).regAddr).toBe(4);
    expect(encode(getRegister('PMTDaqConfReg4_19'), { ch_num: 15 }, 1).regAddr).toBe(19);
    expect(encode(getRegister('PMTDaqConfReg37_52'), { ch_num: 3 }, 1).regAddr).toBe(40);
    expect(encode(getRegister('PMTDaqConfReg21_36'), { ch_num: 3 }, 1).regAddr).toBe(24);
  });

  it('PMTDaqConfReg4_19 splits athr4 across three words', () => {
    // athr4 = 0xFFF -> nibbles 0xF, 0xF, 0xF land in bits 12-15 of words 4, 5 and 6.
    const out = hex('PMTDaqConfReg4_19', { ch_num: 0, athr4: 0xfff }).split(' ');
    expect(out[4].charAt(0)).toBe('f');
    expect(out[5].charAt(0)).toBe('f');
    expect(out[6].charAt(0)).toBe('f');
  });

  it('PMTDaqConfReg21_36 maps MAU sample counts onto bits 13-14', () => {
    const bits = (n: number) =>
      parseInt(hex('PMTDaqConfReg21_36', { ch_num: 0, mau_size: n }).split(' ')[3], 16) & 0x6000;
    expect(bits(128)).toBe(0x0000);
    expect(bits(256)).toBe(0x2000);
    expect(bits(512)).toBe(0x4000);
    expect(bits(1024)).toBe(0x6000);
  });

  it('GenConfReg2 inverts wait_ack into an ACK-OFF bit', () => {
    const on = hex('GenConfReg2', { wait_ack: true, frame_length: 0 }).split(' ')[6];
    const off = hex('GenConfReg2', { wait_ack: false, frame_length: 0 }).split(' ')[6];
    expect(parseInt(on, 16) & 1).toBe(0);
    expect(parseInt(off, 16) & 1).toBe(1);
  });

  it('TrgConfReg12 gates per-card bits on the corresponding action flag', () => {
    const cards = new Array(13).fill(false);
    cards[0] = true;
    // Without realignlink / rst_module the card mask must not be transmitted.
    expect(hex('TrgConfReg12', { cards })).toBe('0001 0302 000c 0000 0000');
    expect(hex('TrgConfReg12', { cards, realignlink: true })).toBe('0001 0302 000c 0001 0000');
    expect(hex('TrgConfReg12', { cards, rst_module: true })).toBe('0001 0302 000c 0000 0001');
  });

  it('TrgConfReg3 divides the calibration trigger counts by 16', () => {
    const out = hex('TrgConfReg3', { ctrg_intntrg: 160, ctrg_extntrg: 32 }).split(' ');
    expect(out[11]).toBe('00a2'); // (160/16) << 4 | (32/16) = 0xA2
  });

  it('SiPMFEConfReg9 splits TimeShd across two words', () => {
    // 0x1234 >> 6 = 0x48 in the high word; the low 6 bits ride in word 4 bits 10-15.
    const out = hex('SiPMFEConfReg9', { TimeShd: 0x1234, TimeChk: 0x2a, SafeEn: true }).split(' ');
    expect(parseInt(out[3], 16)).toBe(0x8000 | (0x1234 >> 6));
    expect(parseInt(out[4], 16)).toBe(((0x1234 << 10) | 0x2a) & 0xffff);
  });

  it('SiPMFEConfReg9 keeps the SafeEn/TimeShd bit-15 collision of the original', () => {
    // The Java ORs (TimeShd >> 6) with the SafeEn bit without masking, so a TimeShd
    // at or above 0x200000 sets bit 15 on its own. Preserved deliberately: masking it
    // here would change what reaches the front-end board.
    const noFlag = hex('SiPMFEConfReg9', { TimeShd: 0x200000, SafeEn: false }).split(' ');
    expect(parseInt(noFlag[3], 16) & 0x8000).toBe(0x8000);
  });
});

describe('header word count', () => {
  /**
   * `nw` is derived as (total words - 2). Every original Java class shipped this
   * value as a literal; these are those literals, so the derivation is pinned.
   */
  const DECLARED_NW: Record<string, number> = {
    GenConfReg0: 0x05,
    GenConfReg0J: 0x07,
    GenConfReg2: 0x07,
    TrgConfReg1: 0x02,
    TrgConfReg3: 0x0a,
    TrgConfReg3A: 0x07,
    TrgConfReg4: 0x05,
    TrgConfReg5: 0x03,
    TrgConfReg12: 0x03,
    PMTDaqConfReg1: 0x02,
    PMTDaqConfReg3: 0x02,
    PMTDaqConfReg4_19: 0x0f,
    PMTDaqConfReg16: 0x02,
    PMTDaqConfReg20: 0x03,
    PMTDaqConfReg21_36: 0x0b,
    PMTDaqConfReg37_52: 0x08,
    PMTDaqConfReg53: 0x03,
    PMTDaqConfReg54: 0x0e,
    PMTDaqConfReg55: 0x04,
    PMTDaqConfReg56: 0x06,
    PMTDaqConfReg57: 0x06,
    PMTDaqConfReg58: 0x02,
    BFDaqConfReg1: 0x03,
    BFDaqConfReg3: 0x02,
    BFDaqConfReg4_19: 0x0f,
    BFDaqConfReg16: 0x02,
    BFDaqConfReg20: 0x03,
    BFDaqConfReg21: 0x02,
    BFDaqConfReg22: 0x02,
    BFDaqConfReg37_52: 0x08,
    BFDaqConfReg53: 0x03,
    BFDaqConfReg54: 0x0e,
    BFDaqConfReg56: 0x06,
    BFDaqConfReg57: 0x06,
    BFDaqConfReg58: 0x02,
    SiPMDaqConfReg1: 0x02,
    SiPMDaqConfReg3: 0x03,
    SiPMDaqConfReg4: 0x03,
    SiPMDaqConfReg5: 0x02,
    SiPMFEConfReg1: 0x05,
    SiPMFEConfReg2: 0x05,
    SiPMFEConfReg3: 0x04,
    SiPMFEConfReg4: 0x02,
    SiPMFEConfReg5: 0x08,
    SiPMFEConfReg6: 0x03,
    SiPMFEConfReg7: 0x02,
    SiPMFEConfReg8: 0x03,
    SiPMFEConfReg9: 0x06,
    SiPMFEConfReg10: 0x02,
    AcqCmd: 0x04,
    PRBSCmd: 0x01,
    StatusCmdRd: 0x01,
    ProgCmd: 0x02,
  };

  it.each(Object.entries(DECLARED_NW))(
    '%s encodes the word count the Java class declared',
    (id, expected) => {
      expect(encode(getRegister(id), {}, 1).nw).toBe(expected);
    },
  );

  it('covers every register defined', () => {
    expect(new Set(ALL_REGISTERS.map((r) => r.id))).toEqual(new Set(Object.keys(DECLARED_NW)));
  });

  it('always reports nw as total words minus two', () => {
    for (const reg of ALL_REGISTERS) {
      const out = encode(reg, {}, 1);
      expect(out.nw).toBe(out.hexWords.length - 2);
      expect(out.bytes.length).toBe(out.hexWords.length * 2);
    }
  });
});

describe('parameter validation', () => {
  it('rejects an out-of-range channel rather than writing a wrong register', () => {
    expect(() => encode(getRegister('PMTDaqConfReg4_19'), { ch_num: 16 }, 1)).toThrow(
      /channel 16 out of range/,
    );
  });

  it('rejects unknown parameters instead of silently ignoring them', () => {
    const def = { ...getRegister('PRBSCmd'), payload: (p: any, w: any) => w.push(p.int('nope')) };
    expect(() => encode(def as never, {}, 1)).toThrow(/unknown parameter/);
  });
});
