import type { Group, ParamAccess, ParamSpec, Params } from '../types.js';

/**
 * An operator task: a coherent set of parameters that expands into a sequence of
 * register writes.
 *
 * This is the layer the Swing UI had and the first version of this rewrite did
 * not. A panel like "BLR Conf" or "Internal Trigger" gathers parameters in real
 * units and its "Config Registers" button issues several writes — the original
 * did that inside `AdjustTRGAChannels`, `AdjustBuffer`, `BasicConf` and friends,
 * interleaved with Swing calls. Here the expansion is a pure function, so it can
 * be previewed before anything is transmitted and tested without a GUI.
 */

export interface PlannedWrite {
  /** Register id in the catalogue. */
  register: string;
  params: Params;
  /** Human-readable reason this write is part of the plan. */
  note?: string;
  /** Overrides the register's own target, e.g. to address one specific card. */
  host?: string;
}

export interface ConfigAction {
  id: string;
  /** Panel this action belongs to in the console. */
  section: ActionSection;
  title: string;
  /** Mirrors the wording of the original panel where there was one. */
  description?: string;
  /** The register group the writes mostly land in, for cross-referencing. */
  group: Group;
  params: ParamSpec[];
  /** Expand the operator parameters into the register writes to perform. */
  plan: (p: ParamAccess) => PlannedWrite[];
  /** Named after the corresponding tab in the Swing application. */
  origin?: string;
}

export type ActionSection =
  | 'run'
  | 'trigger'
  | 'pmt'
  | 'bf'
  | 'sipm'
  | 'fec'
  | 'test';

export const SECTION_LABELS: Record<ActionSection, string> = {
  run: 'Run',
  trigger: 'Trigger',
  pmt: 'PMT plane',
  bf: 'Energy plane (BF)',
  sipm: 'SiPM plane',
  fec: 'Cards & links',
  test: 'Test & calibration',
};
