import { useEffect, useState } from 'react';
import { api } from '../api';

interface Entry {
  at: string;
  level: string;
  event: string;
  detail?: Record<string, unknown>;
}

/** Structured run log. Every command and rejected datagram is recorded. */
export function LogView() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [error, setError] = useState<string>();

  useEffect(() => {
    const load = () => api.log(300).then(setEntries).catch((e) => setError(e.message));
    load();
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="panel">
      <h2>Run log</h2>
      <div className="body">
        {error && <div className="error-box">{error}</div>}
        <div className="log">
          {entries.length === 0 && <div className="note">Nothing logged yet.</div>}
          {[...entries].reverse().map((e, i) => (
            <div className={`line lvl-${e.level}`} key={i}>
              <span className="at">{new Date(e.at).toLocaleTimeString()}</span>
              <strong>{e.event}</strong>
              {e.detail && ` · ${JSON.stringify(e.detail)}`}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
