import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { DEFAULT_TOPOLOGY, type Topology } from '@next-daq/shared';
import { Session } from '../src/control/session.js';

/**
 * The run state must follow what the operator actually does.
 *
 * It used to be set only by clicking it, so RUNNING meant "someone pressed
 * RUNNING" rather than "acquisition is under way" — misleading for the most
 * prominent indicator in the console, and it meant the interlock gated only the
 * button rather than the state.
 */
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'next-state-'));
afterAll(() => fs.rm(tmp, { recursive: true, force: true }));

let n = 0;
async function session(): Promise<Session> {
  const topology: Topology = {
    ...DEFAULT_TOPOLOGY,
    paths: { dataDir: path.join(tmp, `s${n++}`) },
  };
  // Dry run: states are exercised without opening a socket.
  const s = new Session(topology, true);
  await s.start();
  return s;
}

const configure = async (s: Session) => {
  await s.applyAction('run.general', {});
  await s.applyAction('trigger.config', {});
};

describe('actions drive the run state', () => {
  it('starts in CONFIGURING with the link open', async () => {
    expect((await session()).control.current).toBe('CONFIGURING');
  });

  it('reaches READY only once the interlock is satisfied', async () => {
    const s = await session();
    await s.applyAction('run.general', {});
    expect(s.control.current).toBe('CONFIGURING');
    await s.applyAction('trigger.config', {});
    expect(s.control.current).toBe('READY');
  });

  it('moves to RUNNING when acquisition starts', async () => {
    const s = await session();
    await configure(s);
    await s.applyAction('run.acquisition', { on_off: 1 });
    expect(s.control.current).toBe('RUNNING');
  });

  it('will not start a run before the interlock is satisfied', async () => {
    const s = await session();
    await s.applyAction('run.acquisition', { on_off: 1 });
    // The command is still sent — the operator asked for it — but the state does
    // not claim a run is under way from a configuration that was never applied.
    expect(s.control.current).not.toBe('RUNNING');
  });

  it('passes through STOPPING back to READY when acquisition stops', async () => {
    const s = await session();
    await configure(s);
    await s.applyAction('run.acquisition', { on_off: 1 });
    await s.applyAction('run.acquisition', { on_off: 0 });
    expect(s.control.current).toBe('READY');
    const path = s.control.snapshot().history.map((h) => h.to);
    expect(path).toContain('STOPPING');
  });

  it('returns to DISCONNECTED on a soft reset, even from RUNNING', async () => {
    const s = await session();
    await configure(s);
    await s.applyAction('run.acquisition', { on_off: 1 });
    expect(s.control.current).toBe('RUNNING');
    await s.applyAction('run.softReset', {});
    expect(s.control.current).toBe('DISCONNECTED');
  });

  it('drops back to CONFIGURING when a reset invalidates the interlock', async () => {
    const s = await session();
    await configure(s);
    await s.applyAction('run.softReset', {});
    expect(s.readiness().ready).toBe(false);
    await s.applyAction('run.general', {});
    expect(s.control.current).toBe('CONFIGURING');
  });

  it('does not reconfigure its way out of a run', async () => {
    const s = await session();
    await configure(s);
    await s.applyAction('run.acquisition', { on_off: 1 });
    // Applying a panel mid-run must not silently drop the state out of RUNNING.
    await s.applyAction('pmt.baseline', {});
    expect(s.control.current).toBe('RUNNING');
  });

  it('records a reason for every transition', async () => {
    const s = await session();
    await configure(s);
    for (const t of s.control.snapshot().history) {
      expect(t.reason).toBeTruthy();
    }
  });
});
