import type { ConfigAction, ActionSection, PlanContext, PlannedWrite } from './types.js';
import type { Params } from '../types.js';
import { makeAccess } from '../encode.js';
import { RUN_ACTIONS } from './run.js';
import { BF_ACTIONS, PMT_ACTIONS } from './planes.js';
import { SIPM_ACTIONS } from './sipm.js';
import { FEC_ACTIONS, TEST_ACTIONS } from './fec.js';
import { RESET_ACTIONS } from './reset.js';

export const ALL_ACTIONS: ConfigAction[] = [
  ...RUN_ACTIONS,
  ...PMT_ACTIONS,
  ...BF_ACTIONS,
  ...SIPM_ACTIONS,
  ...FEC_ACTIONS,
  ...TEST_ACTIONS,
  ...RESET_ACTIONS,
];

const byId = new Map(ALL_ACTIONS.map((a) => [a.id, a]));

export function getAction(id: string): ConfigAction {
  const a = byId.get(id);
  if (!a) throw new Error(`Unknown configuration action "${id}"`);
  return a;
}

export const actionsBySection = (s: ActionSection): ConfigAction[] =>
  ALL_ACTIONS.filter((a) => a.section === s);

export * from './types.js';
export * from './run.js';
export * from './planes.js';
export * from './sipm.js';
export * from './fec.js';
export * from './reset.js';

/**
 * Expand a configuration action into the register writes it performs.
 *
 * Pure: it transmits nothing, so the console can show the operator exactly which
 * registers a panel will touch before the command leaves the machine.
 */
export function planAction(
  action: ConfigAction,
  params: Params,
  /** Current values of every panel, for plans that read a value another panel owns. */
  allSettings: Record<string, Params> = {},
): PlannedWrite[] {
  const access = makeAccess(params, action.params, action.id);
  const ctx: PlanContext = {
    panel: (id) => {
      const other = getAction(id);
      return makeAccess(allSettings[id] ?? {}, other.params, id);
    },
  };
  return action.plan(access, ctx);
}
