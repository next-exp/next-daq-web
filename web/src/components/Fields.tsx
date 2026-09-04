import type { ParamSpec, ParamValue, ParamValues } from '../types';

/**
 * Form controls generated from the register schema.
 *
 * The Swing UI hand-placed a labelled widget per parameter — which is most of why
 * `NewJFrame.java` runs to 16,501 lines. Here one control per parameter kind
 * covers every register, so adding a register adds no UI code.
 */

export function defaultsFor(params: ParamSpec[]): ParamValues {
  const out: ParamValues = {};
  for (const p of params) {
    if (p.kind === 'mask') out[p.name] = new Array(p.count).fill(false);
    else if (p.kind === 'coefArray') out[p.name] = [0, 0];
    else if (p.kind === 'bool') out[p.name] = p.default ?? false;
    else out[p.name] = p.default ?? 0;
  }
  return out;
}

interface FieldProps {
  spec: ParamSpec;
  value: ParamValue;
  onChange: (v: ParamValue) => void;
}

export function Field({ spec, value, onChange }: FieldProps) {
  if (spec.kind === 'bool') {
    return (
      <div className="field row">
        <input
          id={spec.name}
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
        />
        <label htmlFor={spec.name}>{spec.label}</label>
        {spec.help && <div className="help">{spec.help}</div>}
      </div>
    );
  }

  if (spec.kind === 'enum') {
    return (
      <div className="field">
        <label htmlFor={spec.name}>{spec.label}</label>
        <select
          id={spec.name}
          value={String(value)}
          onChange={(e) => onChange(Number(e.target.value))}
        >
          {spec.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {spec.help && <div className="help">{spec.help}</div>}
      </div>
    );
  }

  if (spec.kind === 'int') {
    const n = Number(value);
    const outOfRange = n < spec.min || n > spec.max;
    return (
      <div className="field">
        <label htmlFor={spec.name}>
          {spec.label}
          {spec.unit ? ` (${spec.unit})` : ''}
        </label>
        <input
          id={spec.name}
          type="number"
          value={Number.isFinite(n) ? n : 0}
          min={spec.min}
          max={spec.max}
          onChange={(e) => onChange(Number(e.target.value))}
          style={outOfRange ? { borderColor: 'var(--err)' } : undefined}
        />
        <div className="help">
          {spec.min}–{spec.max}
          {outOfRange && <strong style={{ color: 'var(--err)' }}> — out of range</strong>}
          {spec.help ? ` · ${spec.help}` : ''}
        </div>
      </div>
    );
  }

  if (spec.kind === 'coefArray') {
    const arr = (Array.isArray(value) ? value : [0, 0]) as number[];
    return (
      <div className="field">
        <label>{spec.label} — low / high word</label>
        <div style={{ display: 'flex', gap: 8 }}>
          {[0, 1].map((i) => (
            <input
              key={i}
              type="number"
              min={0}
              max={0xffff}
              value={arr[i] ?? 0}
              onChange={(e) => {
                const next = [...arr];
                next[i] = Number(e.target.value);
                onChange(next);
              }}
            />
          ))}
        </div>
        <div className="help">The high word is transmitted first.</div>
      </div>
    );
  }

  // mask
  const bits = (Array.isArray(value) ? value : []) as boolean[];
  const set = (all: boolean) => onChange(new Array(spec.count).fill(all));
  const toggle = (i: number) => {
    const next = [...bits];
    next[i] = !next[i];
    onChange(next);
  };

  return (
    <div className="field">
      <label>
        {spec.label} — {spec.polarity === 'low' ? 'active-low on the wire' : 'active-high on the wire'}
      </label>
      <div className="mask-actions">
        <button type="button" className="action" onClick={() => set(true)}>
          All
        </button>
        <button type="button" className="action" onClick={() => set(false)}>
          None
        </button>
      </div>
      <div className="mask">
        {Array.from({ length: spec.count }, (_, i) => (
          <button
            key={i}
            type="button"
            aria-pressed={Boolean(bits[i])}
            onClick={() => toggle(i)}
            title={`${spec.itemLabel ?? 'CH'} ${i}`}
          >
            {i}
          </button>
        ))}
      </div>
      {spec.help && <div className="help">{spec.help}</div>}
    </div>
  );
}

/** Renders the encoded words, highlighting the header and register-address words. */
export function Words({ words, hasReg }: { words: string[]; hasReg: boolean }) {
  return (
    <div className="words">
      {words.map((w, i) => (
        <span key={i} className={`w${i === 1 ? ' hdr' : hasReg && i === 2 ? ' reg' : ''}`}>
          {w}
        </span>
      ))}
    </div>
  );
}
