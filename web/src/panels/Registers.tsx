import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { Field, Words, defaultsFor } from '../components/Fields';
import { SectionList } from '../components/SectionList';
import type { ParamValues, RegisterInfo, Status } from '../types';

const GROUP_ORDER = ['GEN', 'TRG', 'PMT', 'BF', 'SIPM_DAQ', 'SIPM_FE', 'CMD'];

/**
 * Register browser and sender.
 *
 * Every panel is generated from the schema the server publishes, so the UI and
 * the encoder cannot drift apart the way the Swing forms and the command classes
 * did.
 */
export function Registers({ status }: { status?: Status }) {
  const [registers, setRegisters] = useState<RegisterInfo[]>([]);
  const [groups, setGroups] = useState<Record<string, string>>({});
  const [selectedId, setSelectedId] = useState<string>();
  const [values, setValues] = useState<ParamValues>({});
  const [host, setHost] = useState('');
  const [words, setWords] = useState<string[]>([]);
  const [error, setError] = useState<string>();
  const [sent, setSent] = useState<string>();

  useEffect(() => {
    api
      .registers()
      .then((r) => {
        setRegisters(r.registers);
        setGroups(r.groups);
        setSelectedId((id) => id ?? r.registers[0]?.id);
      })
      .catch((e) => setError(e.message));
  }, []);

  const selected = useMemo(
    () => registers.find((r) => r.id === selectedId),
    [registers, selectedId],
  );

  // Reset the form whenever a different register is chosen.
  useEffect(() => {
    if (selected) setValues(defaultsFor(selected.params));
    setSent(undefined);
    setError(undefined);
  }, [selected]);

  // Re-encode on every edit so the operator always sees what would be sent.
  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    api
      .encode(selected.id, values)
      .then((r) => !cancelled && (setWords(r.hexWords), setError(undefined)))
      .catch((e) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [selected, values]);

  const grouped = useMemo(() => {
    const out: Record<string, RegisterInfo[]> = {};
    for (const r of registers) (out[r.group] ??= []).push(r);
    return out;
  }, [registers]);

  const send = async () => {
    if (!selected) return;
    setError(undefined);
    setSent(undefined);
    try {
      const res = await api.send(selected.id, values, host || undefined);
      setSent(
        `${res.dryRun ? 'Dry run — not transmitted. ' : 'Sent to '}${res.targets.join(', ')}`,
      );
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="grid">
      <div className="panel">
        <h2>Registers ({registers.length})</h2>
        <div className="reg-list">
          <SectionList
            storageKey="next-daq.registers.collapsed"
            groups={GROUP_ORDER.filter((g) => grouped[g]).map((g) => ({
              id: g,
              title: groups[g] ?? g,
              items: grouped[g],
            }))}
            itemId={(r) => r.id}
            selectedId={selectedId}
            onSelect={(r) => setSelectedId(r.id)}
            renderItem={(r) => (
              <>
                <div className="id">{r.id}</div>
                <div className="title">{r.title}</div>
              </>
            )}
          />
        </div>
      </div>

      {selected && (
        <div style={{ display: 'grid', gap: 16 }}>
          <div className="panel">
            <h2>
              {selected.id} — {selected.title}
            </h2>
            <div className="body">
              {selected.notes && <p className="note">{selected.notes}</p>}
              <div className="stats" style={{ marginBottom: 14 }}>
                <div className="stat">
                  <div className="n">
                    {selected.regAddr !== undefined
                      ? `0x${selected.regAddr.toString(16).padStart(4, '0')}`
                      : selected.channelRange
                        ? `0x${selected.channelRange.base.toString(16)}+ch`
                        : '—'}
                  </div>
                  <div className="l">Register</div>
                </div>
                <div className="stat">
                  <div className="n">0x{selected.cmdCode.toString(16).padStart(2, '0')}</div>
                  <div className="l">Command</div>
                </div>
                <div className="stat">
                  <div className="n">{selected.target}</div>
                  <div className="l">Target</div>
                </div>
              </div>

              {selected.target === 'explicit' && (
                <div className="field">
                  <label htmlFor="host">Destination host</label>
                  <input
                    id="host"
                    type="text"
                    value={host}
                    placeholder="10.0.0.3"
                    onChange={(e) => setHost(e.target.value)}
                  />
                  <div className="help">This command is addressed to one card.</div>
                </div>
              )}

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
            <h2>Encoded packet</h2>
            <div className="body">
              {error && <div className="error-box">{error}</div>}
              {sent && <div className="ok-box">{sent}</div>}
              <Words words={words} hasReg={selected.regAddr !== undefined || !!selected.channelRange} />
              <p className="note" style={{ marginTop: 10 }}>
                Word 0 is the sequence counter, word 1 the header (word count and command
                code){selected.regAddr !== undefined || selected.channelRange
                  ? ', word 2 the register address'
                  : ''}
                .
              </p>
              <button
                className="action primary"
                onClick={send}
                disabled={!!error || (selected.target === 'explicit' && !host)}
              >
                {status?.dryRun ? 'Encode and log (dry run)' : 'Send to detector'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
