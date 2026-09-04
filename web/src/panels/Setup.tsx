import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { Field, defaultsFor } from '../components/Fields';
import { ChannelTable } from '../components/ChannelTable';
import { SectionList } from '../components/SectionList';
import { differsFromPanel } from '../lib/channels';
import type { ActionInfo, ActionProgress, ParamValues, Status } from '../types';

const SECTION_ORDER = ['run', 'trigger', 'pmt', 'bf', 'sipm', 'fec', 'test'];

/**
 * Group parameters into rows for display.
 *
 * Grids and masks need the full width; numeric, enum and boolean fields are packed
 * several to a row. A panel like the channel trigger has twenty numeric fields, and
 * one per line made it several screens tall.
 */
function groupForLayout(
  params: ActionInfo['params'],
): { wide: boolean; items: ActionInfo['params'] }[] {
  const rows: { wide: boolean; items: ActionInfo['params'] }[] = [];
  for (const p of params) {
    const wide = p.kind === 'grid' || p.kind === 'mask' || p.kind === 'coefArray';
    const last = rows[rows.length - 1];
    if (wide) {
      rows.push({ wide: true, items: [p] });
    } else if (last && !last.wide) {
      last.items.push(p);
    } else {
      rows.push({ wide: false, items: [p] });
    }
  }
  return rows;
}

/**
 * Split a panel's parameters into the sections it declares, preserving order.
 *
 * Without this the fields flow in declaration order into whatever row fits, so a
 * panel carrying per-trigger copies of the same nine settings interleaves them —
 * "Trigger 1 pulse valid extension" ends up beside "Trigger 2 baseline deviation"
 * and the two sets are impossible to read apart.
 */
function sectionsOf(
  params: ActionInfo['params'],
): { title?: string; params: ActionInfo['params'] }[] {
  const out: { title?: string; params: ActionInfo['params'] }[] = [];
  for (const p of params) {
    const title = p.section;
    const last = out[out.length - 1];
    if (last && last.title === title) last.params.push(p);
    else out.push({ title, params: [p] });
  }
  return out;
}

/**
 * Which channels carry settings of their own.
 *
 * The marker deliberately does not track one particular field: a channel has
 * twenty parameters, and singling one out would misrepresent the rest. The table
 * below the form shows the actual values.
 */
function channelConfiguredMask(
  channels: Record<string, ParamValues>,
  base: ParamValues,
  cols: number,
  spec: { rows?: { id: string }[] },
): boolean[] | undefined {
  if (!cols || !spec.rows) return undefined;
  return Array.from({ length: spec.rows.length * cols }, (_, i) => {
    const key = `${Math.floor(i / cols)}:${i % cols}`;
    return differsFromPanel(channels[key], base);
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
export function Setup({
  status,
  progress,
  onStatusChanged,
}: {
  status?: Status;
  progress?: ActionProgress;
  /** Refreshes the status, which carries the list of panels with unsent edits. */
  onStatusChanged?: () => void;
}) {
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
  /**
   * Bumped once a per-channel edit has been stored.
   *
   * The plan is computed server-side from the stored channel values, and a
   * per-channel edit deliberately leaves the panel values alone — so without this
   * the preview would not re-run and would show stale packets.
   */
  const [channelRev, setChannelRev] = useState(0);
  /** Per-card values, keyed by card index, for per-card panels. */
  const [cards, setCards] = useState<Record<string, ParamValues>>({});
  /**
   * Per-channel edits waiting to be stored.
   *
   * Typing fires one change per keystroke; sending each immediately means several
   * in-flight writes whose completion order is not guaranteed, so a slower earlier
   * write could land last and win. Edits are coalesced and sent once instead.
   */
  const pendingChannelEdits = useRef<ParamValues>({});
  /**
   * The values as loaded for the current panel.
   *
   * Selecting a panel sets `values`, which would otherwise trigger the debounced
   * save and write them straight back — pointless traffic, and enough to mark a
   * panel as edited that the operator only looked at.
   */
  const loadedValues = useRef<string>('');
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
      .then((v) => {
        if (cancelled) return;
        loadedValues.current = JSON.stringify(v);
        setValues(v);
      })
      .catch(() => {
        if (cancelled) return;
        const d = defaultsFor(selected.params);
        loadedValues.current = JSON.stringify(d);
        setValues(d);
      });
    api
      .appliedSettings(selected.id)
      .then((a) => !cancelled && setApplied(a))
      .catch(() => !cancelled && setApplied(undefined));
    api
      .channelSettings(selected.id)
      .then((c) => !cancelled && setChannels(c))
      .catch(() => !cancelled && setChannels({}));
    api
      .cardSettings(selected.id)
      .then((c) => !cancelled && setCards(c))
      .catch(() => !cancelled && setCards({}));
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
  }, [selected, values, channelRev]);

  const gridSpec = selected?.params.find((p) => p.kind === 'grid');
  const cols = gridSpec && 'cols' in gridSpec ? gridSpec.cols : 0;
  /**
   * Whether this panel's other fields belong to the selected channels or to the
   * card. A trigger-sum flag is card-level even though the panel has a grid, so
   * routing its edits per channel would store them where nothing reads them.
   */
  const perChannel =
    !!gridSpec && 'selects' in gridSpec && gridSpec.selects !== 'mask';
  const isPending = !!selectedId && (status?.pending ?? []).includes(selectedId);

  /**
   * The card whose values this panel is showing. On a per-card panel the settings
   * belong to the selected FEC, so switching the selector switches the values.
   */
  const cardParam = selected?.params.find((p) => p.kind === 'card');
  const perCard = !!selected?.perCard && !!cardParam;
  const cardIndex = cardParam ? Number(values[cardParam.name] ?? 0) : 0;
  const cardValues = perCard ? (cards[String(cardIndex)] ?? {}) : {};

  /** Keys of the currently ticked channels, as "cardIndex:channel". */
  const selectedKeys = useMemo(() => {
    if (!gridSpec || !perChannel) return [];
    const bits = (values[gridSpec.name] as boolean[] | undefined) ?? [];
    const out: string[] = [];
    bits.forEach((on, i) => {
      if (on) out.push(`${Math.floor(i / cols)}:${i % cols}`);
    });
    return out;
  }, [gridSpec, perChannel, values, cols]);

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
    // Unchanged since it was loaded: nothing to save.
    if (JSON.stringify(values) === loadedValues.current) return;
    const t = setTimeout(() => {
      api
        .saveSettings(selected.id, values)
        .then(() => onStatusChanged?.())
        .catch(() => undefined);
    }, 400);
    return () => clearTimeout(t);
  }, [selected, values]);

  /**
   * Store the coalesced per-channel edits, then re-plan.
   *
   * The plan is computed server-side from the stored values, so the preview can
   * only be refreshed once the write has landed.
   */
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();
  const queueChannelSave = () => {
    if (!selected) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const edits = pendingChannelEdits.current;
      pendingChannelEdits.current = {};
      if (Object.keys(edits).length === 0) return;
      api
        .setChannelSettings(selected.id, selectedKeys, edits)
        .then(() => {
          setChannelRev((n) => n + 1);
          onStatusChanged?.();
        })
        .catch((e) => setError((e as Error).message));
    }, 250);
  };

  // Do not carry a half-typed edit into a different panel.
  useEffect(() => {
    return () => {
      clearTimeout(saveTimer.current);
      pendingChannelEdits.current = {};
    };
  }, [selected]);

  const apply = async () => {
    if (!selected) return;
    setBusy(true);
    setError(undefined);
    setResult(undefined);
    try {
      // Flush any edit still waiting on the debounce.
      clearTimeout(saveTimer.current);
      const edits = pendingChannelEdits.current;
      pendingChannelEdits.current = {};
      if (Object.keys(edits).length > 0) {
        await api.setChannelSettings(selected.id, selectedKeys, edits);
      }
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
    } finally {
      setBusy(false);
      // Refresh on both paths: a failed apply may still have sent some writes, so
      // "last sent" and the unapplied-changes marks have to be re-read either way.
      api.appliedSettings(selected.id).then(setApplied).catch(() => undefined);
      onStatusChanged?.();
    }
  };

  return (
    <div className="grid">
      <div className="panel">
        <h2>Panels ({actions.length})</h2>
        <div className="reg-list">
          <SectionList
            storageKey="next-daq.setup.collapsed"
            groups={SECTION_ORDER.filter((s) => grouped[s]).map((s) => ({
              id: s,
              title: sections[s] ?? s,
              items: grouped[s],
            }))}
            itemId={(a) => a.id}
            selectedId={selectedId}
            pendingIds={status?.pending ?? []}
            onSelect={(a) => setSelectedId(a.id)}
            renderItem={(a) => (
              <>
                <div className="id" style={{ fontFamily: 'inherit', fontWeight: 600 }}>
                  {a.title}
                </div>
                {a.origin && <div className="title">{a.origin}</div>}
              </>
            )}
          />
        </div>
      </div>

      {selected && (
        <div style={{ display: 'grid', gap: 16 }}>
          <div className="panel">
            <div className="panel-head">
              <h2>{selected.title}</h2>
              <button
                className={`action primary${isPending ? ' attention' : ''}`}
                onClick={apply}
                disabled={busy || plan.length === 0 || !!error}
              >
                {busy
                  ? 'Applying…'
                  : status?.dryRun
                    ? `Apply (dry run) — ${plan.length}`
                    : `Config registers — send ${plan.length}`}
              </button>
            </div>
            <div className="body">
              {error && <div className="error-box">{error}</div>}
              {result && <div className="ok-box">{result}</div>}
              {isPending && (
                <div className="unapplied-box">
                  <span className="dot" />
                  <span>
                    This panel has changes that have not been sent to the cards. Apply to send
                    them.
                  </span>
                </div>
              )}
              {selected.description && <p className="note">{selected.description}</p>}
              <p className="note">
                {applied?.at
                  ? `Last sent to the cards ${new Date(applied.at).toLocaleString()}.`
                  : 'Never sent to the cards from this console.'}
                {perCard && (
                  <>
                    {' '}Showing the settings for the selected FEC; each card keeps its own.
                  </>
                )}
                {gridSpec &&
                  perChannel &&
                  (selectedKeys.length === 0
                    ? ' Select channels to see and edit their settings.'
                    : selectedKeys.length === 1
                      ? ` Showing channel ${selectedKeys[0].replace(':', ', channel ')}.`
                      : ` Editing ${selectedKeys.length} channels — fields they disagree on show "Mixed", and changing one sets it for all of them.`)}
              </p>
              {sectionsOf(selected.params).map((sec, si) => (
                <section key={si} className={sec.title ? 'param-section' : undefined}>
                  {sec.title && <h3 className="param-section-title">{sec.title}</h3>}
                  {groupForLayout(sec.params).map((row, ri) => (
                <div key={ri} className={row.wide ? 'field-full' : 'field-grid'}>
                  {row.items.map((p) => (
                <Field
                  key={p.name}
                  spec={p}
                  value={
                    p.kind !== 'grid' && selectedKeys.length > 0
                      ? channelView.values[p.name]
                      : perCard && p.kind !== 'card'
                        ? (cardValues[p.name] ?? values[p.name])
                        : values[p.name]
                  }
                  mixed={p.kind !== 'grid' && channelView.mixed.has(p.name)}
                  applied={
                    p.kind === 'grid' && perChannel
                      ? channelConfiguredMask(channels, values, cols, p)
                      : undefined
                  }
                  onChange={(v) => {
                    if (p.kind !== 'grid' && selectedKeys.length > 0) {
                      // The edit belongs to the ticked channels only. Writing it to
                      // the panel value as well would make it the fallback for every
                      // unset channel, so nothing would ever read as "Mixed".
                      setChannels((c) => {
                        const next = { ...c };
                        for (const k of selectedKeys) next[k] = { ...next[k], [p.name]: v };
                        return next;
                      });
                      pendingChannelEdits.current[p.name] = v;
                      queueChannelSave();
                    } else if (perCard && p.kind !== 'card') {
                      // The edit belongs to the selected FEC, not to the panel.
                      setCards((c) => ({
                        ...c,
                        [String(cardIndex)]: { ...c[String(cardIndex)], [p.name]: v },
                      }));
                      api
                        .setCardSettings(selected.id, cardIndex, { [p.name]: v })
                        .then(() => {
                          setChannelRev((n) => n + 1);
                          onStatusChanged?.();
                        })
                        .catch(() => undefined);
                    } else {
                      setValues((s) => ({ ...s, [p.name]: v }));
                    }
                  }}
                />
                  ))}
                    </div>
                  ))}
                </section>
              ))}
            </div>
          </div>

          {gridSpec && perChannel && 'rows' in gridSpec && (
            <div className="panel">
              <h2>Channel settings</h2>
              <div className="body">
                <ChannelTable
                  action={selected}
                  channels={channels}
                  base={values}
                  rows={gridSpec.rows ?? []}
                  cols={cols}
                  selectedKeys={selectedKeys}
                  onSelect={(keys) => {
                    const size = (gridSpec.rows?.length ?? 0) * cols;
                    const bits = new Array(size).fill(false);
                    for (const k of keys) {
                      const [card, ch] = k.split(':').map(Number);
                      bits[card * cols + ch] = true;
                    }
                    setValues((v) => ({ ...v, [gridSpec.name]: bits }));
                  }}
                />
              </div>
            </div>
          )}

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

            </div>
          </div>
        </div>
      )}
    </div>
  );
}
