import { nsToTbins, usToSamples } from '../units.js';
import { bool, choice, grid, int, mask, section, uint } from '../registers/spec.js';
import type { ConfigAction, PlanContext, PlannedWrite } from './types.js';
import type { ParamAccess } from '../types.js';

/**
 * PMT and energy-plane (BF) panels.
 *
 * The Swing tabs laid out one row of spinners per channel — "CH TRG Conf A" alone
 * carried 133 labels and 28 fields. Here the operator selects the channels the
 * settings apply to and the action emits one register write per selected channel,
 * which is what `AdjustTRGAChannels` did in its loop.
 */

/** Threshold parameters shared by the A, B and external channel-trigger panels. */
function triggerThresholdParams(
  plane: 'pmt' | 'bf',
  channels: number,
  itemLabel: string,
) {
  /** The same six thresholds exist for each trigger, under different field names. */
  const thresholds = (
    trigger: 1 | 2,
    /**
     * Largest time threshold the register can hold. Trigger 1's fields share their
     * words with other values and are 12 bits; trigger 2's occupy whole words and
     * are 16 bits, so they are not equally restricted.
     */
    maxTimeNs: number,
    names: {
      on: string;
      rf: string;
      athrDev: string;
      athrMax: string;
      tthrMin: string;
      tthrMax: string;
      qMin: string;
      qMax: string;
      mask: string;
    },
  ) =>
    section(`Trigger ${trigger}`, [
      bool(names.on, 'Enabled'),
      bool(names.rf, 'Full time at end'),
      int(names.athrDev, 'Baseline deviation', 4095, 0, { unit: 'counts' }),
      int(names.athrMax, 'Max amplitude', 4095, 0, { unit: 'counts' }),
      int(names.tthrMin, 'Min time threshold', maxTimeNs, 0, { unit: 'ns' }),
      int(names.tthrMax, 'Max time threshold', maxTimeNs, 0, { unit: 'ns' }),
      int(names.qMin, 'Q min', 4_194_303, 0, { unit: 'counts acc.' }),
      int(names.qMax, 'Q max', 134_217_727, 0, { unit: 'counts acc.' }),
      // Packed as two 8-bit fields, so 255 time bins each.
      int(names.mask, 'Pulse valid extension', 6_375, 0, { unit: 'ns' }),
    ]);

  return [
    grid('channels', 'Channels selected to trigger', plane, channels, itemLabel),
    ...section('Common', [
      bool('pol', 'Invert polarity'),
      bool('chtrg_type', 'Trigger B'),
    ]),
    // 4095 time bins x 25 ns.
    ...thresholds(1, 102_375, {
      on: 'on1',
      rf: 'rf1',
      athrDev: 'athr1',
      athrMax: 'athr2',
      tthrMin: 'tthr1_ns',
      tthrMax: 'tthr2_ns',
      qMin: 'qthr1',
      qMax: 'qthr2',
      mask: 'maskthr1',
    }),
    // 65535 time bins x 25 ns.
    ...thresholds(2, 1_638_375, {
      on: 'on2',
      rf: 'rf2',
      athrDev: 'athr3',
      athrMax: 'athr4',
      tthrMin: 'tthr3_ns',
      tthrMax: 'tthr4_ns',
      qMin: 'qthr4',
      qMax: 'qthr5',
      mask: 'maskthr2',
    }),
  ];
}

/**
 * One write per selected (card, channel), addressed to that card.
 *
 * The original looped over the cards explicitly — `AdjustBFTRGAChannels` called
 * `BFDaqConfReg4_19` twelve times each for DAQ_card1, DAQ_card2 and DAQ_card3, so
 * the energy plane has 3 x 12 trigger channels rather than a single flat list.
 */
function planChannelTrigger(register: string, cols: number) {
  return (p: ParamAccess, ctx: PlanContext): PlannedWrite[] => {
    const selected = p.mask('channels');
    const writes: PlannedWrite[] = [];
    for (let i = 0; i < selected.length; i++) {
      if (!selected[i]) continue;
      const cardIndex = Math.floor(i / cols);
      const ch = i % cols;
      // Each channel carries its own thresholds.
      const v = ctx.channel(cardIndex, ch);
      writes.push({
        register,
        cardIndex,
        note: `Card ${cardIndex + 1}, channel ${ch}`,
        params: {
          ch_num: ch,
          on1: v.bool('on1'),
          on2: v.bool('on2'),
          pol: v.bool('pol'),
          chtrg_type: v.bool('chtrg_type'),
          rf1: v.bool('rf1'),
          rf2: v.bool('rf2'),
          athr1: v.int('athr1'),
          athr2: v.int('athr2'),
          athr3: v.int('athr3'),
          athr4: v.int('athr4'),
          tthr1: nsToTbins(v.int('tthr1_ns')),
          tthr2: nsToTbins(v.int('tthr2_ns')),
          tthr3: nsToTbins(v.int('tthr3_ns')),
          tthr4: nsToTbins(v.int('tthr4_ns')),
          qthr1: v.int('qthr1'),
          qthr2: v.int('qthr2'),
          qthr4: v.int('qthr4'),
          qthr5: v.int('qthr5'),
          maskthr1: nsToTbins(v.int('maskthr1')),
          maskthr2: nsToTbins(v.int('maskthr2')),
        },
      });
    }
    return writes;
  };
}

export const PMT_ACTIONS: ConfigAction[] = [
  {
    id: 'pmt.channelTrigger',
    section: 'pmt',
    group: 'PMT',
    title: 'Channel trigger configuration',
    description:
      'Per-channel amplitude, time and charge thresholds, written to every selected ' +
      'channel on every selected card.',
    origin: 'CH TRG Conf A / B / Ext tabs',
    params: triggerThresholdParams('pmt', 12, 'PMT'),
    plan: planChannelTrigger('PMTDaqConfReg4_19', 12),
  },
  {
    id: 'pmt.blr',
    section: 'pmt',
    group: 'PMT',
    title: 'Baseline restorer (BLR)',
    description: 'Baseline restoration and high-pass filter settings, per channel.',
    origin: 'BLR Conf tab',
    params: [
      grid('channels', 'Channels', 'pmt', 12, 'PMT'),
      bool('on', 'ON'),
      bool('rst', 'RST'),
      bool('dm', 'DM'),
      bool('trgm', 'TRGM'),
      bool('hpf', 'HPF'),
      bool('dwi', 'DWI'),
      choice('mau_size', 'MAU size', [
        [128, '128 stages'],
        [256, '256 stages'],
        [512, '512 stages'],
        [1024, '1024 stages'],
      ], 256),
      int('mau_thr', 'MAU threshold', 255, 0, { unit: 'counts' }),
      int('blr_thrh', 'BLR accumulator threshold H', 255, 0, { unit: 'counts' }),
      int('blr_thrl', 'BLR accumulator threshold L', 255, 0, { unit: 'counts' }),
      int('timetoabort_us', 'BLR time to abort', 1600, 0, { unit: 'µs' }),
      int('blr_coefL', 'BLR coefficient, low word', 65535, 0),
      int('blr_coefH', 'BLR coefficient, high byte', 255, 0),
      int('blr_dischcoefL', 'Discharge adaptation threshold', 65535, 0),
      int('blr_dischcoefH', 'Discharge adaptation line', 65535, 0),
      int('hpf_A1L', 'HPF A1, low word', 65535, 0),
      int('hpf_A1H', 'HPF A1, high byte', 255, 0),
      int('hpf_GL', 'HPF gain, low word', 65535, 0),
      int('lineslope_index', 'Line slope index', 4095, 0),
      int('line_index', 'Line index', 15, 0),
    ],
    plan: (p, ctx): PlannedWrite[] => {
      const selected = p.mask('channels');
      const writes: PlannedWrite[] = [];
      for (let i = 0; i < selected.length; i++) {
        if (!selected[i]) continue;
        const cardIndex = Math.floor(i / 12);
        const ch = i % 12;
        const v = ctx.channel(cardIndex, ch);
        writes.push({
          register: 'PMTDaqConfReg21_36',
          cardIndex,
          note: `Card ${cardIndex + 1}, channel ${ch}`,
          params: {
            ch_num: ch,
            on: v.bool('on'),
            rst: v.bool('rst'),
            dm: v.bool('dm'),
            trgm: v.bool('trgm'),
            hpf: v.bool('hpf'),
            dwi: v.bool('dwi'),
            mau_size: v.int('mau_size'),
            mau_thr: v.int('mau_thr'),
            blr_thrh: v.int('blr_thrh'),
            blr_thrl: v.int('blr_thrl'),
            blr_coefL: v.int('blr_coefL'),
            blr_coefH: v.int('blr_coefH'),
            blr_dischcoefL: v.int('blr_dischcoefL'),
            blr_dischcoefH: v.int('blr_dischcoefH'),
            timetoabort: usToSamples(v.int('timetoabort_us')),
            hpf_A1L: v.int('hpf_A1L'),
            hpf_A1H: v.int('hpf_A1H'),
            hpf_GL: v.int('hpf_GL'),
            lineslope_index: v.int('lineslope_index'),
            line_index: v.int('line_index'),
          },
        });
      }
      return writes;
    },
  },
  {
    id: 'pmt.blrSaturation',
    section: 'pmt',
    group: 'PMT',
    title: 'BLR saturation',
    origin: 'BLR Sat Conf tab',
    params: [
      int('timetoabort_us', 'BLR time to abort', 1600, 0, { unit: 'µs' }),
      int('thrH', 'Channel threshold H', 4095, 0, { unit: 'counts' }),
      int('thrL', 'Channel threshold L', 4095, 0, { unit: 'counts' }),
    ],
    plan: (p): PlannedWrite[] => [
      {
        register: 'PMTDaqConfReg55',
        note: 'Saturation thresholds and abort time',
        params: {
          timetoabort: usToSamples(p.int('timetoabort_us')),
          thrH: p.int('thrH'),
          thrL: p.int('thrL'),
        },
      },
    ],
  },
  {
    id: 'pmt.dataChannels',
    section: 'pmt',
    group: 'PMT',
    title: 'Data memory channels',
    description: 'Which PMT channels are written to data memory, and the MAU settings.',
    origin: 'Data Sel tab',
    params: [
      mask('channels', 'PMT channels enabled', 12, 'high', 'PMT'),
      bool('on', 'Enabled'),
      bool('data_send', 'Send data'),
      bool('rst_mau', 'Reset MAU'),
      uint('mau_size', 'MAU size', 2, 0),
    ],
    plan: (p): PlannedWrite[] => [
      {
        register: 'PMTDaqConfReg16',
        note: 'PMT data channel enables',
        params: {
          channels: p.mask('channels'),
          on: p.bool('on'),
          data_send: p.bool('data_send'),
          rst_mau: p.bool('rst_mau'),
          mau_size: p.int('mau_size'),
        },
      },
    ],
  },
  {
    id: 'pmt.baseline',
    section: 'pmt',
    group: 'PMT',
    title: 'Baseline subtraction',
    params: [
      bool('bs_on', 'Baseline subtraction on'),
      bool('mau_16', 'MAU 16'),
      int('bs_offset', 'Baseline offset', 4095, 0, { unit: 'counts' }),
      int('bs_thr', 'Baseline threshold', 255, 0, { unit: 'counts' }),
      int('bs_detectthr', 'Baseline detection threshold', 255, 0, { unit: 'counts' }),
    ],
    plan: (p): PlannedWrite[] => [
      {
        register: 'PMTDaqConfReg20',
        note: 'PMT baseline subtraction',
        params: {
          bs_on: p.bool('bs_on'),
          mau_16: p.bool('mau_16'),
          bs_offset: p.int('bs_offset'),
          bs_thr: p.int('bs_thr'),
          bs_detectthr: p.int('bs_detectthr'),
        },
      },
    ],
  },
  {
    id: 'pmt.dataCompression',
    section: 'pmt',
    group: 'PMT',
    title: 'Data compression',
    origin: 'Data Compression Conf tab',
    params: [bool('trg1on', 'On for trigger 1'), bool('trg2on', 'On for trigger 2')],
    plan: (p): PlannedWrite[] => [
      {
        register: 'PMTDaqConfReg3',
        note: 'PMT data compression per trigger',
        params: { trg1on: p.bool('trg1on'), trg2on: p.bool('trg2on') },
      },
    ],
  },
];

export const BF_ACTIONS: ConfigAction[] = [
  {
    id: 'bf.channelTrigger',
    section: 'bf',
    group: 'BF',
    title: 'Channel trigger configuration',
    description:
      'Per-channel thresholds for the energy plane. Each FEC carries twelve trigger ' +
      'channels and is configured independently.',
    origin: 'CH TRG Conf A tab — Internal BF Trigger Configuration',
    params: triggerThresholdParams('bf', 12, 'BF'),
    plan: planChannelTrigger('BFDaqConfReg4_19', 12),
  },
  {
    id: 'bf.triggerSum',
    section: 'bf',
    group: 'BF',
    title: 'Trigger sum / data channels',
    description:
      'Enables the trigger sum and selects which channels take part, per FEC. This is ' +
      'what "Activate TRG SUM" did: it wrote BFDaqConfReg16 to each selected FEC in turn.',
    origin: 'BF Conf tab + CH TRG Conf A — Activate TRG SUM',
    params: [
      grid('channels', 'Channels in the sum', 'bf', 12, 'BF', 'mask'),
      bool('on', 'Trigger sum on'),
      bool('data_send', 'Send data'),
      bool('lg_hg', 'Sum high gain (off = low gain)'),
    ],
    plan: (p): PlannedWrite[] => {
      const selected = p.mask('channels');
      const cols = 12;
      const cards = Math.ceil(selected.length / cols);
      const writes: PlannedWrite[] = [];

      // One write per card, carrying that card's twelve channel bits.
      for (let card = 0; card < cards; card++) {
        const channels = selected.slice(card * cols, card * cols + cols);
        if (!channels.some(Boolean)) continue;
        writes.push({
          register: 'BFDaqConfReg16',
          cardIndex: card,
          note: `Card ${card + 1} — ${channels.filter(Boolean).length} channel(s) in the sum`,
          params: {
            channels,
            on: p.bool('on'),
            data_send: p.bool('data_send'),
            lg_hg: p.bool('lg_hg'),
          },
        });
      }
      return writes;
    },
  },
  {
    id: 'bf.triggerSelect',
    section: 'bf',
    group: 'BF',
    title: 'Trigger channel selector',
    description: 'Which 12 of the 24 energy-plane channels take part in the trigger sum.',
    origin: 'TRG General Conf tab — Internal BF Trigger Selector',
    params: [mask('trgsel', 'Channels selected for trigger', 12, 'high', 'BF')],
    plan: (p): PlannedWrite[] => [
      {
        register: 'BFDaqConfReg21',
        note: 'BF trigger source selection',
        params: { trgsel: p.mask('trgsel') },
      },
    ],
  },
  {
    id: 'bf.baseline',
    section: 'bf',
    group: 'BF',
    title: 'Baseline and MAU',
    origin: 'BF CH Baseline conf tab',
    params: [
      bool('bs_on', 'Baseline subtraction on'),
      bool('mau_16', 'MAU 16'),
      int('bs_offset', 'Baseline offset', 4095, 0, { unit: 'counts' }),
      int('bs_thr', 'Baseline threshold', 255, 0, { unit: 'counts' }),
      int('bs_detectthr', 'Baseline detection threshold', 255, 0, { unit: 'counts' }),
      bool('mau_rst', 'Reset MAU'),
      uint('mau_sz', 'MAU size', 3, 0),
      int('baseline_diff', 'Baseline difference', 4095, 0, { unit: 'counts' }),
    ],
    plan: (p): PlannedWrite[] => [
      {
        register: 'BFDaqConfReg20',
        note: 'BF baseline subtraction',
        params: {
          bs_on: p.bool('bs_on'),
          mau_16: p.bool('mau_16'),
          bs_offset: p.int('bs_offset'),
          bs_thr: p.int('bs_thr'),
          bs_detectthr: p.int('bs_detectthr'),
        },
      },
      {
        register: 'BFDaqConfReg22',
        note: 'BF MAU and baseline difference',
        params: {
          mau_rst: p.bool('mau_rst'),
          mau_sz: p.int('mau_sz'),
          baseline_diff: p.int('baseline_diff'),
        },
      },
    ],
  },
];
