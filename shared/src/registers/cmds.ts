import { flag } from '../words.js';
import { CMD_CONFIG } from '../encode.js';
import type { RegisterDef } from '../types.js';
import { bool, choice, int, uint } from './spec.js';

/**
 * Standalone commands — these are not register writes, so they carry their own
 * command code and (except for ProgCmd) no register-address word.
 */

export const CMD_ACQ = 0x00;
export const CMD_STATUS = 0x04;
export const CMD_PRBS = 0x06;

/** Status command word 2 carries a fixed read/write selector bit. */
export const STATUS_RDWR = 0x0800;

export const COMMANDS: RegisterDef[] = [
  {
    id: 'AcqCmd',
    group: 'CMD',
    title: 'Acquisition start / stop',
    cmdCode: CMD_ACQ,
    target: 'broadcast',
    params: [
      int('trg_events', 'Trigger events', 0xffff, 0),
      choice('on_off', 'Acquisition', [
        [0, 'Stop'],
        [1, 'Start'],
      ]),
      choice('rst', 'Reset counters', [
        [0, 'No'],
        [1, 'Yes'],
      ]),
      int('timestamp_ms', 'Timestamp (ms since epoch, 0 = now)', Number.MAX_SAFE_INTEGER, 0),
    ],
    payload: (p, w) => {
      const trgEvents = p.int('trg_events');
      // The 45-bit millisecond timestamp is split: low 10 bits share word 3 with the
      // trigger count, the remainder goes out as a 32-bit value in words 4-5.
      const ms = p.int('timestamp_ms') || Date.now();
      w.push(((trgEvents >> 6) << 2) | (p.int('rst') << 1) | p.int('on_off'));
      w.push((trgEvents << 10) | (ms % 1024));
      const upper = Math.floor(ms / 1024) >>> 0;
      w.push(Math.floor(upper / 0x10000), upper);
    },
    notes:
      'Broadcast to every card. The timestamp defaults to the send time; JavaScript ' +
      'bitwise operators are 32-bit, so the split uses arithmetic rather than >> here.',
  },
  {
    id: 'PRBSCmd',
    group: 'CMD',
    title: 'PRBS link test',
    cmdCode: CMD_PRBS,
    target: 'broadcast',
    params: [bool('on', 'PRBS enabled')],
    payload: (p, w) => w.push(flag(p.bool('on'), 0x0001)),
  },
  {
    id: 'StatusCmdRd',
    group: 'CMD',
    title: 'Status register read',
    cmdCode: CMD_STATUS,
    target: 'explicit',
    params: [uint('st_type', 'Status type', 4), uint('st_add', 'Status address', 11)],
    payload: (p, w) => w.push((p.int('st_type') << 12) | STATUS_RDWR | p.int('st_add')),
  },
  {
    id: 'ProgCmd',
    group: 'CMD',
    title: 'Flash programming control',
    regAddr: 0x0100,
    cmdCode: CMD_CONFIG,
    target: 'explicit',
    params: [
      bool('prog_on', 'Programming enabled'),
      bool('flash_sel', 'Flash select'),
      bool('prog_wron', 'Write enabled'),
    ],
    payload: (p, w) =>
      w.push(
        flag(p.bool('prog_on'), 0x0001) |
          flag(p.bool('flash_sel'), 0x0002) |
          flag(p.bool('prog_wron'), 0x0004),
      ),
  },
];
