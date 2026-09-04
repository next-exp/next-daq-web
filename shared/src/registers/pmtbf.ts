import { channelMask, flag } from '../words.js';
import { CMD_CONFIG } from '../encode.js';
import type { Group, RegisterDef, Target } from '../types.js';
import { bool, choice, int, mask, uint } from './spec.js';

/**
 * PMT and BF (buffer/energy-plane) DAQ registers.
 *
 * In the original these were 26 separate classes — PMTDaqConfRegN and
 * BFDaqConfRegN — that differed only in channel count and register group. The
 * shared ones are built once here by `common()`; registers whose payload genuinely
 * differs between the two planes are defined explicitly below.
 */

interface Plane {
  group: Extract<Group, 'PMT' | 'BF'>;
  target: Target;
  /** Data channels per FEC: 12 for PMT, 24 for BF. */
  channels: number;
  /** Cards addressable by the "card connected" mask register. */
  cards: number;
}

const PMT: Plane = { group: 'PMT', target: 'pmt', channels: 12, cards: 16 };
const BF: Plane = { group: 'BF', target: 'bf', channels: 24, cards: 24 };

function common(pl: Plane): RegisterDef[] {
  const { group, target } = pl;
  const n = group === 'PMT' ? 'PMTDaq' : 'BFDaq';

  return [
    {
      id: `${n}ConfReg1`,
      group,
      title: 'FEC connected mask',
      regAddr: 0x0001,
      cmdCode: CMD_CONFIG,
      target,
      params: [mask('cards', 'FECs connected', pl.cards, 'high', 'FEC')],
      payload: (p, w) => w.push(...channelMask(p.mask('cards'), pl.cards, 'high')),
      notes:
        'Active-high mask, unlike the equivalent TrgConfReg1/SiPMDaqConfReg1 which are active-low.',
    },
    {
      id: `${n}ConfReg3`,
      group,
      title: 'Trigger enable',
      regAddr: 0x0003,
      cmdCode: CMD_CONFIG,
      target,
      params: [bool('trg1on', 'Trigger 1 on'), bool('trg2on', 'Trigger 2 on')],
      payload: (p, w) =>
        w.push(flag(p.bool('trg1on'), 0x0001) | flag(p.bool('trg2on'), 0x0002)),
    },
    {
      id: `${n}ConfReg4_19`,
      group,
      title: 'Per-channel trigger thresholds',
      cmdCode: CMD_CONFIG,
      target,
      channelRange: { param: 'ch_num', base: 4, count: 16 },
      params: [
        int('ch_num', 'Channel', 15),
        bool('on1', 'Trigger 1 enabled'),
        bool('on2', 'Trigger 2 enabled'),
        bool('pol', 'Polarity'),
        bool('chtrg_type', 'Channel trigger type'),
        bool('rf1', 'Reset flag 1'),
        bool('rf2', 'Reset flag 2'),
        uint('athr1', 'Amplitude threshold 1', 12),
        uint('athr2', 'Amplitude threshold 2', 12),
        uint('athr3', 'Amplitude threshold 3', 12),
        uint('athr4', 'Amplitude threshold 4', 12),
        uint('tthr1', 'Time threshold 1', 12),
        uint('tthr2', 'Time threshold 2', 12),
        uint('tthr3', 'Time threshold 3', 16),
        uint('tthr4', 'Time threshold 4', 16),
        int('qthr1', 'Charge threshold min 1', 0x3fffff),
        int('qthr2', 'Charge threshold max 1', 0x3ffffff),
        int('qthr4', 'Charge threshold min 2', 0x3fffff),
        int('qthr5', 'Charge threshold max 2', 0x3ffffff),
        uint('maskthr1', 'Mask threshold 1', 8),
        uint('maskthr2', 'Mask threshold 2', 8),
      ],
      payload: (p, w) => {
        const athr4 = p.int('athr4');
        const qthr1 = p.int('qthr1');
        const qthr2 = p.int('qthr2');
        const qthr4 = p.int('qthr4');
        const qthr5 = p.int('qthr5');
        w.push(
          flag(p.bool('on1'), 0x8000) |
            flag(p.bool('on2'), 0x4000) |
            flag(p.bool('pol'), 0x2000) |
            flag(p.bool('chtrg_type'), 0x1000) |
            p.int('athr1'),
        );
        // athr4 is split three ways across the top nibbles of words 4-6.
        w.push(((athr4 >> 8) << 12) | p.int('athr2'));
        w.push(((athr4 >> 4) << 12) | p.int('athr3'));
        w.push((athr4 << 12) | p.int('tthr1'));
        w.push(
          flag(p.bool('rf1'), 0x8000) |
            flag(p.bool('rf2'), 0x4000) |
            ((qthr2 >> 26) << 13) |
            ((qthr5 >> 26) << 12) |
            p.int('tthr2'),
        );
        w.push(p.int('tthr3'), p.int('tthr4'));
        // Charge thresholds: low 16 bits, then the high bits packed together.
        w.push(qthr1, qthr2);
        w.push(((63 & (qthr1 >> 16)) << 10) | (1023 & (qthr2 >> 16)));
        w.push(qthr4, qthr5);
        w.push(((63 & (qthr4 >> 16)) << 10) | (1023 & (qthr5 >> 16)));
        w.push((p.int('maskthr1') << 8) | p.int('maskthr2'));
      },
    },
    {
      id: `${n}ConfReg20`,
      group,
      title: 'Baseline configuration',
      regAddr: 0x0014,
      cmdCode: CMD_CONFIG,
      target,
      params: [
        bool('bs_on', 'Baseline subtraction on'),
        bool('mau_16', 'MAU 16'),
        uint('bs_offset', 'Baseline offset', 12),
        uint('bs_thr', 'Baseline threshold', 8),
        uint('bs_detectthr', 'Baseline detect threshold', 8),
      ],
      payload: (p, w) => {
        w.push(
          flag(p.bool('bs_on'), 0x8000) | flag(p.bool('mau_16'), 0x4000) | p.int('bs_offset'),
        );
        w.push((p.int('bs_detectthr') << 8) | p.int('bs_thr'));
      },
    },
    {
      id: `${n}ConfReg37_52`,
      group,
      title: 'Per-channel shaper coefficients',
      cmdCode: CMD_CONFIG,
      target,
      channelRange: { param: 'ch_num', base: 37, count: 16 },
      params: [
        int('ch_num', 'Channel', 15),
        bool('on', 'Shaper on'),
        bool('rst', 'Reset'),
        bool('datam', 'Data mode'),
        { kind: 'coefArray', name: 'G', label: 'Gain coefficient (G)' },
        { kind: 'coefArray', name: 'A1', label: 'Coefficient A1' },
        { kind: 'coefArray', name: 'A2', label: 'Coefficient A2' },
      ],
      payload: (p, w) => {
        w.push(
          flag(p.bool('on'), 0x8000) |
            flag(p.bool('rst'), 0x4000) |
            flag(p.bool('datam'), 0x2000),
        );
        // Each coefficient is a 32-bit value sent high word first.
        for (const name of ['G', 'A1', 'A2'] as const) {
          const c = p.arr(name);
          w.push(c[1] ?? 0, c[0] ?? 0);
        }
      },
      notes: 'Coefficient arrays are [low, high]; the high word is transmitted first.',
    },
    {
      id: `${n}ConfReg53`,
      group,
      title: 'Throughput limit',
      regAddr: 0x0035,
      cmdCode: CMD_CONFIG,
      target,
      params: [
        bool('on', 'Limit on'),
        bool('trg2nowait', 'Trigger 2 no wait'),
        int('throughput', 'Throughput', 0x3fffffff),
      ],
      payload: (p, w) => {
        const t = p.int('throughput');
        w.push(flag(p.bool('on'), 0x8000) | flag(p.bool('trg2nowait'), 0x4000) | (t >> 16));
        w.push(t);
      },
    },
    {
      id: `${n}ConfReg54`,
      group,
      title: 'Trigger channel selection and windows',
      regAddr: 0x0036,
      cmdCode: CMD_CONFIG,
      target,
      params: [
        mask('bef_trg1', 'Channels before trigger 1', 12, 'high'),
        mask('bef_trg2', 'Channels before trigger 2', 12, 'high'),
        mask('aft_trg1', 'Channels after trigger 1', 12, 'high'),
        mask('aft_trg2', 'Channels after trigger 2', 12, 'high'),
        uint('timebefore_trg1', 'Time before trigger 1', 16),
        uint('timeafter_trg1', 'Time after trigger 1', 16),
        uint('timebefore_trg2', 'Time before trigger 2', 16),
        uint('timeafter_trg2', 'Time after trigger 2', 16),
        int('thrQ_trg1', 'Charge threshold trigger 1', 0xffffff),
        int('thrQ_trg2', 'Charge threshold trigger 2', 0xffffff),
        uint('thrtime_trg1', 'Time threshold trigger 1', 16),
        uint('thrtime_trg2', 'Time threshold trigger 2', 16),
      ],
      payload: (p, w) => {
        for (const m of ['bef_trg1', 'bef_trg2', 'aft_trg1', 'aft_trg2'] as const) {
          w.push(channelMask(p.mask(m), 12, 'high')[0]);
        }
        w.push(
          p.int('timebefore_trg1'),
          p.int('timeafter_trg1'),
          p.int('timebefore_trg2'),
          p.int('timeafter_trg2'),
        );
        const q1 = p.int('thrQ_trg1');
        const q2 = p.int('thrQ_trg2');
        w.push(((q1 >> 16) << 8) | ((q2 >> 16) & 0x00ff));
        w.push(q1, q2, p.int('thrtime_trg1'), p.int('thrtime_trg2'));
      },
    },
    ...pulseGenerator(group, target, `${n}ConfReg56`, 0x0038, 'Pulse generator 1'),
    ...pulseGenerator(group, target, `${n}ConfReg57`, 0x0039, 'Pulse generator 2'),
    {
      id: `${n}ConfReg58`,
      group,
      title: 'Time stamp control',
      regAddr: 0x003a,
      cmdCode: CMD_CONFIG,
      target,
      params: [int('time', 'Time', 0x7fff), bool('time_on', 'Time enabled')],
      payload: (p, w) => w.push((p.int('time') << 1) | flag(p.bool('time_on'), 0x0001)),
    },
  ];
}

/** Registers 56 and 57 share a payload; only the address and label differ. */
function pulseGenerator(
  group: Group,
  target: Target,
  id: string,
  regAddr: number,
  title: string,
): RegisterDef[] {
  return [
    {
      id,
      group,
      title,
      regAddr,
      cmdCode: CMD_CONFIG,
      target,
      params: [
        bool('on', 'Generator on'),
        int('timeperiod', 'Period', 0x3fffffff, 0, { unit: 'ticks' }),
        uint('timepulse', 'Pulse width', 16, 0, 'ticks'),
        uint('chH', 'Channel mask high', 12),
        uint('chL', 'Channel mask low', 12),
        uint('dly', 'Delay', 8),
      ],
      payload: (p, w) => {
        const dly = p.int('dly');
        const period = p.int('timeperiod');
        w.push(flag(p.bool('on'), 0x8000) | ((dly >> 4) << 12) | p.int('chH'));
        w.push((dly << 12) | p.int('chL'));
        // Arithmetic rather than `>>`: JavaScript's shift operators are signed
        // 32-bit, so a period above 2^31 would sign-extend.
        w.push(p.int('timepulse'), Math.floor(period / 0x10000), period);
      },
    },
  ];
}

const PMT_ONLY: RegisterDef[] = [
  {
    id: 'PMTDaqConfReg16',
    group: 'PMT',
    title: 'Channel enable and MAU',
    regAddr: 0x0010,
    cmdCode: CMD_CONFIG,
    target: 'pmt',
    params: [
      bool('on', 'Enabled'),
      bool('data_send', 'Send data'),
      bool('rst_mau', 'Reset MAU'),
      uint('mau_size', 'MAU size', 2),
      mask('channels', 'PMT channels', 12, 'high', 'PMT'),
    ],
    payload: (p, w) =>
      w.push(
        flag(p.bool('on'), 0x8000) |
          flag(p.bool('data_send'), 0x4000) |
          flag(p.bool('rst_mau'), 0x2000) |
          (p.int('mau_size') << 12) |
          channelMask(p.mask('channels'), 12, 'high')[0],
      ),
    notes:
      'mau_size is sent raw in bits 12-13 here, whereas PMTDaqConfReg21_36 maps the ' +
      'sample counts 128/256/512/1024 onto those bits.',
  },
  {
    id: 'PMTDaqConfReg21_36',
    group: 'PMT',
    title: 'Per-channel BLR / HPF configuration',
    cmdCode: CMD_CONFIG,
    target: 'pmt',
    channelRange: { param: 'ch_num', base: 21, count: 16 },
    params: [
      int('ch_num', 'Channel', 15),
      bool('on', 'Enabled'),
      bool('rst', 'Reset'),
      bool('dm', 'Data mode'),
      bool('trgm', 'Trigger mode'),
      bool('hpf', 'High-pass filter'),
      bool('dwi', 'Discharge while integrating'),
      choice('mau_size', 'MAU size', [
        [128, '128'],
        [256, '256'],
        [512, '512'],
        [1024, '1024'],
      ]),
      uint('mau_thr', 'MAU threshold', 8),
      uint('blr_thrh', 'BLR threshold high', 8),
      uint('blr_thrl', 'BLR threshold low', 8),
      uint('blr_coefL', 'BLR coefficient low', 16),
      uint('blr_coefH', 'BLR coefficient high', 8),
      uint('blr_dischcoefL', 'Discharge coefficient low', 16),
      uint('blr_dischcoefH', 'Discharge coefficient high', 16),
      uint('timetoabort', 'Time to abort', 16),
      uint('hpf_A1L', 'HPF A1 low', 16),
      uint('hpf_A1H', 'HPF A1 high', 8),
      uint('hpf_GL', 'HPF gain low', 16),
      uint('lineslope_index', 'Line slope index', 12),
      uint('line_index', 'Line index', 4),
    ],
    payload: (p, w) => {
      const mauBits = { 128: 0x0000, 256: 0x2000, 512: 0x4000, 1024: 0x6000 };
      w.push(
        flag(p.bool('on'), 0x8000) |
          flag(p.bool('rst'), 0x1000) |
          (mauBits[p.int('mau_size') as keyof typeof mauBits] ?? 0x0000) |
          flag(p.bool('dm'), 0x0800) |
          flag(p.bool('trgm'), 0x0400) |
          flag(p.bool('hpf'), 0x0200) |
          flag(p.bool('dwi'), 0x0100) |
          p.int('mau_thr'),
      );
      w.push((p.int('blr_thrh') << 8) | p.int('blr_thrl'));
      w.push(p.int('blr_coefL'), p.int('blr_dischcoefL'), p.int('blr_dischcoefH'));
      w.push(p.int('timetoabort'), p.int('hpf_A1L'), p.int('hpf_GL'));
      w.push((p.int('blr_coefH') << 8) | (255 & p.int('hpf_A1H')));
      w.push((p.int('lineslope_index') << 4) | p.int('line_index'));
    },
  },
  {
    id: 'PMTDaqConfReg55',
    group: 'PMT',
    title: 'Abort thresholds',
    regAddr: 0x0037,
    cmdCode: CMD_CONFIG,
    target: 'pmt',
    params: [
      uint('timetoabort', 'Time to abort', 16),
      uint('thrH', 'Threshold high', 16),
      uint('thrL', 'Threshold low', 16),
    ],
    payload: (p, w) => w.push(p.int('timetoabort'), p.int('thrH'), p.int('thrL')),
  },
];

const BF_ONLY: RegisterDef[] = [
  {
    id: 'BFDaqConfReg16',
    group: 'BF',
    title: 'Channel enable and gain select',
    regAddr: 0x0010,
    cmdCode: CMD_CONFIG,
    target: 'bf',
    params: [
      bool('on', 'Enabled'),
      bool('data_send', 'Send data'),
      bool('lg_hg', 'Low gain / high gain'),
      mask('channels', 'BF channels', 12, 'high', 'BF'),
    ],
    payload: (p, w) =>
      w.push(
        flag(p.bool('on'), 0x8000) |
          flag(p.bool('data_send'), 0x4000) |
          flag(p.bool('lg_hg'), 0x2000) |
          channelMask(p.mask('channels'), 12, 'high')[0],
      ),
  },
  {
    id: 'BFDaqConfReg21',
    group: 'BF',
    title: 'Trigger source selection',
    regAddr: 0x0015,
    cmdCode: CMD_CONFIG,
    target: 'bf',
    params: [mask('trgsel', 'Trigger source per channel', 12, 'high')],
    payload: (p, w) => w.push(channelMask(p.mask('trgsel'), 12, 'high')[0]),
    notes:
      'The mau_rst / mau_sz fields present in the Java signature were commented out of the ' +
      'payload upstream and are therefore not sent; BFDaqConfReg22 carries them instead.',
  },
  {
    id: 'BFDaqConfReg22',
    group: 'BF',
    title: 'MAU and baseline difference',
    regAddr: 0x0016,
    cmdCode: CMD_CONFIG,
    target: 'bf',
    params: [
      bool('mau_rst', 'Reset MAU'),
      uint('mau_sz', 'MAU size', 3),
      uint('baseline_diff', 'Baseline difference', 12),
    ],
    payload: (p, w) =>
      w.push(
        flag(p.bool('mau_rst'), 0x1000) |
          (p.int('mau_sz') << 13) |
          p.int('baseline_diff'),
      ),
  },
];

export const PMT_REGISTERS: RegisterDef[] = [...common(PMT), ...PMT_ONLY];
export const BF_REGISTERS: RegisterDef[] = [...common(BF), ...BF_ONLY];
