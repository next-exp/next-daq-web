import { useState } from 'react';
import { api } from '../api';
import type { ActionProgress, ParamValues, Status } from '../types';

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
            disabled={disabled}
            onClick={() => click('run.acquisition', 'Start run', { on_off: 1 })}
          >
            Start<br />Run
          </button>
          <button
            className="action big"
            disabled={disabled}
            onClick={() => click('run.acquisition', 'Stop run', { on_off: 0 })}
          >
            Stop<br />Run
          </button>
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

        <p className="note" style={{ marginTop: 12 }}>
          Each button uses the parameters set in the matching Setup panel. Soft reset stops
          acquisition and clears the configured state; hard reset also reloads every card from
          flash.
        </p>
      </div>
    </div>
  );
}
