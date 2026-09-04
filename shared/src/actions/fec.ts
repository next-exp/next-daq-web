import { usToSamples } from '../units.js';
import { bool, choice, int, mask, uint } from '../registers/spec.js';
import type { ConfigAction, PlannedWrite } from './types.js';

/**
 * Card, link and test panels — which FECs are connected, error and throughput
 * control, resets, and the signal-test pulse generators.
 */
export const FEC_ACTIONS: ConfigAction[] = [
  {
    id: 'fec.connected',
    section: 'fec',
    group: 'TRG',
    title: 'Cards connected',
    description:
      'Which FECs each plane should expect. Note the masks reach the hardware with ' +
      'different polarity per plane, which this handles.',
    origin: 'FEC Conf tab — Number of cards connected',
    params: [
      mask('trg_cards', 'Trigger — FECs connected', 13, 'low', 'FEC'),
      mask('pmt_cards', 'PMT — FECs connected', 16, 'high', 'FEC'),
      mask('bf_cards', 'BF — FECs connected', 24, 'high', 'FEC'),
      mask('sipm_cards', 'SiPM — FECs connected', 16, 'low', 'FEC'),
    ],
    plan: (p): PlannedWrite[] => [
      {
        register: 'TrgConfReg1',
        note: 'Trigger card mask (active-low on the wire)',
        params: { cards: p.mask('trg_cards') },
      },
      {
        register: 'PMTDaqConfReg1',
        note: 'PMT card mask (active-high on the wire)',
        params: { cards: p.mask('pmt_cards') },
      },
      {
        register: 'BFDaqConfReg1',
        note: 'BF card mask (active-high on the wire)',
        params: { cards: p.mask('bf_cards') },
      },
      {
        register: 'SiPMDaqConfReg1',
        note: 'SiPM card mask (active-low on the wire)',
        params: { cards: p.mask('sipm_cards') },
      },
    ],
  },
  {
    id: 'fec.reset',
    section: 'fec',
    group: 'TRG',
    title: 'Reset and link realignment',
    description:
      'DTC recovery. Per-card link realignment and module reset only take effect when ' +
      'the matching action is armed.',
    origin: 'DTC Recovery conf tab',
    params: [
      bool('rst_dtc', 'Reset DTC'),
      bool('rst_stack', 'Reset stack'),
      bool('resume', 'Resume'),
      bool('realignall', 'Realign all'),
      bool('realignlink', 'Realign link on the selected cards'),
      bool('rst_module', 'Reset module on the selected cards'),
      mask('cards', 'Cards', 13, 'high', 'FEC'),
    ],
    plan: (p): PlannedWrite[] => [
      {
        register: 'TrgConfReg12',
        note: 'Reset / realign control',
        params: {
          rst_dtc: p.bool('rst_dtc'),
          rst_stack: p.bool('rst_stack'),
          resume: p.bool('resume'),
          realignall: p.bool('realignall'),
          realignlink: p.bool('realignlink'),
          rst_module: p.bool('rst_module'),
          cards: p.mask('cards'),
        },
      },
    ],
  },
  {
    id: 'fec.errors',
    section: 'fec',
    group: 'SIPM_DAQ',
    title: 'Error counters',
    origin: 'FEC Err Conf tab',
    params: [
      bool('endone', 'Enable channel DONE'),
      bool('enheader', 'Enable channel CONF DONE'),
      bool('enchdisc', 'Enable channel DISCONNECT'),
      int('cnt', 'Error counter', 0x1fffffff, 0),
    ],
    plan: (p): PlannedWrite[] => [
      {
        register: 'SiPMDaqConfReg3',
        note: 'Error counter enables',
        params: {
          endone: p.bool('endone'),
          enheader: p.bool('enheader'),
          enchdisc: p.bool('enchdisc'),
          cnt: p.int('cnt'),
        },
      },
    ],
  },
  {
    id: 'fec.throughput',
    section: 'fec',
    group: 'PMT',
    title: 'Throughput control',
    description: 'Per-plane throughput limit, applied to the PMT and energy planes.',
    origin: 'Throughput Conf tab',
    params: [
      bool('pmt_on', 'PMT limit on'),
      bool('bf_on', 'BF limit on'),
      bool('trg2nowait', 'TRG2 without throughput control'),
      int('throughput_mbs', 'Throughput limit', 120, 0, { unit: 'MBytes/s' }),
    ],
    plan: (p): PlannedWrite[] => {
      // The register counts bytes per second; the panel is labelled in MBytes/s.
      const throughput = p.int('throughput_mbs') * 1_000_000;
      return [
        {
          register: 'PMTDaqConfReg53',
          note: 'PMT throughput limit',
          params: { on: p.bool('pmt_on'), trg2nowait: p.bool('trg2nowait'), throughput },
        },
        {
          register: 'BFDaqConfReg53',
          note: 'BF throughput limit',
          params: { on: p.bool('bf_on'), trg2nowait: p.bool('trg2nowait'), throughput },
        },
      ];
    },
  },
  {
    id: 'fec.link',
    section: 'fec',
    group: 'GEN',
    title: 'Gigabit link configuration',
    origin: 'GbE tab',
    params: [
      bool('wait_ack', 'Wait for ACK', true),
      int('frame_length', 'Frame length', 32767, 0, { unit: 'bytes' }),
      int('frame_dly', 'Frame delay', 65535, 0),
      int('maxtot_frames', 'Max total frames', 65535, 0),
      bool('txh_pol', 'TX high polarity'),
      bool('rxh_pol', 'RX high polarity'),
      bool('txl_pol', 'TX low polarity'),
      bool('rxl_pol', 'RX low polarity'),
      uint('tx_post_emph', 'TX post-emphasis', 6, 0),
      uint('tx_pre_emph', 'TX pre-emphasis', 4, 0),
      uint('tx_mVppd', 'TX amplitude', 3, 0),
      uint('rx_eq', 'RX equalisation', 3, 0),
    ],
    plan: (p): PlannedWrite[] => [
      {
        register: 'GenConfReg2',
        note: 'Serial transceiver settings',
        params: {
          wait_ack: p.bool('wait_ack'),
          frame_length: p.int('frame_length'),
          frame_dly: p.int('frame_dly'),
          maxtot_frames: p.int('maxtot_frames'),
          txh_pol: p.bool('txh_pol'),
          rxh_pol: p.bool('rxh_pol'),
          txl_pol: p.bool('txl_pol'),
          rxl_pol: p.bool('rxl_pol'),
          tx_post_emph: p.int('tx_post_emph'),
          tx_pre_emph: p.int('tx_pre_emph'),
          tx_mVppd: p.int('tx_mVppd'),
          rx_eq: p.int('rx_eq'),
        },
      },
    ],
  },
  {
    id: 'fec.prbs',
    section: 'fec',
    group: 'CMD',
    title: 'PRBS link test',
    origin: 'SiPM FEB Conn tab — PRBS button',
    params: [bool('on', 'PRBS enabled')],
    plan: (p): PlannedWrite[] => [
      { register: 'PRBSCmd', note: 'PRBS pattern', params: { on: p.bool('on') } },
    ],
  },
];

export const TEST_ACTIONS: ConfigAction[] = [
  {
    id: 'test.signal',
    section: 'test',
    group: 'PMT',
    title: 'Signal test generator',
    description:
      'Injects a test pulse. Generator 1 drives PMT/BF odd channels and SiPM 1-32; ' +
      'generator 2 drives the even channels and SiPM 33-64.',
    origin: 'Test Conf tab',
    params: [
      bool('gen1_on', 'Generator 1 on'),
      bool('gen2_on', 'Generator 2 on'),
      int('period_us', 'Period', 107_000_000, 0, { unit: 'µs' }),
      int('timepulse_us', 'Time pulse', 1600, 0, { unit: 'µs' }),
      int('chH', 'Channel H value', 4095, 0, { unit: 'counts' }),
      int('chL', 'Channel L value', 4095, 0, { unit: 'counts' }),
      int('dly', 'Channel time delay', 127, 0, { unit: 'tbins' }),
    ],
    plan: (p): PlannedWrite[] => {
      const shared = {
        timeperiod: usToSamples(p.int('period_us')),
        timepulse: usToSamples(p.int('timepulse_us')),
        chH: p.int('chH'),
        chL: p.int('chL'),
        dly: p.int('dly'),
      };
      return [
        {
          register: 'PMTDaqConfReg56',
          note: 'Generator 1 — odd channels',
          params: { ...shared, on: p.bool('gen1_on') },
        },
        {
          register: 'PMTDaqConfReg57',
          note: 'Generator 2 — even channels',
          params: { ...shared, on: p.bool('gen2_on') },
        },
      ];
    },
  },
  {
    id: 'test.timestamp',
    section: 'test',
    group: 'PMT',
    title: 'Time stamp control',
    params: [
      bool('time_on', 'Time stamping enabled'),
      int('time', 'Time', 32767, 0),
    ],
    plan: (p): PlannedWrite[] => [
      {
        register: 'PMTDaqConfReg58',
        note: 'PMT time stamp',
        params: { time: p.int('time'), time_on: p.bool('time_on') },
      },
      {
        register: 'SiPMFEConfReg7',
        note: 'SiPM front-end time stamp',
        params: { time: p.int('time'), time_on: p.bool('time_on') },
      },
    ],
  },
];
