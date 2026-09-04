import { api } from '../api';
import type { Status } from '../types';

const STATES = ['DISCONNECTED', 'CONFIGURING', 'READY', 'RUNNING', 'STOPPING', 'ERROR'];

/** Detector overview: run state, card health and link counters. */
export function Overview({ status, onChanged }: { status?: Status; onChanged: () => void }) {
  if (!status) return <div className="panel"><div className="body">Connecting…</div></div>;

  const move = async (to: string) => {
    try {
      await api.setState(to, 'Operator request from the web console');
      onChanged();
    } catch (e) {
      alert((e as Error).message);
    }
  };

  const rejected =
    status.counters.rejectedUnknownSource +
    Object.values(status.counters.rejectedMalformed).reduce((a, b) => a + b, 0);

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="panel">
        <h2>Run control</h2>
        <div className="body">
          {status.state.lastError && <div className="error-box">{status.state.lastError}</div>}
          {status.trigger.failed && (
            <div className="error-box">
              Trigger failure: {status.trigger.consecutiveInvalid} consecutive invalid
              trigger-enable words (last 0x
              {(status.trigger.lastValue ?? 0).toString(16).padStart(4, '0')}).
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {STATES.map((s) => (
              <button
                key={s}
                className={`action${s === status.state.state ? ' primary' : ''}`}
                onClick={() => move(s)}
                disabled={s === status.state.state}
              >
                {s}
              </button>
            ))}
          </div>
          <p className="note" style={{ marginTop: 12 }}>
            In state <strong>{status.state.state}</strong> since{' '}
            {new Date(status.state.since).toLocaleTimeString()}. Transitions are validated: an
            invalid one is refused rather than silently applied.
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
