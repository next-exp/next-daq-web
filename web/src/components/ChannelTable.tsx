import { customisedChannels } from '../lib/channels';
import type { ActionInfo, ParamValues } from '../types';

/**
 * Per-channel state for a grid panel.
 *
 * A single marker on the grid could only ever reflect one field, which is
 * arbitrary when a channel carries twenty parameters. This shows every channel
 * that has its own settings, one row each, with a column per parameter — the
 * information the Swing UI conveyed by giving each channel its own row of
 * spinners, without needing twenty rows on screen at once.
 *
 * Values that differ from the panel default are highlighted, so a channel
 * configured differently from its neighbours stands out.
 */
interface Props {
  action: ActionInfo;
  /** Per-channel overrides, keyed "cardIndex:channel". */
  channels: Record<string, ParamValues>;
  /** Panel-level values, used as the fallback and the comparison baseline. */
  base: ParamValues;
  rows: { id: string; label: string }[];
  cols: number;
  selectedKeys: string[];
  onSelect: (keys: string[]) => void;
}

const format = (v: unknown): string => {
  if (typeof v === 'boolean') return v ? 'on' : 'off';
  if (Array.isArray(v)) return v.join(',');
  return String(v ?? '');
};

export function ChannelTable({
  action,
  channels,
  base,
  rows,
  cols,
  selectedKeys,
  onSelect,
}: Props) {
  const fields = action.params.filter((p) => p.kind !== 'grid');
  // Only channels that actually differ from the panel; a field set back to the
  // panel's own value is not a customisation.
  const keys = customisedChannels(channels, base);

  if (keys.length === 0) {
    return (
      <p className="note">
        No channel has its own settings yet. Select channels above and edit the fields to give
        them one; every channel not listed here uses the panel values.
      </p>
    );
  }

  return (
    <div className="table-scroll">
      <table className="data channel-table">
        <thead>
          <tr>
            <th>Channel</th>
            {fields.map((f) => (
              <th key={f.name} title={f.label}>
                {f.label.replace(/^Trigger (\d) — /, 'T$1 ')}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {keys.map((key) => {
            const [card, ch] = key.split(':').map(Number);
            const row = rows[card];
            const selected = selectedKeys.includes(key);
            return (
              <tr
                key={key}
                className={selected ? 'sel' : undefined}
                onClick={() => onSelect([key])}
                title="Click to select just this channel"
              >
                <td className="mono">
                  {row?.id ?? `Card ${card + 1}`} · {ch}
                </td>
                {fields.map((f) => {
                  const own = channels[key]?.[f.name];
                  const value = own ?? base[f.name];
                  // Highlight only a value that actually differs from the panel.
                  const differs = own !== undefined && format(own) !== format(base[f.name]);
                  return (
                    <td key={f.name} className={`mono${differs ? ' differs' : ''}`}>
                      {format(value)}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="note" style={{ marginTop: 8 }}>
        {keys.length} channel{keys.length === 1 ? '' : 's'} with their own settings, out of{' '}
        {rows.length * cols}. Highlighted cells differ from the panel value. Click a row to select
        that channel.
      </p>
    </div>
  );
}
