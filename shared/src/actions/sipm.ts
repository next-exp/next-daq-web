import { usToSamples } from '../units.js';
import { bool, choice, int, mask, section, uint } from '../registers/spec.js';
import type { ConfigAction, PlannedWrite } from './types.js';

/**
 * SiPM plane panels — front-end board configuration, LED calibration and the
 * DAQ-side framing settings.
 */
export const SIPM_ACTIONS: ConfigAction[] = [
  {
    id: 'sipm.frontEnd',
    section: 'sipm',
    group: 'SIPM_FE',
    title: 'Front-end configuration',
    description:
      'Baseline reference, zero suppression and DAC/ADC settings for the SiPM front-end ' +
      'boards. Issues the baseline, zero-suppression and power registers together.',
    origin: 'FE Conf tab',
    params: [
      ...section('Baseline (BS register)', [
        bool('ref', 'Reference on'),
        bool('init', 'Initialise DAC'),
        bool('rst', 'Reset DAC'),
        int('bs_ref', 'Baseline reference', 4095, 0, { unit: 'counts' }),
        int('min_thr', 'Minimum adjust threshold', 255, 0, { unit: 'counts' }),
        int('steph', 'Step H', 15, 0, { unit: 'counts' }),
        int('stepl', 'Step L', 15, 0, { unit: 'counts' }),
        int('init_value', 'DAC init value', 3000, 0, { unit: 'counts' }),
        int('thrh', 'Threshold H', 255, 0, { unit: 'counts' }),
        int('thrl', 'Threshold L', 255, 0, { unit: 'counts' }),
      ]),
      ...section('Zero suppression (ZS register)', [
        bool('zstrg1_on', 'TRG1 zero suppression on'),
        bool('zstrg2_on', 'TRG2 zero suppression on'),
        int('thrs', 'Threshold, relative to baseline', 4095, 0, { unit: 'counts' }),
        int('filts', 'Filter samples', 15, 0, { unit: 'samples' }),
        int('pres', 'Pre-samples', 255, 0, { unit: 'samples' }),
        int('posts', 'Post-samples', 255, 0, { unit: 'samples' }),
        int('delay_us', 'Sample delay', 7, 0, { unit: 'µs' }),
      ]),
    ],
    plan: (p): PlannedWrite[] => [
      {
        register: 'SiPMFEConfReg2',
        note: 'Baseline reference and DAC thresholds',
        params: {
          ref: p.bool('ref'),
          init: p.bool('init'),
          rst: p.bool('rst'),
          bs_ref: p.int('bs_ref'),
          min_thr: p.int('min_thr'),
          steph: p.int('steph'),
          stepl: p.int('stepl'),
          init_value: p.int('init_value'),
          thrh: p.int('thrh'),
          thrl: p.int('thrl'),
        },
      },
      {
        register: 'SiPMFEConfReg3',
        note: 'Zero suppression',
        params: {
          zstrg1_on: p.bool('zstrg1_on'),
          zstrg2_on: p.bool('zstrg2_on'),
          thrs: p.int('thrs'),
          pres: p.int('pres'),
          posts: p.int('posts'),
          filts: p.int('filts'),
          delay: usToSamples(p.int('delay_us')),
        },
      },
    ],
  },
  {
    id: 'sipm.sensors',
    section: 'sipm',
    group: 'SIPM_FE',
    title: 'Sensor enable mask',
    description: 'The 64 SiPM sensors on a front-end board.',
    origin: 'SiPM Sensors Conf tab',
    params: [mask('sensors', 'SiPM sensors connected', 64, 'high', 'SiPM')],
    plan: (p): PlannedWrite[] => [
      {
        register: 'SiPMFEConfReg1',
        note: 'SiPM sensor enables',
        params: { sensors: p.mask('sensors') },
      },
    ],
  },
  {
    id: 'sipm.led',
    section: 'sipm',
    group: 'SIPM_FE',
    title: 'LED calibration',
    description:
      'Turns the calibration LED on or off for the selected SiPM front-end boards. ' +
      'One command is sent per selected board, addressed to that board directly — the ' +
      'original derived the destination as 10.0.(board + 128).1 and looped over the ' +
      'boards ticked in the LED Conf tab.',
    origin: 'LED Conf tab',
    params: [
      bool('calon', 'LED on', false, 'Clear this to switch the selected boards\u2019 LEDs off.'),
      mask('boards', 'Front-end boards', 56, 'high', 'FEB'),
      bool('train_on', 'Pulse train on', false, 'When off, the pulse-off time is sent as 0.'),
      int('timepulseon', 'Time pulse ON', 65535, 0, { unit: '\u00d7 TclkCal steps' }),
      int('timepulseoff', 'Time pulse OFF', 65535, 0, { unit: '\u00d7 TclkCal steps' }),
      int('pulse_period_us', 'Pulse period', 12000, 50, { min: 50, unit: '\u00b5s' }),
      int('train_freq_hz', 'Train frequency', 1000, 1, { min: 1, unit: 'Hz' }),
      int('pulse_freq_hz', 'Pulse frequency', 1000, 1, { min: 1, unit: 'Hz' }),
    ],
    plan: (p): PlannedWrite[] => {
      const boards = p.mask('boards');
      const calon = p.bool('calon');

      // Scale factors from the original handler: trainfreq = 40 x value, and
      // pulsefreq = (40/8) x value because the FPGA multiplies by 8 again.
      // SendFE5Cmd passed `trg_mask - 1` and `trainfreq - 1` but `pulsefreq`
      // undecremented; that asymmetry is deliberate and preserved below.
      const trainfreq = 40 * p.int('train_freq_hz');
      const pulsefreq = Math.trunc(40 / 8) * p.int('pulse_freq_hz');
      let trgMask = usToSamples(p.int('pulse_period_us'));
      // The period must be a whole number of pulse intervals.
      if (pulsefreq > 0 && trgMask % pulsefreq !== 0) {
        trgMask = pulsefreq * Math.trunc(trgMask / pulsefreq);
      }

      const writes: PlannedWrite[] = [];
      for (let board = 0; board < 56; board++) {
        if (!boards[board]) continue;
        writes.push({
          register: 'SiPMFEConfReg5',
          note: `Board ${board} \u2014 LED ${calon ? 'on' : 'off'}`,
          params: {
            calon,
            trg_mask: Math.max(0, trgMask - 1),
            timepulseon: p.int('timepulseon'),
            // A pulse train is only meaningful when it is enabled.
            timepulseoff: p.bool('train_on') ? p.int('timepulseoff') : 0,
            trainfreq: Math.max(0, trainfreq - 1),
            pulsefreq,
            fenum: board,
          },
        });
      }
      return writes;
    },
  },
  {
    id: 'sipm.compression',
    section: 'sipm',
    group: 'SIPM_DAQ',
    title: 'Data compression',
    origin: 'Data Compression tab',
    params: [bool('compr_on', 'SiPM compression on')],
    plan: (p): PlannedWrite[] => [
      {
        register: 'SiPMDaqConfReg5',
        note: 'SiPM data compression',
        params: { compr_on: p.bool('compr_on') },
      },
    ],
  },
  {
    id: 'sipm.ffThreshold',
    section: 'sipm',
    group: 'SIPM_DAQ',
    title: 'Safe card thresholds',
    origin: 'FF Thr tab',
    params: [
      int('ThrAssert', 'Threshold assert', 65535, 0, { unit: 'counts' }),
      int('ThrNegate', 'Threshold negate', 65535, 0, { unit: 'counts' }),
    ],
    plan: (p): PlannedWrite[] => [
      {
        register: 'SiPMDaqConfReg4',
        note: 'Front-end safe thresholds',
        params: { ThrAssert: p.int('ThrAssert'), ThrNegate: p.int('ThrNegate') },
      },
    ],
  },
  {
    id: 'sipm.safety',
    section: 'sipm',
    group: 'SIPM_FE',
    title: 'Safety and watchdog',
    origin: 'Safe Conf tab',
    params: [
      bool('SafeEn', 'Safety enabled'),
      int('TimeShd', 'Shutdown time', 0x3fffff, 0),
      int('TimeInit', 'Init time', 65535, 0),
      int('TimeChk', 'Check time', 1023, 0),
      int('Thrh', 'Threshold H', 255, 0, { unit: 'counts' }),
      int('Thrl', 'Threshold L', 255, 0, { unit: 'counts' }),
      int('ErrorLimit', 'Error limit', 65535, 0),
    ],
    plan: (p): PlannedWrite[] => [
      {
        register: 'SiPMFEConfReg9',
        note: 'Front-end safety watchdog',
        params: {
          SafeEn: p.bool('SafeEn'),
          TimeShd: p.int('TimeShd'),
          TimeInit: p.int('TimeInit'),
          TimeChk: p.int('TimeChk'),
          Thrh: p.int('Thrh'),
          Thrl: p.int('Thrl'),
          ErrorLimit: p.int('ErrorLimit'),
        },
      },
    ],
  },
  {
    id: 'sipm.power',
    section: 'sipm',
    group: 'SIPM_FE',
    title: 'ADC / DAC power',
    origin: 'PWR Conf tab',
    params: [
      bool('DACinit', 'DAC initialise'),
      bool('sdwADC', 'Shut down ADC'),
      bool('sdwH', 'Shut down high'),
      bool('sdwL', 'Shut down low'),
      bool('DACPwDown', 'DAC power down'),
      uint('DACPwDownMode', 'DAC power-down mode', 2, 0),
      bool('ADCDisH', 'Disable ADC high'),
      bool('ADCDisL', 'Disable ADC low'),
      int('SwitchStep', 'Switch step', 127, 0),
      int('ADCInitStep', 'ADC init step', 127, 0),
      int('ADCCsEn', 'ADC chip-select enable', 127, 0),
    ],
    plan: (p): PlannedWrite[] => [
      {
        register: 'SiPMFEConfReg8',
        note: 'Front-end power sequencing',
        params: {
          DACinit: p.bool('DACinit'),
          sdwADC: p.bool('sdwADC'),
          sdwH: p.bool('sdwH'),
          sdwL: p.bool('sdwL'),
          DACPwDown: p.bool('DACPwDown'),
          DACPwDownMode: p.int('DACPwDownMode'),
          ADCDisH: p.bool('ADCDisH'),
          ADCDisL: p.bool('ADCDisL'),
          SwitchStep: p.int('SwitchStep'),
          ADCInitStep: p.int('ADCInitStep'),
          ADCCsEn: p.int('ADCCsEn'),
        },
      },
    ],
  },
  {
    id: 'sipm.barycentre',
    section: 'sipm',
    group: 'SIPM_FE',
    title: 'Barycentre',
    origin: 'Baricenter Conf tab',
    params: [
      bool('Bar_on', 'Barycentre on'),
      int('Bar_thr', 'Barycentre threshold', 32767, 0, { unit: 'counts' }),
    ],
    plan: (p): PlannedWrite[] => [
      {
        register: 'SiPMFEConfReg10',
        note: 'Barycentre threshold',
        params: { Bar_on: p.bool('Bar_on'), Bar_thr: p.int('Bar_thr') },
      },
    ],
  },
  {
    id: 'sipm.clock',
    section: 'sipm',
    group: 'SIPM_FE',
    title: 'Calibration clock synthesis',
    description: 'fclkCal = fIN·(M/D)/D_out — 200 MHz by default.',
    origin: 'LED Conf tab — clock synthesis',
    params: [
      bool('state', 'Enabled'),
      int('clkbout_mult', 'Multiplier (M)', 65535, 1),
      int('divclk_divide', 'Divider (D)', 127, 1),
      int('clkout_divide', 'Output divider (D_out)', 255, 1),
    ],
    plan: (p): PlannedWrite[] => [
      {
        register: 'SiPMFEConfReg6',
        note: 'Calibration clock',
        params: {
          state: p.bool('state'),
          clkout_divide: p.int('clkout_divide'),
          divclk_divide: p.int('divclk_divide'),
          clkbout_mult: p.int('clkbout_mult'),
        },
      },
    ],
  },
];
