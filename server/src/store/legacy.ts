import type { Params } from '@next-daq/shared';
import type { ParsedConfig } from './config.js';

/**
 * Import configuration files written by the DATE-era control application.
 *
 * Those files key each setting by a human-readable description —
 * `GEN:Buffer Size 1:350`, `TRG:TRG 1 Events for Trg A:4` — rather than by panel
 * and parameter. The values are already in the units the panels use (microseconds,
 * hertz, time bins, counts), so importing is mostly a translation of keys.
 *
 * Anything not recognised is reported rather than dropped, so a file is never
 * silently half-imported.
 */

type Convert = (raw: string) => number | boolean;

const asInt: Convert = (raw) => Math.trunc(Number(raw)) || 0;
const asBool: Convert = (raw) => raw.trim() === '1' || raw.trim().toLowerCase() === 'true';
/** Throughput is written in bytes per second; the panel is in MBytes/s. */
const asMBytes: Convert = (raw) => Math.round(Number(raw) / 1_000_000) || 0;

interface Rule {
  match: RegExp;
  action: string;
  /** Parameter name, or a function of the regex captures. */
  param: string | ((m: RegExpMatchArray) => string);
  convert: Convert;
  /** For per-channel settings: the "cardIndex:channel" key this belongs to. */
  channel?: (m: RegExpMatchArray) => string;
  /** For channel selections: the index to set in a boolean mask or grid. */
  bit?: (m: RegExpMatchArray) => number;
  /** Width of that mask, so it can be created at the right size. */
  bitCount?: number;
}

const RULES: Rule[] = [
  /* ------------------------------------------------------------ general run */
  { match: /^GEN:Mode of Operation$/, action: 'run.general', param: 'mode', convert: asInt },
  { match: /^GEN:RUN Code$/, action: 'run.general', param: 'run_code', convert: asInt },
  { match: /^GEN:Number of Triggers$/, action: 'run.general', param: 'num_triggers', convert: asInt },
  { match: /^GEN:Buffer Size 1$/, action: 'run.general', param: 'buffer_us', convert: asInt },
  { match: /^GEN:Buffer Size 2$/, action: 'run.general', param: 'buffer2_us', convert: asInt },
  { match: /^GEN:Pretrigger 1$/, action: 'run.general', param: 'pretrigger_us', convert: asInt },
  { match: /^GEN:Pretrigger 2$/, action: 'run.general', param: 'pretrigger2_us', convert: asInt },
  { match: /^GEN:Dual Mode RAW\/ZS$/, action: 'run.general', param: 'dual_mode', convert: asBool },
  { match: /^GEN:Ramp Test$/, action: 'run.general', param: 'testmem_pmt', convert: asBool },

  /* --------------------------------------------------------------- trigger */
  { match: /^TRG:External Trigger ON\/OFF$/, action: 'trigger.config', param: 'exttrg_on', convert: asBool },
  { match: /^TRG:Auto External Trigger ON\/OFF$/, action: 'trigger.config', param: 'autoexttrg_on', convert: asBool },
  { match: /^TRG:Trigger Mask ON\/OFF$/, action: 'trigger.config', param: 'mask_on', convert: asBool },
  { match: /^TRG:Trigger freq$/, action: 'trigger.config', param: 'frequency_hz', convert: asInt },
  { match: /^TRG:TRG ([12]) CW size Trg A$/, action: 'trigger.config', param: (m) => `cw_a${m[1]}`, convert: asInt },
  { match: /^TRG:TRG ([12]) CW size Trg B$/, action: 'trigger.config', param: (m) => `cw_b${m[1]}`, convert: asInt },
  { match: /^TRG:TRG ([12]) Events for Trg A$/, action: 'trigger.config', param: (m) => `nch_a${m[1]}`, convert: asInt },
  { match: /^TRG:TRG ([12]) Events for Trg B$/, action: 'trigger.config', param: (m) => `nch_b${m[1]}`, convert: asInt },
  { match: /^TRG:TRG ([12]) Max Time Trg A and B$/, action: 'trigger.config', param: (m) => `tdif${m[1]}_ns`, convert: asInt },
  { match: /^TRG:TRG [12] Double Trigger ON\/OFF$/, action: 'trigger.config', param: 'double_trigger', convert: asBool },
  { match: /^TRG:Trigger ([12]) Lost Mask ON\/OFF$/, action: 'trigger.config', param: (m) => `masktrg${m[1]}lost_on`, convert: asBool },
  { match: /^TRG:Trigger 1\/2 Lost Mask ON\/OFF$/, action: 'trigger.config', param: 'masktrg1_2lost_on', convert: asBool },

  /* ------------------------------------------------------------- SiPM front-end */
  { match: /^FE general:ZS Threshold$/, action: 'sipm.frontEnd', param: 'thrs', convert: asInt },
  { match: /^FE general:Filt-samples$/, action: 'sipm.frontEnd', param: 'filts', convert: asInt },
  { match: /^FE general:Pre-samples$/, action: 'sipm.frontEnd', param: 'pres', convert: asInt },
  { match: /^FE general:Post-samples$/, action: 'sipm.frontEnd', param: 'posts', convert: asInt },
  { match: /^FE general:Sample-delay$/, action: 'sipm.frontEnd', param: 'delay_us', convert: asInt },
  { match: /^FE general:ZS TRG ([12]) ON\/OFF$/, action: 'sipm.frontEnd', param: (m) => `zstrg${m[1]}_on`, convert: asBool },
  { match: /^FE general:Compr ON\/OFF$/, action: 'sipm.compression', param: 'compr_on', convert: asBool },

  /* ------------------------------------------------------------------- BLR */
  { match: /^PMT FEC ALL PMTs BLR:BLR ON\/OFF$/, action: 'pmt.blr', param: 'on', convert: asBool },
  { match: /^PMT FEC ALL PMTs BLR:BLR Reset$/, action: 'pmt.blr', param: 'rst', convert: asBool },
  { match: /^PMT FEC ALL PMTs BLR:BLR DM$/, action: 'pmt.blr', param: 'dm', convert: asBool },
  { match: /^PMT FEC ALL PMTs BLR:BLR TRGM$/, action: 'pmt.blr', param: 'trgm', convert: asBool },
  { match: /^PMT FEC ALL PMTs BLR:BLR HPF$/, action: 'pmt.blr', param: 'hpf', convert: asBool },
  { match: /^PMT FEC ALL PMTs BLR:BLR DWI$/, action: 'pmt.blr', param: 'dwi', convert: asBool },
  { match: /^PMT FEC ALL PMTs BLR:MAU size$/, action: 'pmt.blr', param: 'mau_size', convert: asInt },
  { match: /^PMT FEC ALL PMTs BLR:MAU threshold$/, action: 'pmt.blr', param: 'mau_thr', convert: asInt },
  { match: /^PMT FEC ALL PMTs BLR:BLR Acum thr H$/, action: 'pmt.blr', param: 'blr_thrh', convert: asInt },
  { match: /^PMT FEC ALL PMTs BLR:BLR Acum thr L$/, action: 'pmt.blr', param: 'blr_thrl', convert: asInt },
  { match: /^PMT FEC ALL PMTs BLR:BLR Time to Abort$/, action: 'pmt.blr', param: 'timetoabort_us', convert: asInt },
  { match: /^PMT FEC ALL PMTs BLR:BLR discharge coefficient$/, action: 'pmt.blr', param: 'blr_dischcoefL', convert: asInt },
  { match: /^PMT FEC ALL PMTs BLR:BLR discharge line$/, action: 'pmt.blr', param: 'line_index', convert: asInt },
  { match: /^PMT FEC ALL PMTs BLR:BLR discharge slope$/, action: 'pmt.blr', param: 'lineslope_index', convert: asInt },
  { match: /^PMT FEC ALL PMTs BLR:BLR SAT CH thr H$/, action: 'pmt.blrSaturation', param: 'thrH', convert: asInt },
  { match: /^PMT FEC ALL PMTs BLR:BLR SAT CH thr L$/, action: 'pmt.blrSaturation', param: 'thrL', convert: asInt },
  { match: /^PMT FEC ALL PMTs BLR:BLR SAT Time to Abort$/, action: 'pmt.blrSaturation', param: 'timetoabort_us', convert: asInt },

  /* ------------------------------------------------------------ throughput */
  { match: /^GEN:Throughput Limit PMT \d+$/, action: 'fec.throughput', param: 'throughput_mbs', convert: asMBytes },
  { match: /^GEN:Throughput Limit ON PMT \d+$/, action: 'fec.throughput', param: 'pmt_on', convert: asBool },
  { match: /^GEN:Throughput Limit ON BF \d+$/, action: 'fec.throughput', param: 'bf_on', convert: asBool },
  { match: /^GEN:Throughput Limit ON TRG2$/, action: 'fec.throughput', param: 'trg2nowait', convert: asBool },

  /* ------------------------------------- per-channel trigger participation */
  // "PMT FEC 1 PMTs TRG A:CH 3  PMT  3 selected TRG 1" -> channel 0:3, on1
  {
    match: /^PMT FEC (\d+) PMTs TRG [AB]:CH\s*(\d+)\s+PMT\s+\S+\s+selected TRG ([12])$/,
    action: 'pmt.channelTrigger',
    param: (m) => `on${m[3]}`,
    convert: asBool,
    channel: (m) => `${Number(m[1]) - 1}:${m[2]}`,
  },
  {
    match: /^BF FEC (\d+) BFs TRG [AB]:CH\s*(\d+)\s+BF\s+\S+\s+selected TRG ([12])$/,
    action: 'bf.channelTrigger',
    param: (m) => `on${m[3]}`,
    convert: asBool,
    channel: (m) => `${Number(m[1]) - 1}:${m[2]}`,
  },

  /* --------------------------------- per-FEC trigger thresholds (all channels) */
  ...(
    [
      ['Baseline dev\\.', ['athr1', 'athr3']],
      ['Max Amplitude', ['athr2', 'athr4']],
      ['Min Time Thr', ['tthr1_ns', 'tthr3_ns']],
      ['Max Time Thr', ['tthr2_ns', 'tthr4_ns']],
      ['Q min', ['qthr1', 'qthr4']],
      ['Q max', ['qthr2', 'qthr5']],
      ['Pulse Valid Ext\\.', ['maskthr1', 'maskthr2']],
    ] as [string, [string, string]][]
  ).flatMap(([label, [p1, p2]]) =>
    (['PMT', 'BF'] as const).map((plane) => ({
      match: new RegExp(`^${plane} FECs? \\d+ ${plane}s TRG [AB]:${label} ([12])$`),
      action: plane === 'PMT' ? 'pmt.channelTrigger' : 'bf.channelTrigger',
      param: (m: RegExpMatchArray) => (m[1] === '1' ? p1 : p2),
      convert: asInt,
    })),
  ),

  /* ---------------------------------------------- per-FEC trigger switches */
  {
    match: /^PMT FEC \d+ PMTs TRG [AB]:Trigger ([12]) ON\/OFF$/,
    action: 'pmt.channelTrigger',
    param: (m) => `on${m[1]}`,
    convert: asBool,
  },
  {
    match: /^BF FEC \d+ BFs TRG [AB]:Trigger ([12]) ON\/OFF$/,
    action: 'bf.channelTrigger',
    param: (m) => `on${m[1]}`,
    convert: asBool,
  },
  { match: /^BF FEC \d+ BFs TRG A:Inv Polarity$/, action: 'bf.channelTrigger', param: 'pol', convert: asBool },
  { match: /^BF FEC \d+ BFs TRG A:TRGA\/B$/, action: 'bf.channelTrigger', param: 'chtrg_type', convert: asBool },
  { match: /^BF FEC \d+ TRG:MAU RST$/, action: 'bf.baseline', param: 'mau_rst', convert: asBool },

  /* --------------------------------------------- per-channel BLR selection */
  // "PMT FEC 1 PMTs BLR:CH 3  PMT  3 selected BLR" -> the BLR panel's channel grid.
  {
    match: /^PMT FEC (\d+) PMTs BLR:CH\s*(\d+)\s+PMT\s+\S+\s+selected BLR$/,
    action: 'pmt.blr',
    param: 'channels',
    convert: asBool,
    bit: (m) => (Number(m[1]) - 1) * 12 + Number(m[2]),
    bitCount: 12,
  },
  // Per-channel BLR coefficients.
  {
    match: /^PMT FEC (\d+) PMTs BLR:CH\s*(\d+)\s+PMT\s+\S+\s+BLR coefficient$/,
    action: 'pmt.blr',
    param: 'blr_coefL',
    convert: asInt,
    channel: (m) => `${Number(m[1]) - 1}:${m[2]}`,
  },
  {
    match: /^PMT FEC (\d+) PMTs BLR:CH\s*(\d+)\s+PMT\s+\S+\s+BLR HPF A1$/,
    action: 'pmt.blr',
    param: 'hpf_A1L',
    convert: asInt,
    channel: (m) => `${Number(m[1]) - 1}:${m[2]}`,
  },
  {
    match: /^PMT FEC (\d+) PMTs BLR:CH\s*(\d+)\s+PMT\s+\S+\s+BLR HPF G$/,
    action: 'pmt.blr',
    param: 'hpf_GL',
    convert: asInt,
    channel: (m) => `${Number(m[1]) - 1}:${m[2]}`,
  },

  /* ------------------------------------------------------ cards connected */
  // Written as "disconnected", so the sense is inverted for a connected mask.
  {
    match: /^TRG:PMT FEC (\d+) disconnected$/,
    action: 'fec.connected',
    param: 'pmt_cards',
    convert: (raw) => !asBool(raw),
    bit: (m) => Number(m[1]) - 1,
    bitCount: 16,
  },
  {
    match: /^TRG:BF FEC (\d+) disconnected$/,
    action: 'fec.connected',
    param: 'bf_cards',
    convert: (raw) => !asBool(raw),
    bit: (m) => Number(m[1]) - 1,
    bitCount: 24,
  },
  {
    match: /^TRG:SiPM FEC (\d+) disconnected$/,
    action: 'fec.connected',
    param: 'sipm_cards',
    convert: (raw) => !asBool(raw),
    bit: (m) => Number(m[1]) - 1,
    bitCount: 16,
  },

  /* ------------------------------------------------- remaining throughput */
  { match: /^GEN:Throughput Limit (?:BF|SiPM|FB) \d+$/, action: 'fec.throughput', param: 'throughput_mbs', convert: asMBytes },
  { match: /^GEN:Throughput Limit ON SiPM \d+$/, action: 'fec.throughput', param: 'bf_on', convert: asBool },

  /* ------------------------------------------------------ data compression */
  { match: /^PMT FEC ALL:Trg([12]) Data Comp$/, action: 'pmt.dataCompression', param: (m) => `trg${m[1]}on`, convert: asBool },

  /* ------------------------------------------------------------- BF MAU size */
  { match: /^BF FECs TRG:MAU Size$/, action: 'bf.baseline', param: 'mau_sz', convert: asInt },

  /* ------------------------------------------------ channel-connected masks */
  // The trigger-sum panel configures one FEC at a time, so only the first card's
  // mask can be imported into it; the rest are reported.
  {
    match: /^BF FEC 1:CH\s*(\d+)\s+BF\s+\S+\s+connected$/,
    action: 'bf.triggerSum',
    param: 'channels',
    convert: asBool,
    bit: (m) => Number(m[1]),
    bitCount: 12,
  },
  {
    match: /^PMT FEC \d+:CH\s*(\d+)\s+PMT\s+\S+\s+connected$/,
    action: 'pmt.dataChannels',
    param: 'channels',
    convert: asBool,
    bit: (m) => Number(m[1]),
    bitCount: 12,
  },
  // The high-gain trigger selector picks which BF channels feed the trigger.
  {
    match: /^BF FEC \d+ TRG HG:CH(\d+) connected:?$/,
    action: 'bf.triggerSelect',
    param: 'trgsel',
    convert: asBool,
    bit: (m) => Number(m[1]),
    bitCount: 12,
  },
  {
    match: /^BF FEC \d+ BFs TRG A:Trigger ([12]) FT on fall$/,
    action: 'bf.channelTrigger',
    param: (m) => `rf${m[1]}`,
    convert: asBool,
  },
];

export interface LegacyImport {
  /** Panel values, keyed by action id. */
  settings: Record<string, Params>;
  /** Per-channel values, keyed by action id then "cardIndex:channel". */
  channels: Record<string, Record<string, Params>>;
  imported: number;
  /**
   * Settings that matched no rule, grouped by shape with an example, so a long
   * file does not produce hundreds of near-identical lines.
   */
  unrecognised: { shape: string; count: number; example: string }[];
}

/**
 * Translate a parsed legacy configuration into panel and per-channel values.
 *
 * Keys that are purely informational in the original — the "Config …" markers it
 * wrote to record that a panel had been applied — are skipped rather than
 * reported, since they carry no setting.
 */
export function importLegacyConfig(parsed: ParsedConfig): LegacyImport {
  const settings: Record<string, Params> = {};
  const channels: Record<string, Record<string, Params>> = {};
  const unmapped = new Map<string, { count: number; example: string }>();
  let imported = 0;

  for (const [key, value] of parsed.entries) {
    // "Config X" entries record that a panel was applied, not what it holds.
    if (/:Config\b/.test(key) || /^\s*$/.test(key)) continue;

    let matched = false;
    for (const rule of RULES) {
      const m = key.match(rule.match);
      if (!m) continue;

      const param = typeof rule.param === 'function' ? rule.param(m) : rule.param;
      const converted = rule.convert(value);

      if (rule.bit) {
        const bag = (settings[rule.action] ??= {});
        const width = rule.bitCount ?? 12;
        const index = rule.bit(m);
        const bits = Array.isArray(bag[param]) ? (bag[param] as boolean[]).slice() : [];
        while (bits.length <= Math.max(index, width - 1)) bits.push(false);
        bits[index] = Boolean(converted);
        bag[param] = bits;
      } else if (rule.channel) {
        const ch = rule.channel(m);
        ((channels[rule.action] ??= {})[ch] ??= {})[param] = converted;
      } else {
        (settings[rule.action] ??= {})[param] = converted;
      }
      imported++;
      matched = true;
      break;
    }
    if (!matched) {
      const shape = key.replace(/\b\d+\b/g, 'N');
      const seen = unmapped.get(shape);
      if (seen) seen.count++;
      else unmapped.set(shape, { count: 1, example: `${key}:${value}` });
    }
  }

  const unrecognised = [...unmapped.entries()]
    .map(([shape, v]) => ({ shape, ...v }))
    .sort((a, b) => b.count - a.count);

  return { settings, channels, imported, unrecognised };
}

/** True when a file looks like a legacy configuration rather than one of ours. */
export function looksLegacy(parsed: ParsedConfig): boolean {
  let ours = 0;
  let legacy = 0;
  for (const key of parsed.entries.keys()) {
    // Ours are "<panel id>:<parameter>", e.g. "run.general:buffer_us".
    if (/^[a-z]+\.[A-Za-z]+:[A-Za-z_0-9]+$/.test(key)) ours++;
    else legacy++;
  }
  return legacy > ours;
}
