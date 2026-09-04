import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { Field, defaultsFor } from '../components/Fields';
import type { ActionInfo, ActionProgress, ParamValues, Status } from '../types';

const SECTION_ORDER = ['run', 'trigger', 'pmt', 'bf', 'sipm', 'fec', 'test'];

/**
 * Which channels are enabled according to their own stored settings, so the grid
 * shows per-channel state rather than only what is ticked for the next write.
 */
function channelEnabledMask(
  action: ActionInfo | undefined,
  channels: Record<string, ParamValues>,
  cols: number,
  spec: { kind: string; rows?: { id: string }[] },
): boolean[] | undefined {
  if (!action || !cols || !spec.rows) return undefined;
  // The field that means "this channel is on" differs between panels.
  const onField = action.params.find((p) => ['on1', 'on'].includes(p.name))?.name;
  if (!onField) return undefined;
  return Array.from({ length: spec.rows.length * cols }, (_, i) => {
    const key = `${Math.floor(i / cols)}:${i % cols}`;
    return Boolean(channels[key]?.[onField]);
  });
}

/**
 * Operator configuration panels.
 *
 * Each panel gathers parameters in the units the detector is actually discussed
 * in — microseconds, hertz, counts — and its Apply button issues the whole
 * sequence of register writes, the way the Swing tabs' "Config Registers" buttons
 * did. Unlike the original, the exact writes are shown before anything is sent.
 */
export function Setup({ status, progress }: { status?: Status; progress?: ActionProgress }) {
  const [actions, setActions] = useState<ActionInfo[]>([]);
  const [sections, setSections] = useState<Record<string, string>>({});
  const [selectedId, setSelectedId] = useState<string>();
  const [values, setValues] = useState<ParamValues>({});
  const [plan, setPlan] = useState<
    { register: string; note?: string; hexWords: string[]; targets: string[] }[]
  >([]);
  const [applied, setApplied] = useState<{ params: ParamValues | null; at: string | null }>();
  /** Per-channel values, keyed "cardIndex:channel", for grid panels. */
  const [channels, setChannels] = useState<Record<string, ParamValues>>({});
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
    api
      .appliedSettings(selected.id)
      .then((a) => !cancelled && setApplied(a))
      .catch(() => !cancelled && setApplied(undefined));
    api
      .channelSettings(selected.id)
      .then((c) => !cancelled && setChannels(c))
      .catch(() => !cancelled && setChannels({}));
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

  const gridSpec = selected?.params.find((p) => p.kind === 'grid');
  const cols = gridSpec && 'cols' in gridSpec ? gridSpec.cols : 0;

  /** Keys of the currently ticked channels, as "cardIndex:channel". */
  const selectedKeys = useMemo(() => {
    if (!gridSpec) return [];
    const bits = (values[gridSpec.name] as boolean[] | undefined) ?? [];
    const out: string[] = [];
    bits.forEach((on, i) => {
      if (on) out.push(`${Math.floor(i / cols)}:${i % cols}`);
    });
    return out;
  }, [gridSpec, values, cols]);

  /**
   * The value each field should show for the current selection: the shared value
   * when the channels agree, otherwise a "mixed" marker.
   */
  const channelView = useMemo(() => {
    if (!selected || selectedKeys.length === 0) return { values: {}, mixed: new Set<string>() };
    const view: ParamValues = {};
    const mixed = new Set<string>();
    for (const spec of selected.params) {
      if (spec.kind === 'grid') continue;
      const seen = selectedKeys.map((k) =>
        JSON.stringify(channels[k]?.[spec.name] ?? values[spec.name]),
      );
      const first = seen[0];
      if (seen.every((v) => v === first)) view[spec.name] = JSON.parse(first ?? 'null');
      else mixed.add(spec.name);
    }
    return { values: view, mixed };
  }, [selected, selectedKeys, channels, values]);

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
      if ('background' in res && res.background) {
        setResult(
          `Running in the background — about ${Math.round((res.estimatedMs ?? 0) / 1000)} s. ` +
            'Progress is shown below.',
        );
      } else {
        const applied = res.applied ?? [];
        setResult(
          `${res.dryRun ? 'Dry run — nothing transmitted. ' : ''}${applied.length} register write${
            applied.length === 1 ? '' : 's'
          } ${res.dryRun ? 'planned' : 'sent'}.`,
        );
      }
    } catch (e) {
      setError((e as Error).message);
      api.appliedSettings(selected.id).then(setApplied).catch(() => undefined);
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
              <p className="note">
                {applied?.at
                  ? `Last sent to the cards ${new Date(applied.at).toLocaleString()}.`
                  : 'Never sent to the cards from this console.'}
                {gridSpec &&
                  (selectedKeys.length === 0
                    ? ' Select channels to see and edit their settings.'
                    : selectedKeys.length === 1
                      ? ` Showing channel ${selectedKeys[0].replace(':', ', channel ')}.`
                      : ` Editing ${selectedKeys.length} channels — fields they disagree on show "Mixed", and changing one sets it for all of them.`)}
              </p>
              {selected.params.map((p) => (
                <Field
                  key={p.name}
                  spec={p}
                  value={
                    p.kind !== 'grid' && selectedKeys.length > 0
                      ? channelView.values[p.name]
                      : values[p.name]
                  }
                  mixed={p.kind !== 'grid' && channelView.mixed.has(p.name)}
                  applied={
                    p.kind === 'grid' ? channelEnabledMask(selected, channels, cols, p) : undefined
                  }
                  onChange={(v) => {
                    setValues((s) => ({ ...s, [p.name]: v }));
                    if (p.kind !== 'grid' && selectedKeys.length > 0) {
                      // The edit belongs to the ticked channels, not the panel.
                      setChannels((c) => {
                        const next = { ...c };
                        for (const k of selectedKeys) next[k] = { ...next[k], [p.name]: v };
                        return next;
                      });
                      api.setChannelSettings(selected.id, selectedKeys, { [p.name]: v })
                        .catch(() => undefined);
                    }
                  }}
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

              {progress && progress.action === selected.id && !progress.done && (
                <div className="ok-box">
                  <div style={{ marginBottom: 6 }}>
                    Step {progress.step} of {progress.total}
                    {progress.note ? ` — ${progress.note}` : ''}
                  </div>
                  <div className="progress">
                    <div style={{ width: `${(progress.step / progress.total) * 100}%` }} />
                  </div>
                </div>
              )}
              {progress && progress.action === selected.id && progress.error && (
                <div className="error-box">{progress.error}</div>
              )}

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
