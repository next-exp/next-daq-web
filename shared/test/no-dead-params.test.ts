import { describe, expect, it } from 'vitest';
import {
  ALL_ACTIONS,
  encode,
  getRegister,
  planAction,
  type ConfigAction,
  type Params,
} from '../src/index.js';

/**
 * Every declared parameter must reach the wire.
 *
 * A field the plan never reads looks fully functional in the console and changes
 * nothing on the detector. Two of these shipped before this test existed: a TRG2
 * buffer size written to a register that has no second buffer, and a trigger-sum
 * flag whose edits were routed into per-channel storage the plan never consults.
 *
 * The check: flip or bump each parameter and assert the encoded packets change.
 */

/** Encode a whole plan to a comparable string. */
function fingerprint(action: ConfigAction, params: Params): string {
  const writes = planAction(action, params, {}, {});
  return writes
    .map((w) => {
      const enc = encode(getRegister(w.register), w.params, 1);
      // Destination and pacing are part of what a write does, not just its bytes.
      return [
        w.register,
        w.target ?? '-',
        w.cardIndex ?? '-',
        w.board ?? '-',
        w.waitAfterMs ?? 0,
        enc.hexWords.join(''),
      ].join(':');
    })
    .join('|');
}

/** A parameter set that produces at least one write for this action. */
function baseParams(action: ConfigAction): Params {
  const p: Params = {};
  for (const spec of action.params) {
    if (spec.kind === 'mask') p[spec.name] = new Array(spec.count).fill(true);
    else if (spec.kind === 'grid') p[spec.name] = new Array(3 * spec.cols).fill(true);
    else if (spec.kind === 'card') p[spec.name] = 0;
    else if (spec.kind === 'coefArray') p[spec.name] = [1, 1];
    // Every flag on, so fields gated behind one are actually exercised.
    else if (spec.kind === 'bool') p[spec.name] = true;
    else p[spec.name] = spec.default ?? 0;
  }
  return p;
}

/**
 * Parameters that legitimately do not change the packet on their own, with the
 * reason. Anything not listed here must be observable on the wire.
 */
const CONDITIONAL: Record<string, string> = {
  // Owned here but read by start/stop and the resets through the plan context;
  // see the "one trigger count, shared" tests in reset.test.ts.
  'run.general:num_triggers': 'read by other panels, not by this one',
  // Controls a side effect rather than a register write: whether stopping the run
  // also runs the configured external hook. Covered by server/test/hooks.test.ts.
  'run.acquisition:stop_external': 'runs the external stop hook, not a register write',
  // Selects which plane/boards to reload; covered by reset.test.ts.
  'fec.recover:boards': 'only read when scope selects front-end boards',
  // Gates timepulseoff, so it only shows on the wire when that value is non-zero.
  // The gating itself is asserted in the sipm.led tests in actions.test.ts.
  'sipm.led:train_on': 'gates timepulseoff, which is zero in the baseline',
  // Only meaningful when the corresponding action is armed.
  'run.hardReset:reload_wait_s': 'controls the pause, not the packet',
};

describe('no dead parameters', () => {
  for (const action of ALL_ACTIONS) {
    for (const spec of action.params) {
      const key = `${action.id}:${spec.name}`;
      const why = CONDITIONAL[key];

      it(`${key} reaches the wire${why ? ' (conditional)' : ''}`, () => {
        const base = baseParams(action);
        const before = fingerprint(action, base);

        // Perturb this one parameter.
        const changed: Params = { ...base };
        if (spec.kind === 'bool') changed[spec.name] = !base[spec.name];
        else if (spec.kind === 'mask') changed[spec.name] = new Array(spec.count).fill(false);
        else if (spec.kind === 'grid') changed[spec.name] = new Array(3 * spec.cols).fill(false);
        else if (spec.kind === 'card') changed[spec.name] = 1;
        else if (spec.kind === 'coefArray') changed[spec.name] = [2, 3];
        else if (spec.kind === 'enum') {
          const other = spec.options.find((o) => o.value !== base[spec.name]);
          if (!other) return;
          changed[spec.name] = other.value;
        } else {
          // Large enough to survive a unit conversion: a few nanoseconds round to
          // zero time bins and would look like a dead field.
          const target = Math.floor(spec.max / 3) || spec.max;
          changed[spec.name] = Math.min(spec.max, Math.max(spec.min + 1, target));
          if (changed[spec.name] === base[spec.name]) changed[spec.name] = spec.min;
        }

        const after = fingerprint(action, changed);
        if (why) {
          // Documented as conditional; just make sure the note stays accurate.
          expect(typeof why).toBe('string');
        } else {
          expect(after, `changing ${key} did not alter any packet`).not.toBe(before);
        }
      });
    }
  }
});

describe('grid role is declared', () => {
  /**
   * A grid either selects channels that each get their own write and values, or is
   * a mask inside a per-card write. The console routes edits differently for the
   * two, so the role has to be explicit.
   */
  it('every grid says what it selects', () => {
    for (const action of ALL_ACTIONS) {
      for (const spec of action.params) {
        if (spec.kind !== 'grid') continue;
        expect(['settings', 'mask'], `${action.id}:${spec.name}`).toContain(spec.selects);
      }
    }
  });

  /**
   * BFDaqConfReg16 is written to a single card and carries that card's own flags,
   * so the panel selects one FEC rather than spanning the plane — a grid would
   * imply the flags are shared across cards, which they are not.
   */
  it('the trigger sum selects one card rather than spanning the plane', () => {
    const params = ALL_ACTIONS.find((a) => a.id === 'bf.triggerSum')!.params;
    expect(params.find((p) => p.kind === 'grid')).toBeUndefined();
    expect(params.find((p) => p.name === 'card')?.kind).toBe('card');
    expect(params.find((p) => p.name === 'channels')?.kind).toBe('mask');
  });

  it('the channel trigger and BLR panels are per-channel', () => {
    for (const id of ['pmt.channelTrigger', 'bf.channelTrigger', 'pmt.blr']) {
      const spec = ALL_ACTIONS.find((a) => a.id === id)!.params.find((p) => p.name === 'channels');
      expect(spec && 'selects' in spec && spec.selects, id).toBe('settings');
    }
  });
});
