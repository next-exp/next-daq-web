import { hzToTrgMask, nsToTbins, usToSamples } from '../units.js';
import { bool, choice, int, mask, section, uint } from '../registers/spec.js';
import type { ConfigAction, PlannedWrite } from './types.js';

/**
 * Run and trigger panels.
 *
 * Ranges and wording follow the labels of the original Swing tabs, which carried
 * the operating limits the detector actually has — e.g. "Circular Buffer Size (us)
 * [20-3200]" and "Coincidence Window Size (25 ns Tbin) [1-63]".
 */
export const RUN_ACTIONS: ConfigAction[] = [
  {
    id: 'run.general',
    section: 'run',
    group: 'GEN',
    title: 'General configuration',
    description:
      'Memory buffer, pre-trigger and run mode. Entered in microseconds and converted to ' +
      '25 ns samples. TRG1/Ext and TRG2 have independent buffers.',
    origin: 'Starter JULIETT — General Configuration',
    params: [
      ...section('Run', [
        uint('mode', 'Mode of operation', 4, 1),
        uint('run_code', 'RUN code', 4, 0),
        int('num_triggers', 'Number of triggers', 1_000_000, 0, {
          help:
            'Set to 0 for an unlimited number of triggers. Start Run, Stop Run and both ' +
            'resets all use this value.',
        }),
      ]),
      ...section('Buffer \u2014 TRG1 / Ext', [
        int('buffer_us', 'Circular buffer size', 3200, 1300, { min: 20, unit: '\u00b5s' }),
        int('pretrigger_us', 'Pre-trigger', 3200, 650, {
          min: 10,
          unit: '\u00b5s',
          help: 'Recommended value: half the buffer. Must not exceed it.',
        }),
      ]),
      ...section('Buffer \u2014 TRG2', [
        int('buffer2_us', 'Circular buffer size', 3200, 1300, {
          min: 20,
          unit: '\u00b5s',
          help: 'Must not exceed the TRG1/Ext buffer.',
        }),
        int('pretrigger2_us', 'Pre-trigger', 3200, 650, { min: 10, unit: '\u00b5s' }),
        bool('same_buffer', 'Use the same buffer for writing'),
      ]),
      ...section('Test modes', [
        bool('dual_mode', 'Dual mode RAW/ZS on'),
        bool('testmem_pmt', 'Ramp test \u2014 PMT memory'),
        bool('testmem_sipm', 'Ramp test \u2014 SiPM memory'),
      ]),
    ],
    plan: (p): PlannedWrite[] => {
      // AdjustBuffer clamped these the same way: a pre-trigger cannot exceed its
      // buffer, and the TRG2 buffer cannot exceed the TRG1 buffer.
      const buffer = p.int('buffer_us');
      const buffer2 = Math.min(p.int('buffer2_us'), buffer);
      const pretrigger = Math.min(p.int('pretrigger_us'), buffer);
      const pretrigger2 = Math.min(p.int('pretrigger2_us'), buffer2);

      return [
        {
          register: 'GenConfReg0J',
          note: 'Buffers, pre-triggers and run mode, broadcast to every card',
          params: {
            pretrigger: usToSamples(pretrigger),
            buff_size: usToSamples(buffer),
            pretrigger1: usToSamples(pretrigger2),
            buff_size1: usToSamples(buffer2),
            dm_on: p.bool('dual_mode'),
            testmem_on1: p.bool('testmem_pmt'),
            testmem_on2: p.bool('testmem_sipm'),
            bs2_on: p.bool('same_buffer'),
            mode: p.int('mode'),
            run_code: p.int('run_code'),
          },
        },
      ];
    },
  },
  {
    id: 'run.acquisition',
    section: 'run',
    group: 'CMD',
    title: 'Start / stop acquisition',
    description:
      'Broadcast acquisition command. The trigger count of 0 runs until stopped.',
    origin: 'Starter JULIETT — Start Run / Stop Run',
    params: [
      choice('on_off', 'Acquisition', [
        [1, 'Start'],
        [0, 'Stop'],
      ]),
      bool('reset_counters', 'Reset counters'),
      bool(
        'stop_external',
        'Auto-stop DUCK',
        true,
        'Also stops the external DAQ when acquisition stops, by running the configured ' +
          'stop hook. Has no effect if the deployment configures none.',
      ),
    ],
    plan: (p, ctx): PlannedWrite[] => [
      {
        register: 'AcqCmd',
        note: p.int('on_off') === 1 ? 'Start acquisition' : 'Stop acquisition',
        params: {
          // Owned by the general configuration, as the single main-window spinner was.
          trg_events: ctx.panel('run.general').int('num_triggers'),
          on_off: p.int('on_off'),
          rst: p.bool('reset_counters') ? 1 : 0,
          timestamp_ms: 0,
        },
      },
    ],
  },
  {
    id: 'trigger.config',
    section: 'trigger',
    group: 'TRG',
    title: 'Trigger configuration',
    description:
      'Trigger sources, rate, and the coincidence windows and channel multiplicities for ' +
      'both internal triggers. One panel because the hardware takes one register: the ' +
      'source switches were on the Swing main window and the windows on the Internal ' +
      'Trigger tab, but both fed the same TrgConfReg3 write.',
    origin: 'Starter JULIETT — Trigger Configuration + Internal Trigger tab',
    params: [
      ...section('Sources and rate', [
        bool('exttrg_on', 'External trigger on'),
        bool('autoexttrg_on', 'Auto external trigger on'),
        bool('ctrg_on', 'Calibration trigger on'),
        bool('mask_on', 'Trigger mask on'),
        int('frequency_hz', 'Trigger frequency', 100, 10, { min: 1, unit: 'Hz' }),
        uint('trg_code', 'Trigger code', 6, 0),
      ]),
      ...section('Trigger 1', [
        int('cw_a1', 'Coincidence window A', 63, 1, { min: 1, unit: '\u00d7 25 ns Tbin' }),
        int('nch_a1', 'Events for trigger A', 40, 1, { min: 1, unit: 'channels' }),
        int('cw_b1', 'Coincidence window B', 63, 1, { min: 1, unit: '\u00d7 25 ns Tbin' }),
        int('nch_b1', 'Events for trigger B', 40, 1, { min: 1, unit: 'channels' }),
        int('tdif1_ns', 'Max time A to B', 1_600_000, 0, { unit: 'ns' }),
        bool('trgB1_on', 'Trigger B1 on'),
      ]),
      ...section('Trigger 2', [
        bool('double_trigger', 'Double trigger on', false, 'Enables trigger 2 on both planes.'),
        int('cw_a2', 'Coincidence window A', 63, 1, { min: 1, unit: '\u00d7 25 ns Tbin' }),
        int('nch_a2', 'Events for trigger A', 40, 1, { min: 1, unit: 'channels' }),
        int('cw_b2', 'Coincidence window B', 63, 1, { min: 1, unit: '\u00d7 25 ns Tbin' }),
        int('nch_b2', 'Events for trigger B', 40, 1, { min: 1, unit: 'channels' }),
        int('tdif2_ns', 'Max time A to B', 1_600_000, 0, { unit: 'ns' }),
        bool('trgB2_on', 'Trigger B2 on'),
      ]),
      ...section('Lost-trigger masks', [
        bool('masktrg1lost_on', 'TRG1 lost mask on'),
        bool('masktrg2lost_on', 'TRG2 lost mask on'),
        bool('masktrg1_2lost_on', 'TRG1/2 lost mask on'),
      ]),
    ],
    plan: (p): PlannedWrite[] => [
      {
        register: 'TrgConfReg3',
        note: 'Dual-trigger coincidence configuration',
        params: {
          trg_code: p.int('trg_code'),
          trg_mask: hzToTrgMask(p.int('frequency_hz')),
          trg_tdif1: nsToTbins(p.int('tdif1_ns')),
          trg_tdif2: nsToTbins(p.int('tdif2_ns')),
          exttrg_on: p.bool('exttrg_on'),
          ctrg_on: p.bool('ctrg_on'),
          autoexttrg_on: p.bool('autoexttrg_on'),
          trgB1_on: p.bool('trgB1_on'),
          trgB2_on: p.bool('trgB2_on'),
          mask_on: p.bool('mask_on'),
          masktrg1lost_on: p.bool('masktrg1lost_on'),
          masktrg2lost_on: p.bool('masktrg2lost_on'),
          masktrg1_2lost_on: p.bool('masktrg1_2lost_on'),
          CWszA1: p.int('cw_a1'),
          nch_trgA1: p.int('nch_a1'),
          CWszB1: p.int('cw_b1'),
          nch_trgB1: p.int('nch_b1'),
          CWszA2: p.int('cw_a2'),
          nch_trgA2: p.int('nch_a2'),
          CWszB2: p.int('cw_b2'),
          nch_trgB2: p.int('nch_b2'),
          ctrg_intntrg: 0,
          ctrg_extntrg: 0,
        },
      },
      {
        register: 'PMTDaqConfReg3',
        note: 'Enable the configured triggers on the PMT plane',
        params: { trg1on: true, trg2on: p.bool('double_trigger') },
      },
      {
        register: 'BFDaqConfReg3',
        note: 'Enable the configured triggers on the energy plane',
        params: { trg1on: true, trg2on: p.bool('double_trigger') },
      },
    ],
  },
  {
    id: 'trigger.muonveto',
    section: 'trigger',
    group: 'TRG',
    title: 'Muon veto / synchronisation pulse',
    origin: 'Muon Veto Conf tab',
    params: [
      bool('on', 'On'),
      bool('pol', 'Invert pulse'),
      int('period_ms', 'Synchronisation signal period', 32767, 0, { unit: 'ms' }),
      int('pulse_tbins', 'Pulse duration in ON state', 32767, 0, { unit: '× 25 ns' }),
    ],
    plan: (p): PlannedWrite[] => [
      {
        register: 'TrgConfReg5',
        note: 'Muon veto synchronisation pulse generator',
        params: {
          on: p.bool('on'),
          pol: p.bool('pol'),
          period: p.int('period_ms'),
          pulseduration: p.int('pulse_tbins'),
        },
      },
    ],
  },
  {
    id: 'trigger.mhit',
    section: 'trigger',
    group: 'TRG',
    title: 'Multi-hit and processing time',
    description:
      'Allowed time threshold control and the real multi-hit memory size. The processing ' +
      'reduction is sent to both register fields, as the original did.',
    origin: 'MHit Conf tab',
    params: [
      uint('times_MH', 'Multi-hit times', 4, 0),
      int('time_reduction_ns', 'Allowed time threshold reduction', 100_000, 0, { unit: 'ns' }),
      int('mhit_us', 'Real memory hit size', 3200, 0, { unit: 'µs' }),
    ],
    plan: (p): PlannedWrite[] => [
      {
        register: 'TrgConfReg4',
        note: 'Multi-hit sizing and processing reduction',
        params: {
          times_MH: p.int('times_MH'),
          // The original passed the same processing delay to both fields.
          prc_red1: nsToTbins(p.int('time_reduction_ns')),
          prc_red: nsToTbins(p.int('time_reduction_ns')),
          mhit_sz: usToSamples(p.int('mhit_us')),
        },
      },
    ],
  },
];
