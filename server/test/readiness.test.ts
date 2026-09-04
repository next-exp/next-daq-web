import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { DEFAULT_TOPOLOGY, type Topology } from '@next-daq/shared';
import { computeReadiness } from '../src/control/readiness.js';
import { SettingsStore } from '../src/store/settings.js';

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'next-readiness-'));
afterAll(() => fs.rm(tmp, { recursive: true, force: true }));

const store = () => new SettingsStore(tmp);

/**
 * The Swing application would not enable Start Run until the operator had pressed
 * "Config Registers" on the trigger and general panels, and cleared that state on
 * a soft reset. Without the equivalent, a run can be started against cards that
 * were never configured, or that a reset has just returned to their power-on state.
 */
describe('run readiness', () => {
  it('is not ready before anything has been applied', () => {
    const r = computeReadiness(store(), DEFAULT_TOPOLOGY);
    expect(r.ready).toBe(false);
    expect(r.missing).toHaveLength(2);
  });

  it('requires the general and trigger panels, matching the original interlock', () => {
    const required = computeReadiness(store(), DEFAULT_TOPOLOGY)
      .items.filter((i) => i.required)
      .map((i) => i.id);
    expect(required).toEqual(['run.general', 'trigger.config']);
  });

  it('becomes ready once both required panels are applied', () => {
    const s = store();
    s.markApplied('run.general', {});
    expect(computeReadiness(s, DEFAULT_TOPOLOGY).ready).toBe(false);
    s.markApplied('trigger.config', {});
    expect(computeReadiness(s, DEFAULT_TOPOLOGY).ready).toBe(true);
  });

  it('does not block on the advisory plane panels', () => {
    const s = store();
    s.markApplied('run.general', {});
    s.markApplied('trigger.config', {});
    const r = computeReadiness(s, DEFAULT_TOPOLOGY);
    expect(r.ready).toBe(true);
    // The plane panels are listed but not required.
    expect(r.items.some((i) => !i.required && !i.applied)).toBe(true);
  });

  it('lists only the planes that have configured cards', () => {
    const noSipm: Topology = {
      ...DEFAULT_TOPOLOGY,
      cards: DEFAULT_TOPOLOGY.cards.filter((c) => c.plane !== 'sipm'),
    };
    const ids = computeReadiness(store(), noSipm).items.map((i) => i.id);
    expect(ids).not.toContain('sipm.frontEnd');
    expect(ids).toContain('pmt.dataChannels');
  });

  it('reports when each panel was applied', () => {
    const s = store();
    s.markApplied('run.general', {});
    const item = computeReadiness(s, DEFAULT_TOPOLOGY).items.find((i) => i.id === 'run.general');
    expect(item?.applied).toBe(true);
    expect(Date.parse(item!.at!)).not.toBeNaN();
  });

  /** A reset returns the cards to a state the console's record no longer describes. */
  it('is no longer ready after the applied state is cleared', () => {
    const s = store();
    s.markApplied('run.general', {});
    s.markApplied('trigger.config', {});
    expect(computeReadiness(s, DEFAULT_TOPOLOGY).ready).toBe(true);

    s.clearApplied();
    expect(computeReadiness(s, DEFAULT_TOPOLOGY).ready).toBe(false);
    expect(computeReadiness(s, DEFAULT_TOPOLOGY).missing).toHaveLength(2);
  });

  it('keeps the panel values when the applied state is cleared', () => {
    // A reset invalidates what the cards were told, not what the operator set up.
    const s = store();
    s.set('run.general', { buffer_us: 2000 });
    s.markApplied('run.general', { buffer_us: 2000 });
    s.clearApplied();
    expect(s.get('run.general').buffer_us).toBe(2000);
  });
});
