import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { Field, defaultsFor } from '../components/Fields';
import type { ActionInfo, ParamValues, Status } from '../types';

const SECTION_ORDER = ['run', 'trigger', 'pmt', 'bf', 'sipm', 'fec', 'test'];

/**
 * Operator configuration panels.
 *
 * Each panel gathers parameters in the units the detector is actually discussed
 * in — microseconds, hertz, counts — and its Apply button issues the whole
 * sequence of register writes, the way the Swing tabs' "Config Registers" buttons
 * did. Unlike the original, the exact writes are shown before anything is sent.
 */
export function Setup({ status }: { status?: Status }) {
  const [actions, setActions] = useState<ActionInfo[]>([]);
  const [sections, setSections] = useState<Record<string, string>>({});
  const [selectedId, setSelectedId] = useState<string>();
  const [values, setValues] = useState<ParamValues>({});
  const [plan, setPlan] = useState<
    { register: string; note?: string; hexWords: string[]; targets: string[] }[]
  >([]);
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .actions()
      .then((r) => {
        setActions(r.actions);
        setSections(r.sections);
        setSelectedId((id) => id ?? r.actions[0]?.id);
      })
      .catch((e) => setError(e.message));
  }, []);

  const selected = useMemo(() => actions.find((a) => a.id === selectedId), [actions, selectedId]);

  // Load this panel's stored values so a setup survives navigation and reloads.
  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    setResult(undefined);
    setError(undefined);
    api
      .settings(selected.id)
      .then((v) => !cancelled && setValues(v))
      .catch(() => !cancelled && setValues(defaultsFor(selected.params)));
    return () => {
      cancelled = true;
    };
  }, [selected]);

  // Re-plan on every edit, so the operator always sees what Apply will do.
  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    api
      .planAction(selected.id, values)
      .then((r) => !cancelled && (setPlan(r.writes), setError(undefined)))
      .catch((e) => !cancelled && (setPlan([]), setError(e.message)));
    return () => {
      cancelled = true;
    };
  }, [selected, values]);

  const grouped = useMemo(() => {
    const out: Record<string, ActionInfo[]> = {};
    for (const a of actions) (out[a.section] ??= []).push(a);
    return out;
  }, [actions]);

  // Persist edits so "save configuration" captures them even without applying.
  useEffect(() => {
    if (!selected || Object.keys(values).length === 0) return;
    const t = setTimeout(() => {
      api.saveSettings(selected.id, values).catch(() => undefined);
    }, 400);
    return () => clearTimeout(t);
  }, [selected, values]);

  const apply = async () => {
    if (!selected) return;
    setBusy(true);
    setError(undefined);
    setResult(undefined);
    try {
      const res = await api.applyAction(selected.id, values);
      setResult(
        `${res.dryRun ? 'Dry run — nothing transmitted. ' : ''}${res.applied.length} register write${
          res.applied.length === 1 ? '' : 's'
        } ${res.dryRun ? 'planned' : 'sent'}.`,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid">
      <div className="panel">
        <h2>Panels ({actions.length})</h2>
        <div className="reg-list">
          {SECTION_ORDER.filter((s) => grouped[s]).map((s) => (
            <div key={s}>
              <h3>{sections[s] ?? s}</h3>
              {grouped[s].map((a) => (
                <button key={a.id} aria-selected={a.id === selectedId} onClick={() => setSelectedId(a.id)}>
                  <div className="id" style={{ fontFamily: 'inherit', fontWeight: 600 }}>
                    {a.title}
                  </div>
                  {a.origin && <div className="title">{a.origin}</div>}
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>

      {selected && (
        <div style={{ display: 'grid', gap: 16 }}>
          <div className="panel">
            <h2>{selected.title}</h2>
            <div className="body">
              {selected.description && <p className="note">{selected.description}</p>}
              {selected.params.map((p) => (
                <Field
                  key={p.name}
                  spec={p}
                  value={values[p.name]}
                  onChange={(v) => setValues((s) => ({ ...s, [p.name]: v }))}
                />
              ))}
            </div>
          </div>

          <div className="panel">
            <h2>
              Register writes ({plan.length})
            </h2>
            <div className="body">
              {error && <div className="error-box">{error}</div>}
              {result && <div className="ok-box">{result}</div>}

              {plan.length === 0 && !error && (
                <p className="note">
                  Nothing to send with the current selection — choose at least one channel or card.
                </p>
              )}

              {plan.map((w, i) => (
                <div key={i} style={{ marginBottom: 10 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                    <strong style={{ fontFamily: 'var(--mono)', fontSize: 13 }}>{w.register}</strong>
                    {w.note && <span className="note" style={{ margin: 0 }}>{w.note}</span>}
                    <span style={{ flex: 1 }} />
                    <span className="note" style={{ margin: 0, fontFamily: 'var(--mono)' }}>
                      {w.targets.join(', ')}
                    </span>
                  </div>
                  <div className="words" style={{ marginTop: 4 }}>
                    {w.hexWords.map((h, j) => (
                      <span key={j} className={`w${j === 1 ? ' hdr' : j === 2 ? ' reg' : ''}`}>
                        {h}
                      </span>
                    ))}
                  </div>
                </div>
              ))}

              <button
                className="action primary"
                onClick={apply}
                disabled={busy || plan.length === 0 || !!error}
              >
                {busy
                  ? 'Applying…'
                  : status?.dryRun
                    ? 'Apply (dry run)'
                    : `Config registers — send ${plan.length} write${plan.length === 1 ? '' : 's'}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
