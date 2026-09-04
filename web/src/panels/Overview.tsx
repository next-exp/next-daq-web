import { api } from '../api';
import { RunControls } from '../components/RunControls';
import type { ActionProgress, Status } from '../types';

/** What each run state means, shown beside the current one. */
const STATE_MEANING: Record<string, string> = {
  DISCONNECTED: 'No configured session with the cards.',
  CONFIGURING: 'Configuration applied; the run interlock is not yet satisfied.',
  READY: 'Configured and idle, waiting to start.',
  RUNNING: 'Acquisition under way.',
  STOPPING: 'Stop sent, cards still draining.',
  ERROR: 'A fault was reported and must be acknowledged.',
};

/** Order the run normally passes through, for the progress display. */
const STATE_FLOW = ['DISCONNECTED', 'CONFIGURING', 'READY', 'RUNNING'];

/** Detector overview: run state, card health and link counters. */
export function Overview({
  status,
  progress,
  onChanged,
}: {
  status?: Status;
  progress?: ActionProgress;
  onChanged: () => void;
}) {
  if (!status) return <div className="panel"><div className="body">Connecting…</div></div>;

  const acknowledge = async () => {
    try {
      await api.acknowledgeError();
      onChanged();
    } catch (e) {
      alert((e as Error).message);
    }
  };

  const rejected =
    status.counters.rejectedUnknownSource +
    Object.values(status.counters.rejectedMalformed).reduce((a, b) => a + b, 0);

  const state = status.state.state;
  const reached = STATE_FLOW.indexOf(state);

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <RunControls status={status} progress={progress} onChanged={onChanged} />

      <div className="panel">
        <h2>Run state</h2>
        <div className="body">
          {status.state.lastError && (
            <div className="error-box">
              <div style={{ marginBottom: 8 }}>{status.state.lastError}</div>
              <button className="action" onClick={acknowledge}>
                Acknowledge and reset
              </button>
            </div>
          )}
          {status.trigger.failed && (
            <div className="error-box">
              Trigger failure: {status.trigger.consecutiveInvalid} consecutive invalid
              trigger-enable words (last 0x
              {(status.trigger.lastValue ?? 0).toString(16).padStart(4, '0')}).
            </div>
          )}

          {/* Read-only: the state follows what you do, it is not something you set. */}
          <div className="state-flow">
            {STATE_FLOW.map((s, i) => (
              <div
                key={s}
                className={`state-step${s === state ? ' current' : i <= reached ? ' past' : ''}`}
              >
                {s}
              </div>
            ))}
            {(state === 'STOPPING' || state === 'ERROR') && (
              <div className={`state-step current ${state === 'ERROR' ? 'err' : ''}`}>{state}</div>
            )}
          </div>

          <p className="note" style={{ marginTop: 12 }}>
            <strong>{state}</strong> — {STATE_MEANING[state]} Since{' '}
            {new Date(status.state.since).toLocaleTimeString()}. The state follows what you do:
            applying configuration, starting or stopping a run, and resetting all move it.
          </p>
        </div>
      </div>

      <div className="panel">
        <h2>Link counters</h2>
        <div className="body stats">
          <div className="stat">
            <div className="n">{status.counters.sent}</div>
            <div className="l">Datagrams sent</div>
          </div>
          <div className="stat">
            <div className="n">{status.counters.received}</div>
            <div className="l">Accepted</div>
          </div>
          <div className="stat">
            <div className="n" style={rejected ? { color: 'var(--warn)' } : undefined}>
              {rejected}
            </div>
            <div className="l">Rejected</div>
          </div>
          <div className="stat">
            <div className="n" style={status.counters.sendErrors ? { color: 'var(--err)' } : undefined}>
              {status.counters.sendErrors}
            </div>
            <div className="l">Send errors</div>
          </div>
          <div className="stat">
            <div className="n">{status.registerCount}</div>
            <div className="l">Registers</div>
          </div>
        </div>
      </div>

      <div className="panel">
        <h2>Cards</h2>
        <table className="data">
          <thead>
            <tr>
              <th>Card</th>
              <th>Plane</th>
              <th>Address</th>
              <th>Replies</th>
              <th>Last seen</th>
              <th>TRG enable</th>
            </tr>
          </thead>
          <tbody>
            {status.cards.map((c) => (
              <tr key={c.id}>
                <td className="mono">{c.id}</td>
                <td>{c.plane}</td>
                <td className="mono">{c.host}</td>
                <td className="mono">
                  {c.repliesReceived === 0 ? (
                    <span style={{ color: 'var(--muted)' }}>none</span>
                  ) : (
                    c.repliesReceived
                  )}
                </td>
                <td>{c.lastSeen ? new Date(c.lastSeen).toLocaleTimeString() : '—'}</td>
                <td className="mono">
                  {c.lastTrgEnable !== undefined
                    ? `0x${c.lastTrgEnable.toString(16).padStart(4, '0')}`
                    : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="panel">
        <h2>Recent transitions</h2>
        <div className="body log">
          {status.state.history.length === 0 && <div className="note">No transitions yet.</div>}
          {[...status.state.history].reverse().map((h, i) => (
            <div className="line" key={i}>
              <span className="at">{new Date(h.at).toLocaleTimeString()}</span>
              {h.from} → {h.to} · {h.reason}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
