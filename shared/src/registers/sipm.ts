import { channelMask, flag } from '../words.js';
import { CMD_CONFIG } from '../encode.js';
import type { RegisterDef } from '../types.js';
import { bool, int, mask, uint } from './spec.js';

/** SiPM DAQ-side registers (on the FEC). */
export const SIPM_DAQ_REGISTERS: RegisterDef[] = [
  {
    id: 'SiPMDaqConfReg1',
    group: 'SIPM_DAQ',
    title: 'FEC connected mask',
    regAddr: 0x0001,
    cmdCode: CMD_CONFIG,
    target: 'sipm',
    params: [mask('cards', 'FECs connected', 16, 'low', 'FEC')],
    payload: (p, w) => w.push(...channelMask(p.mask('cards'), 16, 'low')),
    notes: 'Active-low mask, matching TrgConfReg1.',
  },
  {
    id: 'SiPMDaqConfReg3',
    group: 'SIPM_DAQ',
    title: 'Data framing and event count',
    regAddr: 0x0003,
    cmdCode: CMD_CONFIG,
    target: 'sipm',
    params: [
      bool('endone', 'Enable "done" flag'),
      bool('enheader', 'Enable header'),
      bool('enchdisc', 'Enable channel discrimination'),
      int('cnt', 'Event count', 0x1fffffff),
    ],
    payload: (p, w) => {
      const cnt = p.int('cnt');
      w.push(
        flag(p.bool('endone'), 0x8000) |
          flag(p.bool('enheader'), 0x4000) |
          flag(p.bool('enchdisc'), 0x2000) |
          ((cnt >> 16) & 0x1fff),
      );
      w.push(cnt);
    },
  },
  {
    id: 'SiPMDaqConfReg4',
    group: 'SIPM_DAQ',
    title: 'Discrimination thresholds',
    regAddr: 0x0004,
    cmdCode: CMD_CONFIG,
    target: 'sipm',
    params: [uint('ThrAssert', 'Assert threshold', 16), uint('ThrNegate', 'Negate threshold', 16)],
    payload: (p, w) => w.push(p.int('ThrAssert'), p.int('ThrNegate')),
  },
  {
    id: 'SiPMDaqConfReg5',
    group: 'SIPM_DAQ',
    title: 'Compression',
    regAddr: 0x0005,
    cmdCode: CMD_CONFIG,
    target: 'sipm',
    params: [bool('compr_on', 'Compression on')],
    payload: (p, w) => w.push(flag(p.bool('compr_on'), 0x0001)),
  },
];

/** SiPM front-end (FEB) registers. */
export const SIPM_FE_REGISTERS: RegisterDef[] = [
  {
    id: 'SiPMFEConfReg1',
    group: 'SIPM_FE',
    title: 'SiPM sensor enable mask',
    regAddr: 0x0001,
    cmdCode: CMD_CONFIG,
    target: 'explicit',
    port: 'feCmd',
    params: [mask('sensors', 'SiPM sensors', 64, 'high', 'SiPM')],
    payload: (p, w) => w.push(...channelMask(p.mask('sensors'), 64, 'high')),
    notes: '64 sensors across four words, low sensor index in the low bit of the first word.',
  },
  {
    id: 'SiPMFEConfReg2',
    group: 'SIPM_FE',
    title: 'Baseline reference and thresholds',
    regAddr: 0x0002,
    cmdCode: CMD_CONFIG,
    target: 'broadcast',
    port: 'fe',
    params: [
      bool('ref', 'Reference mode'),
      bool('init', 'Initialise'),
      bool('rst', 'Reset'),
      uint('bs_ref', 'Baseline reference', 12),
      uint('min_thr', 'Minimum threshold', 8),
      uint('steph', 'Step high', 4),
      uint('stepl', 'Step low', 4),
      uint('init_value', 'Initial value', 16),
      uint('thrh', 'Threshold high', 8),
      uint('thrl', 'Threshold low', 8),
    ],
    payload: (p, w) => {
      w.push(
        flag(p.bool('ref'), 0x8000) |
          flag(p.bool('init'), 0x4000) |
          flag(p.bool('rst'), 0x2000) |
          p.int('bs_ref'),
      );
      w.push((p.int('steph') << 12) | (p.int('stepl') << 8) | p.int('min_thr'));
      w.push(p.int('init_value'));
      w.push((p.int('thrh') << 8) | p.int('thrl'));
    },
  },
  {
    id: 'SiPMFEConfReg3',
    group: 'SIPM_FE',
    title: 'Zero suppression',
    regAddr: 0x0003,
    cmdCode: CMD_CONFIG,
    target: 'broadcast',
    port: 'fe',
    params: [
      bool('zstrg1_on', 'Zero suppression trigger 1'),
      bool('zstrg2_on', 'Zero suppression trigger 2'),
      uint('thrs', 'Threshold', 12),
      uint('pres', 'Pre-samples', 8),
      uint('posts', 'Post-samples', 8),
      uint('filts', 'Filter samples', 4),
      uint('delay', 'Delay', 14),
    ],
    payload: (p, w) => {
      w.push((p.int('filts') << 12) | p.int('thrs'));
      w.push((p.int('posts') << 8) | p.int('pres'));
      w.push(
        (p.int('delay') << 2) |
          flag(p.bool('zstrg1_on'), 0x0001) |
          flag(p.bool('zstrg2_on'), 0x0002),
      );
    },
  },
  {
    id: 'SiPMFEConfReg4',
    group: 'SIPM_FE',
    title: 'Front-end address assignment',
    regAddr: 0x0004,
    cmdCode: CMD_CONFIG,
    target: 'broadcast',
    port: 'fe',
    params: [
      uint('destFEadd', 'Destination FE address', 8),
      uint('newFEadd', 'New FE address', 8),
    ],
    payload: (p, w) => w.push((p.int('destFEadd') << 8) | p.int('newFEadd')),
  },
  {
    id: 'SiPMFEConfReg5',
    group: 'SIPM_FE',
    title: 'Calibration pulse train',
    regAddr: 0x0005,
    cmdCode: CMD_CONFIG,
    target: 'feBoard',
    port: 'feCmd',
    boardParam: 'fenum',
    params: [
      bool('calon', 'Calibration on'),
      int('trg_mask', 'Trigger mask', 0x3ffffff, 4000000, { unit: 'ticks' }),
      uint('timepulseon', 'Pulse on time', 16),
      uint('timepulseoff', 'Pulse off time', 16),
      uint('trainfreq', 'Train frequency', 16, 1),
      uint('pulsefreq', 'Pulse frequency', 16),
      uint('fenum', 'Front-end number', 16),
    ],
    payload: (p, w) => {
      const trgMask = p.int('trg_mask');
      w.push(flag(p.bool('calon'), 0x8000) | (1023 & (trgMask >> 16)));
      w.push(0xffff & trgMask);
      w.push(p.int('timepulseon'), p.int('timepulseoff'));
      w.push(p.int('trainfreq'), p.int('pulsefreq'), p.int('fenum'));
    },
  },
  {
    id: 'SiPMFEConfReg6',
    group: 'SIPM_FE',
    title: 'Clock synthesis',
    regAddr: 0x0006,
    cmdCode: CMD_CONFIG,
    target: 'broadcast',
    port: 'fe',
    params: [
      bool('state', 'Enabled'),
      uint('clkout_divide', 'Clock out divider', 8),
      uint('divclk_divide', 'Divided clock divider', 7),
      uint('clkbout_mult', 'Clock B multiplier', 16),
    ],
    payload: (p, w) => {
      w.push(
        flag(p.bool('state'), 0x8000) |
          (p.int('clkout_divide') << 7) |
          p.int('divclk_divide'),
      );
      w.push(p.int('clkbout_mult'));
    },
  },
  {
    id: 'SiPMFEConfReg7',
    group: 'SIPM_FE',
    title: 'Time stamp control',
    regAddr: 0x0007,
    cmdCode: CMD_CONFIG,
    target: 'broadcast',
    port: 'fe',
    params: [int('time', 'Time', 0x7fff), bool('time_on', 'Time enabled')],
    payload: (p, w) => w.push((p.int('time') << 1) | flag(p.bool('time_on'), 0x0001)),
  },
  {
    id: 'SiPMFEConfReg8',
    group: 'SIPM_FE',
    title: 'ADC / DAC power and init',
    regAddr: 0x0008,
    cmdCode: CMD_CONFIG,
    target: 'explicit',
    port: 'fe',
    params: [
      bool('DACinit', 'DAC initialise'),
      bool('sdwADC', 'Shutdown ADC'),
      bool('sdwH', 'Shutdown high'),
      bool('sdwL', 'Shutdown low'),
      uint('SwitchStep', 'Switch step', 7),
      uint('ADCInitStep', 'ADC init step', 7),
      uint('ADCCsEn', 'ADC chip-select enable', 7),
      bool('DACPwDown', 'DAC power down'),
      uint('DACPwDownMode', 'DAC power-down mode', 2),
      bool('ADCDisH', 'Disable ADC high'),
      bool('ADCDisL', 'Disable ADC low'),
    ],
    payload: (p, w) => {
      w.push((p.int('ADCInitStep') << 9) | (p.int('ADCCsEn') << 2));
      w.push(
        (p.int('SwitchStep') << 9) |
          flag(p.bool('ADCDisH'), 0x0100) |
          flag(p.bool('ADCDisL'), 0x0080) |
          flag(p.bool('DACPwDown'), 0x0040) |
          (p.int('DACPwDownMode') << 4) |
          flag(p.bool('DACinit'), 0x0008) |
          flag(p.bool('sdwADC'), 0x0004) |
          flag(p.bool('sdwH'), 0x0002) |
          flag(p.bool('sdwL'), 0x0001),
      );
    },
  },
  {
    id: 'SiPMFEConfReg9',
    group: 'SIPM_FE',
    title: 'Safety / watchdog',
    regAddr: 0x0009,
    cmdCode: CMD_CONFIG,
    target: 'explicit',
    port: 'fe',
    params: [
      bool('SafeEn', 'Safety enabled'),
      int('TimeShd', 'Shutdown time', 0x3fffff),
      uint('TimeInit', 'Init time', 16),
      uint('TimeChk', 'Check time', 10),
      uint('Thrh', 'Threshold high', 8),
      uint('Thrl', 'Threshold low', 8),
      uint('ErrorLimit', 'Error limit', 16),
    ],
    payload: (p, w) => {
      const timeShd = p.int('TimeShd');
      w.push((timeShd >> 6) | flag(p.bool('SafeEn'), 0x8000));
      w.push((timeShd << 10) | p.int('TimeChk'));
      w.push(p.int('ErrorLimit'));
      w.push((p.int('Thrh') << 8) | p.int('Thrl'));
      w.push(p.int('TimeInit'));
    },
  },
  {
    id: 'SiPMFEConfReg10',
    group: 'SIPM_FE',
    title: 'Baseline restorer threshold',
    regAddr: 0x000a,
    cmdCode: CMD_CONFIG,
    target: 'broadcast',
    port: 'fe',
    params: [bool('Bar_on', 'Baseline restorer on'), uint('Bar_thr', 'Baseline threshold', 15)],
    payload: (p, w) => w.push((p.int('Bar_thr') << 1) | flag(p.bool('Bar_on'), 0x0001)),
  },
];
