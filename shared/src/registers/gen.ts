import { channelMask, flag } from '../words.js';
import { CMD_CONFIG } from '../encode.js';
import type { RegisterDef } from '../types.js';
import { bool, choice, int, mask, uint } from './spec.js';
import { RUN_CODE_BITS } from '../runcodes.js';

/** General (GEN) registers — memory buffer and link configuration. */
export const GEN_REGISTERS: RegisterDef[] = [
  {
    id: 'GenConfReg0',
    group: 'GEN',
    title: 'Memory buffer configuration',
    regAddr: 0x0000,
    cmdCode: CMD_CONFIG,
    target: 'broadcast',
    params: [
      int('pretrigger', 'Pre-trigger', 0x1ffff, 26000, { unit: 'samples' }),
      int('buff_size', 'Buffer size', 0x1ffff, 52000, { unit: 'samples' }),
      int('mhit_size', 'Multi-hit size', 0xffff, 0, { unit: 'samples' }),
      bool('dm_on', 'Data mode on'),
      bool('testmem_on1', 'Test memory (PMT)'),
      bool('testmem_on2', 'Test memory (SiPM)'),
      uint('mode', 'Mode of operation', 4, 1),
      uint('run_code', 'Run code', RUN_CODE_BITS),
      uint('times_MH', 'Multi-hit times', 2),
    ],
    payload: (p, w) => {
      const buff = p.int('buff_size');
      const pre = p.int('pretrigger');
      // Bit 16 of the 17-bit buffer/pre-trigger values rides in the flags word.
      w.push(
        ((buff >> 16) << 15) |
          ((pre >> 16) << 14) |
          flag(p.bool('testmem_on1'), 0x0800) |
          flag(p.bool('testmem_on2'), 0x0400) |
          (p.int('times_MH') << 12) |
          (p.int('run_code') << 4) |
          flag(p.bool('dm_on'), 0x0008) |
          p.int('mode'),
      );
      w.push(pre, buff, p.int('mhit_size'));
    },
    notes:
      'Single-buffer variant. The original defines it but never calls it \u2014 the live ' +
      'path is GenConfReg0J. Kept for completeness and for older firmware.',
  },
  {
    id: 'GenConfReg0J',
    group: 'GEN',
    title: 'Memory buffer configuration (dual buffer)',
    regAddr: 0x0000,
    cmdCode: CMD_CONFIG,
    target: 'broadcast',
    params: [
      int('pretrigger', 'Pre-trigger, TRG1/Ext', 0x1ffff, 26000, { unit: 'samples' }),
      int('buff_size', 'Buffer size, TRG1/Ext', 0x1ffff, 52000, { unit: 'samples' }),
      int('pretrigger1', 'Pre-trigger, TRG2', 0x1ffff, 26000, { unit: 'samples' }),
      int('buff_size1', 'Buffer size, TRG2', 0x1ffff, 52000, { unit: 'samples' }),
      bool('dm_on', 'Data mode on'),
      bool('testmem_on1', 'Test memory (PMT)'),
      bool('testmem_on2', 'Test memory (SiPM)'),
      bool('bs2_on', 'Same buffer for writing'),
      uint('mode', 'Mode of operation', 4, 1),
      uint('run_code', 'Run code', RUN_CODE_BITS),
    ],
    payload: (p, w) => {
      const buff = p.int('buff_size');
      const pre = p.int('pretrigger');
      const buff1 = p.int('buff_size1');
      const pre1 = p.int('pretrigger1');
      // Bit 16 of each 17-bit value rides in the flags word.
      w.push(
        ((buff >> 16) << 15) |
          ((pre >> 16) << 14) |
          ((buff1 >> 16) << 13) |
          ((pre1 >> 16) << 12) |
          (p.int('run_code') << 4) |
          flag(p.bool('dm_on'), 0x0008) |
          p.int('mode'),
      );
      // The TRG2 pair is transmitted before the TRG1 pair.
      w.push(pre1, buff1, pre, buff);
      w.push(
        flag(p.bool('bs2_on'), 0x8000) |
          flag(p.bool('testmem_on1'), 0x0002) |
          flag(p.bool('testmem_on2'), 0x0001),
      );
    },
    notes:
      'This is the variant the original actually sent; GenConfReg0 has no call site. It ' +
      'carries separate buffer and pre-trigger values for TRG1/Ext and TRG2, and its ' +
      'test-memory bits are 0x0002/0x0001 rather than GenConfReg0\u2019s 0x0800/0x0400.',
  },
  {
    id: 'GenConfReg2',
    group: 'GEN',
    title: 'Link / serial transceiver configuration',
    regAddr: 0x0002,
    cmdCode: CMD_CONFIG,
    target: 'broadcast',
    params: [
      bool('wait_ack', 'Wait for ACK', true),
      int('frame_length', 'Frame length', 0x7fff, 0, { unit: 'bytes' }),
      uint('frame_dly', 'Frame delay', 16),
      uint('maxtot_frames', 'Max total frames', 16),
      bool('txh_pol', 'TX high polarity'),
      bool('rxh_pol', 'RX high polarity'),
      bool('txl_pol', 'TX low polarity'),
      bool('rxl_pol', 'RX low polarity'),
      uint('tx_post_emph', 'TX post-emphasis', 6),
      uint('tx_pre_emph', 'TX pre-emphasis', 4),
      uint('tx_mVppd', 'TX amplitude', 3),
      uint('rx_eq', 'RX equalisation', 3),
    ],
    payload: (p, w) => {
      w.push(
        flag(p.bool('txl_pol'), 0x0008) |
          flag(p.bool('rxl_pol'), 0x0004) |
          flag(p.bool('txh_pol'), 0x0002) |
          flag(p.bool('rxh_pol'), 0x0001),
      );
      // Words 4 and 5 carry the same drive settings for the two link halves.
      const drive =
        (p.int('rx_eq') << 13) |
        (p.int('tx_mVppd') << 10) |
        (p.int('tx_pre_emph') << 6) |
        p.int('tx_post_emph');
      w.push(drive, drive);
      // Note the inverted sense: the bit means "ACK off".
      w.push((p.int('frame_length') << 1) | flag(!p.bool('wait_ack'), 0x0001));
      w.push(p.int('frame_dly'), p.int('maxtot_frames'));
    },
    notes: 'Bit 0 of word 6 is ACK-OFF: it is set when "Wait for ACK" is disabled.',
  },
];

/** Trigger (TRG) registers. */
export const TRG_REGISTERS: RegisterDef[] = [
  {
    id: 'TrgConfReg1',
    group: 'TRG',
    title: 'FEC connected mask',
    regAddr: 0x0001,
    cmdCode: CMD_CONFIG,
    target: 'trg',
    params: [mask('cards', 'FECs connected', 13, 'low', 'FEC')],
    payload: (p, w) => w.push(...channelMask(p.mask('cards'), 13, 'low')),
    notes:
      'Active-low mask: a connected FEC clears its bit. SiPMDaqConfReg1 matches this, ' +
      'but PMTDaqConfReg1 and BFDaqConfReg1 use the opposite polarity.',
  },
  {
    id: 'TrgConfReg3',
    group: 'TRG',
    title: 'Trigger configuration (dual trigger)',
    regAddr: 0x0003,
    cmdCode: CMD_CONFIG,
    target: 'trg',
    params: [
      uint('trg_code', 'Trigger code', 6),
      int('trg_mask', 'Trigger mask', 0x3ffffff, 4000000, { unit: 'ticks' }),
      uint('trg_tdif1', 'Trigger time difference 1', 16),
      uint('trg_tdif2', 'Trigger time difference 2', 16),
      bool('exttrg_on', 'External trigger'),
      bool('ctrg_on', 'Calibration trigger'),
      bool('autoexttrg_on', 'Auto external trigger'),
      bool('trgB1_on', 'Trigger B1'),
      bool('trgB2_on', 'Trigger B2'),
      bool('mask_on', 'Trigger mask enabled'),
      bool('masktrg1lost_on', 'Mask TRG1 lost'),
      bool('masktrg2lost_on', 'Mask TRG2 lost'),
      bool('masktrg1_2lost_on', 'Mask TRG1+2 lost'),
      uint('CWszA1', 'Coincidence window size A1', 6),
      uint('nch_trgA1', 'Channels in trigger A1', 6),
      uint('CWszB1', 'Coincidence window size B1', 6),
      uint('nch_trgB1', 'Channels in trigger B1', 6),
      uint('CWszA2', 'Coincidence window size A2', 6),
      uint('nch_trgA2', 'Channels in trigger A2', 6),
      uint('CWszB2', 'Coincidence window size B2', 6),
      uint('nch_trgB2', 'Channels in trigger B2', 6),
      int('ctrg_intntrg', 'Calibration internal triggers', 0xffff),
      int('ctrg_extntrg', 'Calibration external triggers', 0xffff),
    ],
    payload: (p, w) => {
      const trgMask = p.int('trg_mask');
      w.push((p.int('trg_code') << 10) | (1023 & (trgMask >> 16)));
      w.push(0xffff & trgMask, p.int('trg_tdif1'), p.int('trg_tdif2'));
      w.push(
        flag(p.bool('exttrg_on'), 0x8000) |
          flag(p.bool('ctrg_on'), 0x4000) |
          flag(p.bool('autoexttrg_on'), 0x2000) |
          (p.int('nch_trgA1') << 6) |
          p.int('CWszA1'),
      );
      w.push(
        flag(p.bool('trgB1_on'), 0x8000) |
          flag(p.bool('trgB2_on'), 0x4000) |
          flag(p.bool('mask_on'), 0x2000) |
          (p.int('nch_trgB1') << 6) |
          p.int('CWszB1'),
      );
      w.push(
        flag(p.bool('masktrg2lost_on'), 0x8000) |
          flag(p.bool('masktrg1lost_on'), 0x4000) |
          flag(p.bool('masktrg1_2lost_on'), 0x2000) |
          (p.int('nch_trgA2') << 6) |
          p.int('CWszA2'),
      );
      w.push((p.int('nch_trgB2') << 6) | p.int('CWszB2'));
      // Calibration trigger counts are sent in units of 16.
      w.push(
        (Math.trunc(p.int('ctrg_intntrg') / 16) << 4) | Math.trunc(p.int('ctrg_extntrg') / 16),
      );
    },
    notes: 'Calibration trigger counts are divided by 16 before transmission.',
  },
  {
    id: 'TrgConfReg3A',
    group: 'TRG',
    title: 'Trigger configuration (single trigger)',
    regAddr: 0x0003,
    cmdCode: CMD_CONFIG,
    target: 'trg',
    params: [
      bool('exttrg_on', 'External trigger'),
      bool('ctrg_on', 'Calibration trigger'),
      bool('autoexttrg_on', 'Auto external trigger'),
      bool('trg2_on', 'Trigger 2'),
      bool('mask_on', 'Trigger mask enabled'),
      int('trg_mask', 'Trigger mask', 0x3ffffff, 4000000, { unit: 'ticks' }),
      uint('trg_tdif', 'Trigger time difference', 16),
      uint('CWsz1', 'Coincidence window size 1', 6),
      uint('nch_trg1', 'Channels in trigger 1', 6),
      uint('CWsz2', 'Coincidence window size 2', 6),
      uint('nch_trg2', 'Channels in trigger 2', 6),
      int('ctrg_intntrg', 'Calibration internal triggers', 0xffff),
      int('ctrg_extntrg', 'Calibration external triggers', 0xffff),
    ],
    payload: (p, w) => {
      const trgMask = p.int('trg_mask');
      w.push(
        flag(p.bool('exttrg_on'), 0x8000) |
          flag(p.bool('ctrg_on'), 0x4000) |
          flag(p.bool('autoexttrg_on'), 0x2000) |
          flag(p.bool('trg2_on'), 0x1000) |
          flag(p.bool('mask_on'), 0x0800) |
          (1023 & (trgMask >> 16)),
      );
      w.push(0xffff & trgMask, p.int('trg_tdif'));
      w.push((p.int('nch_trg1') << 6) | p.int('CWsz1'));
      w.push((p.int('nch_trg2') << 6) | p.int('CWsz2'));
      w.push(
        (Math.trunc(p.int('ctrg_intntrg') / 16) << 4) | Math.trunc(p.int('ctrg_extntrg') / 16),
      );
    },
  },
  {
    id: 'TrgConfReg4',
    group: 'TRG',
    title: 'Multi-hit and processing reduction',
    regAddr: 0x0004,
    cmdCode: CMD_CONFIG,
    target: 'trg',
    params: [
      uint('times_MH', 'Multi-hit times', 4),
      uint('prc_red1', 'Processing reduction 1', 16),
      uint('prc_red', 'Processing reduction', 16),
      uint('mhit_sz', 'Multi-hit size', 16),
    ],
    payload: (p, w) => {
      w.push(p.int('times_MH'), p.int('prc_red1'), p.int('prc_red'), p.int('mhit_sz'));
    },
  },
  {
    id: 'TrgConfReg5',
    group: 'TRG',
    title: 'Calibration pulse generator',
    regAddr: 0x0005,
    cmdCode: CMD_CONFIG,
    target: 'trg',
    params: [
      bool('on', 'Pulse generator on'),
      bool('pol', 'Pulse polarity'),
      int('period', 'Period', 32767, 0, { unit: 'ticks' }),
      int('pulseduration', 'Pulse duration', 32767, 0, { unit: 'ticks' }),
    ],
    payload: (p, w) => {
      w.push(flag(p.bool('on'), 0x8000) | (32767 & p.int('period')));
      w.push(flag(p.bool('pol'), 0x8000) | (32767 & p.int('pulseduration')));
    },
  },
  {
    id: 'TrgConfReg12',
    group: 'TRG',
    title: 'Reset / realign control',
    regAddr: 0x000c,
    cmdCode: CMD_CONFIG,
    target: 'trg',
    params: [
      bool('rst_dtc', 'Reset DTC'),
      bool('rst_stack', 'Reset stack'),
      bool('resume', 'Resume'),
      bool('realignall', 'Realign all'),
      bool('realignlink', 'Realign link (per card)'),
      bool('rst_module', 'Reset module (per card)'),
      mask('cards', 'Cards', 13, 'high', 'FEC'),
    ],
    payload: (p, w) => {
      const cards = channelMask(p.mask('cards'), 13, 'high')[0];
      // The per-card bits only apply when the corresponding global action is armed.
      w.push(
        flag(p.bool('rst_dtc'), 0x8000) |
          flag(p.bool('resume'), 0x4000) |
          flag(p.bool('realignall'), 0x2000) |
          (p.bool('realignlink') ? cards : 0),
      );
      w.push(flag(p.bool('rst_stack'), 0x8000) | (p.bool('rst_module') ? cards : 0));
    },
    notes:
      'Per-card link-realign and module-reset bits are gated by the "realignlink" and ' +
      '"rst_module" switches respectively; with those off the card mask is not sent.',
  },
];
