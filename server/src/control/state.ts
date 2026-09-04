import { EventEmitter } from 'node:events';

/**
 * Run-control state machine.
 *
 * The original coordinated runs through ordinary mutable statics on `Global`
 * (`system_on`, `stopAcq`, `ReStartingSystem`, `waitstop`, ACK flags, …) polled
 * from worker threads with ~413 sleep/poll sites and no memory-model guarantees.
 * State lives in one place here, transitions are explicit and validated, and
 * every change is timestamped and published as an immutable snapshot.
 */

export type RunState =
  | 'DISCONNECTED'
  | 'CONFIGURING'
  | 'READY'
  | 'RUNNING'
  | 'STOPPING'
  | 'ERROR';

/** Transitions permitted from each state. Anything else is a programming error. */
const ALLOWED: Record<RunState, readonly RunState[]> = {
  DISCONNECTED: ['CONFIGURING', 'ERROR'],
  CONFIGURING: ['READY', 'ERROR', 'DISCONNECTED'],
  READY: ['RUNNING', 'CONFIGURING', 'DISCONNECTED', 'ERROR'],
  RUNNING: ['STOPPING', 'ERROR'],
  STOPPING: ['READY', 'DISCONNECTED', 'ERROR'],
  // ERROR is recoverable only by an explicit operator reset back to DISCONNECTED.
  ERROR: ['DISCONNECTED'],
};

export interface Transition {
  from: RunState;
  to: RunState;
  reason: string;
  at: number;
}

export interface ControlSnapshot {
  state: RunState;
  since: number;
  runNumber?: number;
  lastError?: string;
  history: Transition[];
}

export class InvalidTransitionError extends Error {
  constructor(from: RunState, to: RunState) {
    super(`Cannot move from ${from} to ${to}`);
    this.name = 'InvalidTransitionError';
  }
}

export class RunControl extends EventEmitter<{ change: [ControlSnapshot] }> {
  private state: RunState = 'DISCONNECTED';
  private since = Date.now();
  private lastError?: string;
  private runNumber?: number;
  private readonly history: Transition[] = [];

  /** Keeps the published history bounded; the full record goes to the run log. */
  private static readonly HISTORY_LIMIT = 200;

  get current(): RunState {
    return this.state;
  }

  canMoveTo(to: RunState): boolean {
    return ALLOWED[this.state].includes(to);
  }

  /** Move to `to`, or throw if the transition is not permitted. */
  moveTo(to: RunState, reason: string): ControlSnapshot {
    if (!this.canMoveTo(to)) throw new InvalidTransitionError(this.state, to);
    const t: Transition = { from: this.state, to, reason, at: Date.now() };
    this.state = to;
    this.since = t.at;
    if (to !== 'ERROR') this.lastError = undefined;
    this.history.push(t);
    if (this.history.length > RunControl.HISTORY_LIMIT) this.history.shift();
    const snap = this.snapshot();
    this.emit('change', snap);
    return snap;
  }

  /**
   * Move to ERROR from wherever we are. Always permitted — a fault must never be
   * swallowed because the state machine disallowed reporting it.
   */
  fail(reason: string): ControlSnapshot {
    const t: Transition = { from: this.state, to: 'ERROR', reason, at: Date.now() };
    this.state = 'ERROR';
    this.since = t.at;
    this.lastError = reason;
    this.history.push(t);
    if (this.history.length > RunControl.HISTORY_LIMIT) this.history.shift();
    const snap = this.snapshot();
    this.emit('change', snap);
    return snap;
  }

  setRunNumber(n: number | undefined): void {
    this.runNumber = n;
    this.emit('change', this.snapshot());
  }

  snapshot(): ControlSnapshot {
    return {
      state: this.state,
      since: this.since,
      runNumber: this.runNumber,
      lastError: this.lastError,
      history: [...this.history],
    };
  }
}
