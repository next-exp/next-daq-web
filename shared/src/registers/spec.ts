import type { ParamSpec } from '../types.js';

/** Small builders so register definitions stay readable rather than repeating object literals. */

export const bool = (name: string, label: string, def = false, help?: string): ParamSpec => ({
  kind: 'bool',
  name,
  label,
  default: def,
  help,
});

export const int = (
  name: string,
  label: string,
  max: number,
  def = 0,
  opts: { min?: number; unit?: string; help?: string } = {},
): ParamSpec => ({
  kind: 'int',
  name,
  label,
  min: opts.min ?? 0,
  max,
  default: def,
  unit: opts.unit,
  help: opts.help,
});

/** Unsigned N-bit integer field. */
export const uint = (name: string, label: string, bits: number, def = 0, unit?: string): ParamSpec =>
  int(name, label, 2 ** bits - 1, def, { unit });

export const mask = (
  name: string,
  label: string,
  count: number,
  polarity: 'high' | 'low',
  itemLabel = 'CH',
  help?: string,
): ParamSpec => ({ kind: 'mask', name, label, count, polarity, itemLabel, help });

export const choice = (
  name: string,
  label: string,
  options: [number, string][],
  def?: number,
): ParamSpec => ({
  kind: 'enum',
  name,
  label,
  options: options.map(([value, l]) => ({ value, label: l })),
  default: def ?? options[0][0],
});

/**
 * A per-card channel selection. Rows are filled in from the configured topology
 * when the action catalogue is served, so a crate with more cards needs no code
 * change.
 */
export const grid = (
  name: string,
  label: string,
  plane: 'trg' | 'pmt' | 'bf' | 'sipm',
  cols: number,
  colLabel = 'CH',
  /** See `selects` on the grid spec: per-channel settings, or a card-level mask. */
  selects: 'settings' | 'mask' = 'settings',
  help?: string,
): ParamSpec => ({ kind: 'grid', name, label, plane, cols, colLabel, selects, help });

/** Tag a group of parameters with the section they belong to in the console. */
export const section = (name: string, specs: ParamSpec[]): ParamSpec[] =>
  specs.map((s) => ({ ...s, section: name }));

/** A single card of a plane, chosen from those configured. */
export const card = (
  name: string,
  label: string,
  plane: 'trg' | 'pmt' | 'bf' | 'sipm',
  help?: string,
): ParamSpec => ({ kind: 'card', name, label, plane, help });
