import { getAction, type Topology } from '@next-daq/shared';
import type { SettingsStore } from '../store/settings.js';

/**
 * Whether the detector has been configured enough to start a run.
 *
 * The Swing application gated its Start Run button on an operator having pressed
 * "Config Registers" on the trigger and general panels, and cleared that state on
 * a soft reset. Without an equivalent, a run can be started against cards that
 * were never configured — or, worse, that still hold the previous run\u2019s
 * settings after a reset.
 *
 * Two of the original\u2019s three counters actually worked: `jButton1_var8`
 * (trigger) and `jButton1_var10` (general). The third, `jButton1_var4`, is read
 * and reset but never incremented, and the `setup_PMT == 1` branch that consults
 * it is itself unreachable because `setup_PMT` is only ever assigned 0 \u2014 so
 * that arm of the interlock never had any effect. Only the two that worked are
 * required here; the plane panels are reported as advisory.
 */

export interface ReadinessItem {
  id: string;
  title: string;
  required: boolean;
  applied: boolean;
  at?: string;
  /** Why this panel matters, shown next to it in the console. */
  note?: string;
}

export interface Readiness {
  ready: boolean;
  items: ReadinessItem[];
  missing: string[];
}

/** Panels the original\u2019s interlock actually required before a run. */
const REQUIRED: { id: string; note: string }[] = [
  { id: 'run.general', note: 'Buffer, pre-trigger and run mode' },
  { id: 'trigger.config', note: 'Trigger sources, rate and coincidence windows' },
];

/** Panels that send a plane\u2019s configuration; advisory, and only when it has cards. */
const PER_PLANE: { plane: string; id: string; note: string }[] = [
  { plane: 'pmt', id: 'pmt.dataChannels', note: 'PMT channels written to data memory' },
  { plane: 'bf', id: 'bf.triggerSum', note: 'Energy-plane channels and trigger sum' },
  { plane: 'sipm', id: 'sipm.frontEnd', note: 'SiPM front-end baseline and zero suppression' },
];

export function computeReadiness(settings: SettingsStore, topology: Topology): Readiness {
  const entry = (id: string, required: boolean, note: string): ReadinessItem => {
    const applied = settings.getApplied(id);
    return {
      id,
      title: getAction(id).title,
      required,
      applied: applied !== undefined,
      at: applied?.at,
      note,
    };
  };

  const items = [
    ...REQUIRED.map((r) => entry(r.id, true, r.note)),
    // A plane with no configured cards is not part of this setup.
    ...PER_PLANE.filter((p) => topology.cards.some((c) => c.plane === p.plane)).map((p) =>
      entry(p.id, false, p.note),
    ),
  ];

  const missing = items.filter((i) => i.required && !i.applied).map((i) => i.title);
  return { ready: missing.length === 0, items, missing };
}
