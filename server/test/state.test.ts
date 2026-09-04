import { describe, expect, it } from 'vitest';
import { InvalidTransitionError, RunControl } from '../src/control/state.js';

describe('RunControl', () => {
  const ready = (): RunControl => {
    const c = new RunControl();
    c.moveTo('CONFIGURING', 'start');
    c.moveTo('READY', 'configured');
    return c;
  };

  it('starts disconnected', () => {
    expect(new RunControl().current).toBe('DISCONNECTED');
  });

  it('walks the normal run cycle', () => {
    const c = ready();
    expect(c.moveTo('RUNNING', 'operator start').state).toBe('RUNNING');
    expect(c.moveTo('STOPPING', 'operator stop').state).toBe('STOPPING');
    expect(c.moveTo('READY', 'stopped').state).toBe('READY');
  });

  it('refuses a transition that skips the cycle', () => {
    const c = new RunControl();
    expect(() => c.moveTo('RUNNING', 'nope')).toThrow(InvalidTransitionError);
    expect(c.current).toBe('DISCONNECTED');
  });

  it('cannot start a run that was never configured', () => {
    const c = new RunControl();
    c.moveTo('CONFIGURING', 'start');
    expect(() => c.moveTo('RUNNING', 'too early')).toThrow(/Cannot move from CONFIGURING to RUNNING/);
  });

  it('always allows failing, from any state', () => {
    const c = ready();
    c.moveTo('RUNNING', 'go');
    const snap = c.fail('card dropped out');
    expect(snap.state).toBe('ERROR');
    expect(snap.lastError).toBe('card dropped out');
  });

  it('leaves ERROR only by an explicit reset', () => {
    const c = ready();
    c.fail('bad');
    expect(() => c.moveTo('RUNNING', 'ignore the error')).toThrow(InvalidTransitionError);
    expect(c.moveTo('DISCONNECTED', 'operator reset').state).toBe('DISCONNECTED');
  });

  it('clears the recorded error once it leaves ERROR', () => {
    const c = ready();
    c.fail('bad');
    expect(c.moveTo('DISCONNECTED', 'reset').lastError).toBeUndefined();
  });

  it('records a transition history with reasons', () => {
    const c = ready();
    expect(c.snapshot().history.map((h) => `${h.from}->${h.to}`)).toEqual([
      'DISCONNECTED->CONFIGURING',
      'CONFIGURING->READY',
    ]);
    expect(c.snapshot().history[0].reason).toBe('start');
  });

  it('notifies subscribers on every change', () => {
    const c = new RunControl();
    const seen: string[] = [];
    c.on('change', (s) => seen.push(s.state));
    c.moveTo('CONFIGURING', 'a');
    c.fail('b');
    expect(seen).toEqual(['CONFIGURING', 'ERROR']);
  });
});
