import { useEffect, useState } from 'react';
import { api } from '../api';

/**
 * Configuration file editor.
 *
 * Reads and writes the same `key:value` format the Java produced, so existing
 * Config.txt files load unchanged. Lines that cannot be parsed are reported
 * rather than dropped.
 */
export function Config() {
  const [files, setFiles] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [entries, setEntries] = useState<Record<string, string>>({});
  const [malformed, setMalformed] = useState<{ line: number; text: string }[]>([]);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [unrecognised, setUnrecognised] = useState<
    { shape: string; count: number; example: string }[]
  >([]);
  const [filter, setFilter] = useState('');
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();

  const refresh = () => api.configs().then((r) => setFiles(r.files)).catch(() => undefined);
  useEffect(() => void refresh(), []);

  const load = async (f: string) => {
    setError(undefined);
    setMessage(undefined);
    try {
      const r = await api.loadConfig(f);
      setName(f);
      setEntries(r.entries);
      setMalformed(r.malformed);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const save = async () => {
    try {
      const r = await api.saveConfig(name, entries);
      setMessage(`Saved ${r.count} entries to ${r.saved}`);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  /** Write every panel's current values to a file. */
  const saveCurrent = async () => {
    setError(undefined);
    setMessage(undefined);
    try {
      const r = await api.saveCurrentConfig(name);
      setMessage(`Saved the current setup — ${r.entries} settings written to ${r.saved}.`);
      await refresh();
      await load(r.saved);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  /** Load a saved file back into the operator panels. */
  const restore = async (f: string) => {
    setError(undefined);
    setMessage(undefined);
    try {
      const r = await api.restoreConfig(f);
      setMessage(
        r.format === 'legacy'
          ? `Imported ${r.applied} settings from ${r.file} into ${r.panels} panels. ` +
            'This file came from the DATE-era application and was translated.'
          : `Loaded ${r.applied} settings from ${r.file} into the panels.` +
            (r.skipped.length ? ` ${r.skipped.length} could not be read.` : ''),
      );
      setSkipped(r.skipped);
      setUnrecognised(r.unrecognised ?? []);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const keys = Object.keys(entries).filter((k) =>
    filter ? k.toLowerCase().includes(filter.toLowerCase()) : true,
  );

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="panel">
        <h2>Configuration files</h2>
        <div className="body">
          {error && <div className="error-box">{error}</div>}
          {message && <div className="ok-box">{message}</div>}
          <table className="data" style={{ marginBottom: 14 }}>
            <thead>
              <tr>
                <th>File</th>
                <th style={{ width: 220 }} />
              </tr>
            </thead>
            <tbody>
              {files.map((f) => (
                <tr key={f}>
                  <td className="mono">{f}</td>
                  <td style={{ display: 'flex', gap: 6 }}>
                    <button className="action" onClick={() => restore(f)}>
                      Load into panels
                    </button>
                    <button className="action" onClick={() => load(f)}>
                      Inspect
                    </button>
                  </td>
                </tr>
              ))}
              {files.length === 0 && (
                <tr>
                  <td colSpan={2} className="note">
                    No saved configurations yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          <div className="field" style={{ maxWidth: 340 }}>
            <label htmlFor="cfgname">File name</label>
            <input
              id="cfgname"
              type="text"
              value={name}
              placeholder="Config.txt"
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="action primary" onClick={saveCurrent} disabled={!name}>
              Save current setup
            </button>
            <button className="action" onClick={save} disabled={!name || keys.length === 0}>
              Save the edits below
            </button>
          </div>
          <p className="note" style={{ marginTop: 10 }}>
            <strong>Save current setup</strong> writes the values held by every Setup panel.
            <strong> Load into panels</strong> restores them. The table below is a direct view of
            the file for inspection and hand edits.
          </p>
        </div>
      </div>

      {unrecognised.length > 0 && (
        <div className="panel">
          <h2>Settings with no equivalent ({unrecognised.length} kinds)</h2>
          <div className="body">
            <p className="note">
              These have no panel to import into and were left out. Everything else was
              imported.
            </p>
            <table className="data">
              <thead>
                <tr>
                  <th>Setting</th>
                  <th style={{ width: 90 }}>Count</th>
                  <th>Example</th>
                </tr>
              </thead>
              <tbody>
                {unrecognised.map((u) => (
                  <tr key={u.shape}>
                    <td className="mono">{u.shape}</td>
                    <td className="mono">{u.count}</td>
                    <td className="mono">{u.example}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {skipped.length > 0 && (
        <div className="panel">
          <h2>Settings not restored ({skipped.length})</h2>
          <div className="body log">
            {skipped.map((m, i) => (
              <div className="line lvl-warn" key={i}>
                {m}
              </div>
            ))}
          </div>
        </div>
      )}

      {malformed.length > 0 && (
        <div className="panel">
          <h2>Unparsed lines ({malformed.length})</h2>
          <div className="body log">
            {malformed.map((m) => (
              <div className="line lvl-warn" key={m.line}>
                <span className="at">line {m.line}</span>
                {m.text}
              </div>
            ))}
          </div>
        </div>
      )}

      {Object.keys(entries).length > 0 && (
        <div className="panel">
          <h2>Entries ({Object.keys(entries).length})</h2>
          <div className="body">
            <div className="field">
              <input
                type="text"
                placeholder="Filter keys…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
            </div>
            <table className="data">
              <thead>
                <tr>
                  <th style={{ width: '70%' }}>Key</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => (
                  <tr key={k}>
                    <td className="mono">{k}</td>
                    <td>
                      <input
                        type="text"
                        value={entries[k]}
                        onChange={(e) => setEntries((s) => ({ ...s, [k]: e.target.value }))}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
