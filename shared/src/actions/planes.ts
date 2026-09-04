import { nsToTbins, usToSamples } from '../units.js';
import { bool, choice, int, mask, uint } from '../registers/spec.js';
import type { ConfigAction, PlannedWrite } from './types.js';
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
function triggerThresholdParams(channels: number, itemLabel: string) {
  return [
    mask('channels', 'Channels selected to trigger', channels, 'high', itemLabel),
    bool('on1', 'Trigger 1 on'),
    bool('on2', 'Trigger 2 on'),
    bool('pol', 'Invert polarity'),
    bool('chtrg_type', 'Trigger B'),
    bool('rf1', 'Trigger 1 — full time at end'),
    bool('rf2', 'Trigger 2 — full time at end'),

    int('athr1', 'Trigger 1 — baseline deviation', 4095, 0, { unit: 'counts' }),
    int('athr2', 'Trigger 1 — max amplitude', 4095, 0, { unit: 'counts' }),
    int('tthr1_ns', 'Trigger 1 — min time threshold', 1_600_000, 0, { unit: 'ns' }),
    int('tthr2_ns', 'Trigger 1 — max time threshold', 1_600_000, 0, { unit: 'ns' }),
    int('qthr1', 'Trigger 1 — Q min', 4_194_303, 0, { unit: 'counts acc.' }),
    int('qthr2', 'Trigger 1 — Q max', 134_217_727, 0, { unit: 'counts acc.' }),
    int('maskthr1', 'Trigger 1 — pulse valid extension', 10_000, 0, { unit: 'ns' }),

    int('athr3', 'Trigger 2 — baseline deviation', 4095, 0, { unit: 'counts' }),
    int('athr4', 'Trigger 2 — max amplitude', 4095, 0, { unit: 'counts' }),
    int('tthr3_ns', 'Trigger 2 — min time threshold', 1_600_000, 0, { unit: 'ns' }),
    int('tthr4_ns', 'Trigger 2 — max time threshold', 1_600_000, 0, { unit: 'ns' }),
    int('qthr4', 'Trigger 2 — Q min', 4_194_303, 0, { unit: 'counts acc.' }),
    int('qthr5', 'Trigger 2 — Q max', 134_217_727, 0, { unit: 'counts acc.' }),
    int('maskthr2', 'Trigger 2 — pulse valid extension', 10_000, 0, { unit: 'ns' }),
  ];
}

/** One write per selected channel, mirroring the original's per-channel loop. */
function planChannelTrigger(register: string, count: number) {
  return (p: ParamAccess): PlannedWrite[] => {
    const selected = p.mask('channels');
    const writes: PlannedWrite[] = [];
    for (let ch = 0; ch < count; ch++) {
      if (!selected[ch]) continue;
      writes.push({
        register,
        note: `Channel ${ch}`,
        params: {
          ch_num: ch,
          on1: p.bool('on1'),
          on2: p.bool('on2'),
          pol: p.bool('pol'),
          chtrg_type: p.bool('chtrg_type'),
          rf1: p.bool('rf1'),
          rf2: p.bool('rf2'),
          athr1: p.int('athr1'),
          athr2: p.int('athr2'),
          athr3: p.int('athr3'),
          athr4: p.int('athr4'),
          tthr1: nsToTbins(p.int('tthr1_ns')),
          tthr2: nsToTbins(p.int('tthr2_ns')),
          tthr3: nsToTbins(p.int('tthr3_ns')),
          tthr4: nsToTbins(p.int('tthr4_ns')),
          qthr1: p.int('qthr1'),
          qthr2: p.int('qthr2'),
          qthr4: p.int('qthr4'),
          qthr5: p.int('qthr5'),
          maskthr1: nsToTbins(p.int('maskthr1')),
          maskthr2: nsToTbins(p.int('maskthr2')),
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
      'Per-channel amplitude, time and charge thresholds. The settings are written to ' +
      'every selected channel.',
    origin: 'CH TRG Conf A / B / Ext tabs',
    params: triggerThresholdParams(12, 'PMT'),
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
      mask('channels', 'Channels', 12, 'high', 'PMT'),
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
    plan: (p): PlannedWrite[] => {
      const selected = p.mask('channels');
      const writes: PlannedWrite[] = [];
      for (let ch = 0; ch < 12; ch++) {
        if (!selected[ch]) continue;
        writes.push({
          register: 'PMTDaqConfReg21_36',
          note: `Channel ${ch}`,
          params: {
            ch_num: ch,
            on: p.bool('on'),
            rst: p.bool('rst'),
            dm: p.bool('dm'),
            trgm: p.bool('trgm'),
            hpf: p.bool('hpf'),
            dwi: p.bool('dwi'),
            mau_size: p.int('mau_size'),
            mau_thr: p.int('mau_thr'),
            blr_thrh: p.int('blr_thrh'),
            blr_thrl: p.int('blr_thrl'),
            blr_coefL: p.int('blr_coefL'),
            blr_coefH: p.int('blr_coefH'),
            blr_dischcoefL: p.int('blr_dischcoefL'),
            blr_dischcoefH: p.int('blr_dischcoefH'),
            timetoabort: usToSamples(p.int('timetoabort_us')),
            hpf_A1L: p.int('hpf_A1L'),
            hpf_A1H: p.int('hpf_A1H'),
            hpf_GL: p.int('hpf_GL'),
            lineslope_index: p.int('lineslope_index'),
            line_index: p.int('line_index'),
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
      'Per-channel thresholds for the energy plane, written to every selected channel.',
    origin: 'CH TRG Conf A tab — Internal BF Trigger Configuration',
    params: triggerThresholdParams(16, 'BF'),
    plan: planChannelTrigger('BFDaqConfReg4_19', 16),
  },
  {
    id: 'bf.dataChannels',
    section: 'bf',
    group: 'BF',
    title: 'Data memory channels',
    origin: 'BF Conf tab',
    params: [
      mask('channels', 'BF channels enabled', 12, 'high', 'BF'),
      bool('on', 'Enabled'),
      bool('data_send', 'Send data'),
      bool('lg_hg', 'High gain (off = low gain)'),
    ],
    plan: (p): PlannedWrite[] => [
      {
        register: 'BFDaqConfReg16',
        note: 'BF data channel enables and gain selection',
        params: {
          channels: p.mask('channels'),
          on: p.bool('on'),
          data_send: p.bool('data_send'),
          lg_hg: p.bool('lg_hg'),
        },
      },
    ],
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
