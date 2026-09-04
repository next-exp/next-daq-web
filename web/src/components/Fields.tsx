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
    if (p.kind === 'card') out[p.name] = 0;
    else if (p.kind === 'grid') out[p.name] = new Array((p.rows?.length ?? 0) * p.cols).fill(false);
    else if (p.kind === 'mask') out[p.name] = new Array(p.count).fill(false);
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
  /**
   * The value last sent to the cards, when it differs from the edited value.
   * Grid cells use it to show which channels are actually enabled.
   */
  applied?: ParamValue;
  /**
   * True when the selected channels do not agree on this field. The control shows
   * "Mixed" rather than one channel's value standing in for all of them.
   */
  mixed?: boolean;
}

export function Field({ spec, value, onChange, applied, mixed }: FieldProps) {
  if (spec.kind === 'bool') {
    const on = Boolean(value);
    return (
      <div className="field">
        <div className="toggle-row">
          <button
            type="button"
            role="switch"
            aria-checked={on}
            className={`toggle${on ? ' on' : ''}`}
            onClick={() => onChange(!on)}
          >
            <span className="knob" />
          </button>
          <span className="toggle-label">{spec.label}</span>
          <span className={`toggle-state${mixed ? ' mixed' : on ? ' on' : ''}`}>
            {mixed ? 'MIXED' : on ? 'ON' : 'OFF'}
          </span>
        </div>
        {spec.help && <div className="help">{spec.help}</div>}
      </div>
    );
  }

  if (spec.kind === 'card') {
    const options = spec.options ?? [];
    if (options.length === 0) {
      return (
        <div className="field">
          <label>{spec.label}</label>
          <div className="help">No cards of this plane are configured.</div>
        </div>
      );
    }
    return (
      <div className="field">
        <label htmlFor={spec.name}>{spec.label}</label>
        <select
          id={spec.name}
          value={String(Number(value) || 0)}
          onChange={(e) => onChange(Number(e.target.value))}
        >
          {options.map((o) => (
            <option key={o.index} value={o.index}>
              {o.id} — {o.label}
            </option>
          ))}
        </select>
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
          value={mixed ? '' : Number.isFinite(n) ? n : 0}
          placeholder={mixed ? 'Mixed across the selected channels' : undefined}
          min={spec.min}
          max={spec.max}
          onChange={(e) => onChange(Number(e.target.value))}
          style={outOfRange && !mixed ? { borderColor: 'var(--err)' } : undefined}
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

  if (spec.kind === 'grid') {
    const rows = spec.rows ?? [];
    const size = rows.length * spec.cols;
    const bits = (Array.isArray(value) ? value : []) as boolean[];
    const live = (Array.isArray(applied) ? applied : []) as boolean[];
    const at = (r: number, c: number) => Boolean(bits[r * spec.cols + c]);
    const isLive = (r: number, c: number) => Boolean(live[r * spec.cols + c]);

    const write = (next: boolean[]) => onChange(next);
    const resized = () => {
      const out = new Array(size).fill(false);
      for (let i = 0; i < Math.min(size, bits.length); i++) out[i] = bits[i];
      return out;
    };
    const toggle = (r: number, c: number) => {
      const next = resized();
      next[r * spec.cols + c] = !at(r, c);
      write(next);
    };
    const setRow = (r: number, on: boolean) => {
      const next = resized();
      for (let c = 0; c < spec.cols; c++) next[r * spec.cols + c] = on;
      write(next);
    };

    if (rows.length === 0) {
      return (
        <div className="field">
          <label>{spec.label}</label>
          <div className="help">No cards of this plane are configured.</div>
        </div>
      );
    }

    return (
      <div className="field">
        <label>
          {spec.label} — {rows.length} card{rows.length === 1 ? '' : 's'} × {spec.cols} channels
        </label>
        <div className="mask-actions">
          <button type="button" className="action" onClick={() => write(new Array(size).fill(true))}>
            All
          </button>
          <button type="button" className="action" onClick={() => write(new Array(size).fill(false))}>
            None
          </button>
        </div>
        {live.length > 0 && (
          <div className="help" style={{ marginBottom: 6 }}>
            A dot marks a channel that has settings of its own; the table below shows them.
          </div>
        )}
        <div className="chgrid">
          {rows.map((row, r) => (
            <div className="chgrid-row" key={row.id}>
              <button
                type="button"
                className="chgrid-label"
                title={`Toggle all of ${row.label}`}
                onClick={() =>
                  setRow(r, !Array.from({ length: spec.cols }, (_, c) => at(r, c)).every(Boolean))
                }
              >
                {row.id}
              </button>
              {Array.from({ length: spec.cols }, (_, c) => (
                <button
                  key={c}
                  type="button"
                  aria-pressed={at(r, c)}
                  className={isLive(r, c) ? 'live' : undefined}
                  onClick={() => toggle(r, c)}
                  title={
                    `${row.label} — ${spec.colLabel ?? 'CH'} ${c}` +
                    (isLive(r, c) ? ' · has its own settings' : '')
                  }
                >
                  {c}
                </button>
              ))}
            </div>
          ))}
        </div>
        {spec.help && <div className="help">{spec.help}</div>}
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
