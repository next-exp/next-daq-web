import { useEffect, useState } from 'react';
import { api } from '../api';
import type { FlashProgress, Status } from '../types';

/**
 * FPGA flash programming.
 *
 * The image is validated before the card is put into programming mode, and the
 * session reports a terminal outcome — the original could sit waiting for an ACK
 * indefinitely with nothing shown to the operator.
 */
export function Flash({ status, progress }: { status?: Status; progress?: FlashProgress }) {
  const [text, setText] = useState('');
  const [host, setHost] = useState('');
  const [flashSelect, setFlashSelect] = useState(false);
  const [inspection, setInspection] = useState<{
    recordCount: number;
    totalBytes: number;
    blocks: { address: number; length: number }[];
  }>();
  const [error, setError] = useState<string>();
  const [live, setLive] = useState<FlashProgress | undefined>(progress);

  useEffect(() => setLive(progress), [progress]);

  const onFile = async (file: File) => {
    setError(undefined);
    setInspection(undefined);
    const content = await file.text();
    setText(content);
    try {
      setInspection(await api.inspectFlash(content));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const start = async () => {
    setError(undefined);
    try {
      await api.startFlash(text, host, flashSelect);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const busy = live?.phase === 'erasing' || live?.phase === 'writing';
  const pct = live && live.recordsTotal ? (live.recordsSent / live.recordsTotal) * 100 : 0;

  return (
    <div style={{ display: 'grid', gap: 16, maxWidth: 900 }}>
      <div className="panel">
        <h2>Firmware image</h2>
        <div className="body">
          {error && <div className="error-box">{error}</div>}
          <div className="field">
            <label htmlFor="mcs">Intel HEX (.mcs) file</label>
            <input
              id="mcs"
              type="file"
              accept=".mcs,.hex"
              onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
            />
            <div className="help">
              The image is fully parsed and checksum-verified here before anything is sent.
            </div>
          </div>

          {inspection && (
            <div className="ok-box">
              Valid image: {inspection.recordCount.toLocaleString()} records,{' '}
              {inspection.totalBytes.toLocaleString()} bytes, {inspection.blocks.length} block
              {inspection.blocks.length === 1 ? '' : 's'} starting at 0x
              {inspection.blocks[0]?.address.toString(16)}.
            </div>
          )}
        </div>
      </div>

      <div className="panel">
        <h2>Target</h2>
        <div className="body">
          <div className="field">
            <label htmlFor="fhost">Card address</label>
            <select id="fhost" value={host} onChange={(e) => setHost(e.target.value)}>
              <option value="">Select a card…</option>
              {status?.cards.map((c) => (
                <option key={c.id} value={c.host}>
                  {c.id} — {c.label} ({c.host})
                </option>
              ))}
            </select>
          </div>
          <div className="field row">
            <input
              id="fsel"
              type="checkbox"
              checked={flashSelect}
              onChange={(e) => setFlashSelect(e.target.checked)}
            />
            <label htmlFor="fsel">Program the alternate flash bank</label>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="action primary"
              onClick={start}
              disabled={!inspection || !host || busy || status?.dryRun}
            >
              Start programming
            </button>
            <button className="action" onClick={() => api.cancelFlash()} disabled={!busy}>
              Cancel
            </button>
          </div>
          {status?.dryRun && (
            <p className="note" style={{ marginTop: 10 }}>
              Dry-run mode is active, so programming is disabled. Image inspection still works.
            </p>
          )}
        </div>
      </div>

      {live && live.phase !== 'idle' && (
        <div className="panel">
          <h2>Progress — {live.phase}</h2>
          <div className="body">
            <div className="progress">
              <div style={{ width: `${pct}%` }} />
            </div>
            <p className="note" style={{ marginTop: 10 }}>
              {live.recordsSent.toLocaleString()} / {live.recordsTotal.toLocaleString()} records ·{' '}
              {live.framesSent.toLocaleString()} frames · {live.bytesSent.toLocaleString()} bytes
            </p>
            {live.message && (
              <div className={live.phase === 'failed' ? 'error-box' : 'ok-box'}>{live.message}</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
