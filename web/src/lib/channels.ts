import type { ParamValues } from '../types';

/**
 * Whether a channel is configured differently from its panel.
 *
 * "Has a stored key" is the wrong test: toggling a flag on and then off again
 * leaves the field stored with the panel's own value, so the channel would keep
 * being marked as customised while being identical to every other channel.
 * Comparison is by value instead.
 */
const sameValue = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** The fields of `overrides` that actually differ from the panel values. */
export function effectiveOverrides(
  overrides: ParamValues | undefined,
  base: ParamValues,
): string[] {
  if (!overrides) return [];
  return Object.keys(overrides).filter((name) => !sameValue(overrides[name], base[name]));
}

export const differsFromPanel = (
  overrides: ParamValues | undefined,
  base: ParamValues,
): boolean => effectiveOverrides(overrides, base).length > 0;

/** Channel keys, in hardware order, whose settings differ from the panel. */
export function customisedChannels(
  channels: Record<string, ParamValues>,
  base: ParamValues,
): string[] {
  return Object.keys(channels)
    .filter((k) => differsFromPanel(channels[k], base))
    .sort((a, b) => {
      const [ca, cha] = a.split(':').map(Number);
      const [cb, chb] = b.split(':').map(Number);
      return ca - cb || cha - chb;
    });
}
