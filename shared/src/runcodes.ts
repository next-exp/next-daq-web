/**
 * Physics run codes.
 *
 * Transcribed from the drop-down the Swing main window offered, which carried the
 * code and a description of what the detector was set up for. The code is written
 * into the run header, so an operator picking "Kr-83 + Th-228" rather than typing
 * 21 is the difference between a correctly labelled dataset and one that is not.
 */

export interface RunCode {
  code: number;
  /** What the run is. */
  label: string;
  /** Source position or other qualifier, where the original gave one. */
  detail?: string;
}

export const RUN_CODES: RunCode[] = [
  { code: 0, label: 'No physics' },
  { code: 1, label: 'Double beta', detail: 'no source, internal trigger' },
  { code: 2, label: 'Alphas' },
  { code: 3, label: 'Auto-trigger' },

  { code: 10, label: 'PMT calibration', detail: 'tracking plane LEDs active' },
  { code: 11, label: 'SiPM calibration', detail: 'dark current' },
  { code: 12, label: 'SiPM calibration', detail: 'energy plane LEDs active' },

  { code: 20, label: 'Kr-83' },
  { code: 21, label: 'Kr-83 + Th-228', detail: 'source at lateral port' },
  { code: 22, label: 'Kr-83 + LowBg', detail: 'source at lateral port' },
  { code: 23, label: 'Kr-83 + double beta', detail: 'no source' },

  { code: 30, label: 'Na-22', detail: 'source in EP port' },
  { code: 31, label: 'Na-22', detail: 'source at lateral port' },
  { code: 32, label: 'Na-22', detail: 'source at top port' },
  { code: 33, label: 'Na-22', detail: 'source at lateral port with NaI' },

  { code: 40, label: 'Th-228', detail: 'source in EP port' },
  { code: 41, label: 'Th-228', detail: 'source at lateral port' },
  { code: 42, label: 'Th-228', detail: 'source at top port' },

  { code: 50, label: 'Co-56', detail: 'source at lateral port' },
  { code: 51, label: 'Co-56', detail: 'source in EP port' },

  { code: 60, label: 'Cs-137', detail: 'source in EP port' },
  { code: 61, label: 'Cs-137', detail: 'source at lateral port' },
  { code: 62, label: 'Cs-137', detail: 'source at top port' },
];

/** "21 — Kr-83 + Th-228 (source at lateral port)" */
export const runCodeLabel = (c: RunCode): string =>
  `${c.code} — ${c.label}${c.detail ? ` (${c.detail})` : ''}`;

/** Options for a drop-down, in the order the original listed them. */
export const RUN_CODE_OPTIONS: [number, string][] = RUN_CODES.map((c) => [
  c.code,
  runCodeLabel(c),
]);

/**
 * Width of the field on the wire.
 *
 * `run_code` occupies bits 4-11 of the flags word — mode and the data-mode bit sit
 * below it, and the buffer/pre-trigger high bits above — so it is eight bits, not
 * the four an earlier version declared. The highest code in use is 62, which a
 * 4-bit field would have rejected outright.
 */
export const RUN_CODE_BITS = 8;
