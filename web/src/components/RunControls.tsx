import { useEffect, useState } from 'react';
import { api } from '../api';
import type { ActionProgress, ParamValues, Readiness, Status } from '../types';

/**
 * The always-visible operator controls.
 *
 * These were plain buttons on the Swing main window — Start Run, Stop Run, RST
 * SOFT, RST HARD — reachable at any time. Putting them behind a panel list, as an
 * earlier version of this console did, buries the controls an operator reaches for
 * when something is going wrong.
 *
 * Each button applies the corresponding panel using its stored settings, so the
 * parameters shown in Setup are the ones that get used.
 */

interface Props {
  status?: Status;
  progress?: ActionProgress;
  onChanged: () => void;
}

/** Hard reset takes the whole detector down for about a minute, so it is confirmed. */
const NEEDS_CONFIRMATION: Record<string, string> = {
  'run.hardReset':
    'Hard reset reloads the FPGA image on every card from flash. The detector will ' +
    'not respond for about a minute and the configuration must be re-applied afterwards.',
};

export function RunControls({ status, progress, onChanged }: Props) {
  const [busy, setBusy] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const [confirming, setConfirming] = useState<string>();
  const [readiness, setReadiness] = useState<Readiness>();
  /**
   * Whether this deployment runs anything when acquisition stops, and whether the
   * operator wants it to. The option belongs beside Stop Run: it changes what that
   * button does, and on the acquisition panel alone it was easy to miss.
   */
  const [stopHook, setStopHook] = useState<{ configured: boolean; command?: string }>();
  const [stopExternal, setStopExternal] = useState(true);
  /** Lets an operator start a run the interlock would otherwise block. */
  const [override, setOverride] = useState(false);

  // Re-check whenever the run state changes: applying a panel or resetting moves it.
  useEffect(() => {
    api.readiness().then(setReadiness).catch(() => undefined);
  }, [status?.state.state, status?.state.since, progress?.done]);

  useEffect(() => {
    api
      .hooks()
      .then((h) =>
        setStopHook({ configured: h.onRunStop, command: h.commands.onRunStop?.join(' ') }),
      )
      .catch(() => undefined);
    // Keep in step with the acquisition panel, so the two never disagree.
    api
      .settings('run.acquisition')
      .then((v) => setStopExternal(v.stop_external !== false))
      .catch(() => undefined);
  }, []);

  const run = async (actionId: string, label: string, overrides: ParamValues = {}) => {
    setBusy(actionId);
    setError(undefined);
    setMessage(undefined);
    setConfirming(undefined);
    try {
      // Use the values the operator set in the corresponding Setup panel.
      const stored = await api.settings(actionId);
      const res = await api.applyAction(actionId, { ...stored, ...overrides });
      setMessage(
        res.background
          ? `${label} started — about ${Math.round((res.estimatedMs ?? 0) / 1000)} s.`
          : `${label}: ${res.applied?.length ?? 0} write${
              (res.applied?.length ?? 0) === 1 ? '' : 's'
            }${res.dryRun ? ' (dry run, nothing transmitted)' : ' sent'}.`,
      );
      onChanged();
      api.readiness().then(setReadiness).catch(() => undefined);
    } catch (e) {
      setError(`${label} failed: ${(e as Error).message}`);
    } finally {
      setBusy(undefined);
    }
  };

  const click = (id: string, label: string, overrides?: ParamValues) => {
    if (NEEDS_CONFIRMATION[id] && confirming !== id) {
      setConfirming(id);
      return;
    }
    void run(id, label, overrides);
  };

  const disabled = !!busy || !status;
  const running = progress && !progress.done && !progress.error;
  const blocked = readiness ? !readiness.ready && !override : false;

  return (
    <div className="panel">
      <h2>Run control</h2>
      <div className="body">
        {error && <div className="error-box">{error}</div>}
        {message && <div className="ok-box">{message}</div>}

        {confirming && (
          <div className="error-box">
            <div style={{ marginBottom: 8 }}>{NEEDS_CONFIRMATION[confirming]}</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="action" onClick={() => click(confirming, 'Hard reset')}>
                Yes, hard reset
              </button>
              <button className="action" onClick={() => setConfirming(undefined)}>
                Cancel
              </button>
            </div>
          </div>
        )}

        <div className="run-controls">
          <button
            className="action primary big"
            disabled={disabled || blocked}
            title={blocked ? `Not configured: ${readiness?.missing.join(', ')}` : undefined}
            onClick={() => click('run.acquisition', 'Start run', { on_off: 1 })}
          >
            Start<br />Run
          </button>
          <button
            className="action big"
            disabled={disabled}
            onClick={() =>
              click('run.acquisition', 'Stop run', {
                on_off: 0,
                stop_external: stopExternal,
              })
            }
          >
            Stop<br />Run
          </button>

          {stopHook?.configured && (
            <label
              className="stop-hook"
              title={`Runs: ${stopHook.command}`}
            >
              <input
                type="checkbox"
                checked={stopExternal}
                onChange={(e) => {
                  setStopExternal(e.target.checked);
                  // Store it so the acquisition panel shows the same thing.
                  api
                    .saveSettings('run.acquisition', { stop_external: e.target.checked })
                    .catch(() => undefined);
                }}
              />
              <span>
                Auto-stop DUCK
                <small>{stopHook.command}</small>
              </span>
            </label>
          )}
          <span className="run-controls-gap" />
          <button
            className="action big"
            disabled={disabled}
            onClick={() => click('run.softReset', 'Soft reset')}
          >
            RST<br />SOFT
          </button>
          <button
            className="action big danger"
            disabled={disabled}
            onClick={() => click('run.hardReset', 'Hard reset')}
          >
            RST<br />HARD
          </button>
        </div>

        {running && progress && (
          <div style={{ marginTop: 12 }}>
            <div className="note" style={{ marginBottom: 6 }}>
              {progress.note ?? `Step ${progress.step} of ${progress.total}`}
            </div>
            <div className="progress">
              <div style={{ width: `${(progress.step / progress.total) * 100}%` }} />
            </div>
          </div>
        )}

        {readiness && (
          <div className="readiness">
            <div className="readiness-head">
              <span className={`badge ${readiness.ready ? 'ok' : 'warn'}`}>
                {readiness.ready ? 'configured' : 'not configured'}
              </span>
              <span className="note" style={{ margin: 0, flex: 1 }}>
                {readiness.ready
                  ? 'The panels a run depends on have all been applied.'
                  : `Apply these before starting a run: ${readiness.missing.join(', ')}.`}
              </span>
              {!readiness.ready && (
                <label className="note" style={{ margin: 0, display: 'flex', gap: 6 }}>
                  <input
                    type="checkbox"
                    checked={override}
                    onChange={(e) => setOverride(e.target.checked)}
                  />
                  Start anyway
                </label>
              )}
            </div>
            <ul className="readiness-list">
              {readiness.items.map((i) => (
                <li key={i.id} className={i.applied ? 'done' : i.required ? 'missing' : 'optional'}>
                  <span className="mark">{i.applied ? '✓' : i.required ? '!' : '·'}</span>
                  <span className="what">{i.title}</span>
                  <span className="why">{i.note}</span>
                  <span className="when">
                    {i.applied && i.at
                      ? new Date(i.at).toLocaleTimeString()
                      : i.required
                        ? 'required'
                        : 'not applied'}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="note" style={{ marginTop: 12 }}>
          Each button uses the parameters set in the matching Setup panel. Soft reset stops
          acquisition and clears the configured state, so the checklist must be satisfied again;
          hard reset also reloads every card from flash.
        </p>
      </div>
    </div>
  );
}
