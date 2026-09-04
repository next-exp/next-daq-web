import type { Group, ParamAccess, ParamSpec, Params, Target } from '../types.js';

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
  /**
   * Overrides the register's declared target class. `ProgCmd` is the case that
   * needs this: the original sent it broadcast for a full reload, to individual
   * card addresses per plane, and to front-end boards.
   */
  target?: Target;
  /** For a `feBoard` target, the board this write addresses. */
  board?: number;
  /**
   * Pause after this write before the next one. The hard reset waits for the
   * cards to reprogram themselves from flash and come back.
   */
  waitAfterMs?: number;
}

/**
 * Read access to other panels while planning.
 *
 * Some values belong to one panel but are needed by several. The number of
 * triggers is the clearest case: the Swing main window had a single
 * "Number of triggers" spinner that Start Run, Stop Run, RST SOFT and RST HARD
 * all read. Copying it into each panel would let four values drift apart, so the
 * owning panel keeps it and the others read it from here.
 */
export interface PlanContext {
  /** Current values of another panel, with its declared defaults applied. */
  panel(id: string): ParamAccess;
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
  plan: (p: ParamAccess, ctx: PlanContext) => PlannedWrite[];
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
