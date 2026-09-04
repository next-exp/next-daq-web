import { hzToTrgMask, nsToTbins, usToSamples } from '../units.js';
import { bool, choice, int, mask, uint } from '../registers/spec.js';
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
      'Memory buffer, pre-trigger and run mode. Buffer and pre-trigger are entered in ' +
      'microseconds and converted to 25 ns samples for the register.',
    origin: 'Starter JULIETT — General Configuration',
    params: [
      uint('mode', 'Mode of operation', 4, 1),
      uint('run_code', 'RUN code', 4, 0),
      int('num_triggers', 'Number of triggers', 1_000_000, 0, {
        help:
          'Set to 0 for an unlimited number of triggers. Start Run, Stop Run and both ' +
          'resets all use this value.',
      }),
      int('buffer_us', 'Circular buffer size, TRG1/Ext', 3200, 1300, {
        min: 20,
        unit: 'µs',
      }),
      int('pretrigger_us', 'Pre-trigger', 3200, 650, {
        min: 10,
        unit: 'µs',
        help: 'Recommended value: half the circular buffer size.',
      }),
      int('buffer2_us', 'Circular buffer size, TRG2', 3200, 1300, { min: 20, unit: 'µs' }),
      int('mhit_us', 'Multi-hit size', 3200, 0, { unit: 'µs' }),
      bool('dual_mode', 'Dual mode RAW/ZS on'),
      bool('testmem_pmt', 'Ramp test — PMT memory'),
      bool('testmem_sipm', 'Ramp test — SiPM memory'),
    ],
    plan: (p): PlannedWrite[] => {
      const buffer = usToSamples(p.int('buffer_us'));
      const pretrigger = usToSamples(p.int('pretrigger_us'));
      return [
        {
          register: 'GenConfReg0',
          note: 'Buffer, pre-trigger and run mode, broadcast to every card',
          params: {
            pretrigger,
            buff_size: buffer,
            mhit_size: usToSamples(p.int('mhit_us')),
            dm_on: p.bool('dual_mode'),
            testmem_on1: p.bool('testmem_pmt'),
            testmem_on2: p.bool('testmem_sipm'),
            mode: p.int('mode'),
            run_code: p.int('run_code'),
            times_MH: 0,
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
    id: 'trigger.external',
    section: 'trigger',
    group: 'TRG',
    title: 'External trigger and rate',
    description:
      'External and calibration trigger sources, and the trigger mask period derived ' +
      'from the requested rate.',
    origin: 'Starter JULIETT — Trigger Configuration',
    params: [
      bool('exttrg_on', 'External trigger on'),
      bool('autoexttrg_on', 'Auto external trigger on'),
      bool('ctrg_on', 'Calibration trigger on'),
      bool('mask_on', 'Trigger mask on'),
      int('frequency_hz', 'Trigger frequency', 100, 10, { min: 1, unit: 'Hz' }),
      int('ctrg_intntrg', 'Calibration internal triggers', 65535, 0),
      int('ctrg_extntrg', 'Calibration external triggers', 65535, 0),
      uint('trg_code', 'Trigger code', 6, 0),
    ],
    plan: (p): PlannedWrite[] => [
      {
        register: 'TrgConfReg3A',
        note: `Trigger mask period for ${p.int('frequency_hz')} Hz`,
        params: {
          exttrg_on: p.bool('exttrg_on'),
          autoexttrg_on: p.bool('autoexttrg_on'),
          ctrg_on: p.bool('ctrg_on'),
          mask_on: p.bool('mask_on'),
          trg2_on: false,
          trg_mask: hzToTrgMask(p.int('frequency_hz')),
          trg_tdif: 0,
          CWsz1: 0,
          nch_trg1: 0,
          CWsz2: 0,
          nch_trg2: 0,
          ctrg_intntrg: p.int('ctrg_intntrg'),
          ctrg_extntrg: p.int('ctrg_extntrg'),
        },
      },
    ],
  },
  {
    id: 'trigger.internal',
    section: 'trigger',
    group: 'TRG',
    title: 'Internal trigger 1 and 2',
    description:
      'Coincidence windows and channel multiplicities for the two internal triggers, ' +
      'with the A→B time difference in nanoseconds.',
    origin: 'Internal Trigger tab',
    params: [
      bool('double_trigger', 'Double trigger on'),
      uint('trg_code', 'Trigger code', 6, 0),
      int('frequency_hz', 'Trigger frequency', 100, 10, { min: 1, unit: 'Hz' }),
      bool('mask_on', 'Trigger mask on'),
      bool('exttrg_on', 'External trigger on'),
      bool('autoexttrg_on', 'Auto external trigger on'),
      bool('ctrg_on', 'Calibration trigger on'),
      // Trigger 1
      int('cw_a1', 'TRG 1 — coincidence window A', 63, 1, { min: 1, unit: '× 25 ns Tbin' }),
      int('nch_a1', 'TRG 1 — events for trigger A', 40, 1, { min: 1, unit: 'channels' }),
      int('cw_b1', 'TRG 1 — coincidence window B', 63, 1, { min: 1, unit: '× 25 ns Tbin' }),
      int('nch_b1', 'TRG 1 — events for trigger B', 40, 1, { min: 1, unit: 'channels' }),
      int('tdif1_ns', 'TRG 1 — max time A to B', 1_600_000, 0, { unit: 'ns' }),
      // Trigger 2
      int('cw_a2', 'TRG 2 — coincidence window A', 63, 1, { min: 1, unit: '× 25 ns Tbin' }),
      int('nch_a2', 'TRG 2 — events for trigger A', 40, 1, { min: 1, unit: 'channels' }),
      int('cw_b2', 'TRG 2 — coincidence window B', 63, 1, { min: 1, unit: '× 25 ns Tbin' }),
      int('nch_b2', 'TRG 2 — events for trigger B', 40, 1, { min: 1, unit: 'channels' }),
      int('tdif2_ns', 'TRG 2 — max time A to B', 1_600_000, 0, { unit: 'ns' }),
      bool('trgB1_on', 'Trigger B1 on'),
      bool('trgB2_on', 'Trigger B2 on'),
      bool('masktrg1lost_on', 'TRG1 lost mask on'),
      bool('masktrg2lost_on', 'TRG2 lost mask on'),
      bool('masktrg1_2lost_on', 'TRG1/2 lost mask on'),
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
    description: 'Allowed time threshold control and the real multi-hit memory size.',
    origin: 'MHit Conf tab',
    params: [
      uint('times_MH', 'Multi-hit times', 4, 0),
      int('time_reduction_ns', 'Allowed time threshold reduction', 100_000, 0, { unit: 'ns' }),
      int('prc_red1', 'Processing reduction 1', 65535, 0),
      int('mhit_us', 'Real memory hit size', 3200, 0, { unit: 'µs' }),
    ],
    plan: (p): PlannedWrite[] => [
      {
        register: 'TrgConfReg4',
        note: 'Multi-hit sizing and processing reduction',
        params: {
          times_MH: p.int('times_MH'),
          prc_red1: p.int('prc_red1'),
          prc_red: nsToTbins(p.int('time_reduction_ns')),
          mhit_sz: usToSamples(p.int('mhit_us')),
        },
      },
    ],
  },
];
