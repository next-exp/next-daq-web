import type { Words } from './words.js';

/** Which subsystem a register belongs to. Mirrors the tabs of the original Swing UI. */
export type Group = 'GEN' | 'TRG' | 'PMT' | 'BF' | 'SIPM_DAQ' | 'SIPM_FE' | 'CMD';

/** Destination class for a command, resolved to concrete IPs at send time. */
export type Target =
  | 'trg'
  | 'pmt'
  | 'bf'
  | 'sipm'
  | 'fe'
  | 'broadcast'
  | 'explicit'
  /**
   * Addressed to one SiPM front-end board by its number. The original derived the
   * destination from the board number rather than from any configured card list:
   * `SiPMFEConfReg5` computed `"10.0." + (fenum + 128) + ".1"`.
   */
  | 'feBoard';

export type ParamSpec =
  | { name: string; label: string; kind: 'bool'; default?: boolean; help?: string }
  | {
      name: string;
      label: string;
      kind: 'int';
      min: number;
      max: number;
      default?: number;
      unit?: string;
      help?: string;
    }
  | {
      name: string;
      label: string;
      kind: 'enum';
      options: { value: number; label: string }[];
      default?: number;
      help?: string;
    }
  | {
      name: string;
      label: string;
      kind: 'mask';
      count: number;
      /** See `channelMask` — polarity is per-register and deliberately not normalised. */
      polarity: 'high' | 'low';
      itemLabel?: string;
      help?: string;
    }
  | { name: string; label: string; kind: 'coefArray'; help?: string };

export type Params = Record<string, number | boolean | boolean[] | number[]>;

export interface RegisterDef {
  /** Stable id, matching the original Java class name so the two can be cross-referenced. */
  id: string;
  group: Group;
  title: string;
  /** Register address (word 2). Omitted for registers addressed per-channel. */
  regAddr?: number;
  /** Command code in the low byte of word 1. 0x02 = config write. */
  cmdCode: number;
  target: Target;
  /**
   * UDP port override; defaults to the port used for card traffic.
   * The front-end boards listen on two: 'fe' (6038) for most registers and
   * 'feCmd' (6039) for the sensor-mask and LED registers.
   */
  port?: 'java' | 'fec' | 'fe' | 'feCmd';
  /** For `target: 'feBoard'`, the parameter holding the board number. */
  boardParam?: string;
  /** Channel-addressed registers derive regAddr from a channel number. */
  channelRange?: { param: string; base: number; count: number };
  params: ParamSpec[];
  /** Builds the payload words that follow the 3-word header. */
  payload: (p: Readonly<ParamAccess>, w: Words) => void;
  notes?: string;
}

/** Typed accessor passed to `payload`, so encoders read params without casting everywhere. */
export interface ParamAccess {
  int(name: string): number;
  bool(name: string): boolean;
  mask(name: string): boolean[];
  arr(name: string): number[];
}
