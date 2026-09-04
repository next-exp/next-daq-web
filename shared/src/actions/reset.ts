import { bool, choice, int, mask } from '../registers/spec.js';
import type { ConfigAction, PlannedWrite } from './types.js';

/**
 * Reset and recovery panels.
 *
 * Three distinct operations in the original, which the main window exposed as
 * separate buttons:
 *
 *  - **Soft reset** (`jButton4`) stopped acquisition with the reset bit set and
 *    cleared the "configured" flags, so the system had to be set up again before
 *    a run could start. It sent one command: `AcqCmd` with `on_off=0, rst=1`.
 *  - **Recover from flash** (`NewJFrameExternal*Reset`) broadcast or unicast
 *    `ProgCmd` with `flash_sel` and `prog_on` set, which makes the cards reload
 *    their FPGA image from flash. Separate windows targeted all cards, the BF and
 *    SiPM cards individually, and each of the 57 front-end boards.
 *  - **Hard reset** (`jButton3`) chained them: soft reset, broadcast reload, a
 *    60-second wait for the cards to come back, then a second soft reset.
 *
 * The wait was a blocking `manymasec(60000)` on the event thread, which froze the
 * interface for a minute with no indication of progress. Here it is a step in the
 * plan, executed in the background with progress reported.
 */

/** How long the cards need to reprogram themselves from flash and re-appear. */
export const FLASH_RELOAD_WAIT_MS = 60_000;

/** `ProgCmd` parameters that trigger a reload from flash. */
const RELOAD_FROM_FLASH = { flash_sel: true, prog_wron: false, prog_on: true };

const softResetWrite = (trgEvents: number, note: string): PlannedWrite => ({
  register: 'AcqCmd',
  note,
  // Stop acquisition with the reset bit set — the original's AcqCmd(n, 0, 1).
  params: { trg_events: trgEvents, on_off: 0, rst: 1, timestamp_ms: 0 },
});

export const RESET_ACTIONS: ConfigAction[] = [
  {
    id: 'run.softReset',
    section: 'run',
    group: 'CMD',
    title: 'Soft reset',
    description:
      'Stops acquisition with the reset flag set and clears the configured state, so ' +
      'the planes must be set up again before the next run. Does not reprogram anything.',
    origin: 'Starter JULIETT — RST SOFT',
    params: [
      int('trg_events', 'Number of triggers', 65535, 0, {
        help: 'Sent with the stop command; 0 for an unlimited run.',
      }),
    ],
    plan: (p): PlannedWrite[] => [
      softResetWrite(p.int('trg_events'), 'Stop acquisition with the reset bit set'),
    ],
  },
  {
    id: 'fec.recover',
    section: 'fec',
    group: 'CMD',
    title: 'Recover — reload cards from flash',
    description:
      'Makes the selected cards reload their FPGA image from flash. They take about a ' +
      'minute to come back, during which they will not answer.',
    origin: 'Ext PMT / Ext SiPM / Ext FEBs RCV windows',
    params: [
      choice('scope', 'Reload', [
        [0, 'All cards (broadcast)'],
        [1, 'Energy plane (BF) cards'],
        [2, 'PMT cards'],
        [3, 'SiPM cards'],
        [4, 'Selected front-end boards'],
      ]),
      mask('boards', 'Front-end boards', 56, 'high', 'FEB'),
    ],
    plan: (p): PlannedWrite[] => {
      const scope = p.int('scope');

      if (scope === 4) {
        const boards = p.mask('boards');
        const writes: PlannedWrite[] = [];
        for (let board = 0; board < 56; board++) {
          if (!boards[board]) continue;
          writes.push({
            register: 'ProgCmd',
            note: `Reload front-end board ${board} from flash`,
            params: RELOAD_FROM_FLASH,
            target: 'feBoard',
            board,
          });
        }
        return writes;
      }

      const plane = ({ 1: 'bf', 2: 'pmt', 3: 'sipm' } as const)[scope as 1 | 2 | 3];
      return [
        {
          register: 'ProgCmd',
          note: plane
            ? `Reload the ${plane.toUpperCase()} cards from flash`
            : 'Reload every card from flash',
          params: RELOAD_FROM_FLASH,
          target: plane ?? 'broadcast',
        },
      ];
    },
  },
  {
    id: 'run.hardReset',
    section: 'run',
    group: 'CMD',
    title: 'Hard reset',
    description:
      'Soft reset, then every card reloads its FPGA image from flash, then a second ' +
      'soft reset once they are back. Takes about a minute, during which the cards do ' +
      'not respond.',
    origin: 'Starter JULIETT — RST HARD',
    params: [
      int('trg_events', 'Number of triggers', 65535, 0),
      int('reload_wait_s', 'Wait for cards to return', 300, FLASH_RELOAD_WAIT_MS / 1000, {
        min: 1,
        unit: 's',
        help: 'The original waited a fixed 60 seconds.',
      }),
    ],
    plan: (p): PlannedWrite[] => {
      const trgEvents = p.int('trg_events');
      return [
        softResetWrite(trgEvents, 'Soft reset before reloading'),
        {
          register: 'ProgCmd',
          note: 'Reload every card from flash',
          params: RELOAD_FROM_FLASH,
          target: 'broadcast',
          waitAfterMs: p.int('reload_wait_s') * 1000,
        },
        softResetWrite(trgEvents, 'Soft reset once the cards are back'),
      ];
    },
  },
];
