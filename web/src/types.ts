/** Mirrors the register metadata served by GET /api/registers. */

export type Group = 'GEN' | 'TRG' | 'PMT' | 'BF' | 'SIPM_DAQ' | 'SIPM_FE' | 'CMD';

export type ParamSpec =
  | { kind: 'bool'; name: string; label: string; default?: boolean; help?: string }
  | {
      kind: 'int';
      name: string;
      label: string;
      min: number;
      max: number;
      default?: number;
      unit?: string;
      help?: string;
    }
  | {
      kind: 'enum';
      name: string;
      label: string;
      options: { value: number; label: string }[];
      default?: number;
      help?: string;
    }
  | {
      kind: 'mask';
      name: string;
      label: string;
      count: number;
      polarity: 'high' | 'low';
      itemLabel?: string;
      help?: string;
    }
  | { kind: 'coefArray'; name: string; label: string; help?: string };

export interface RegisterInfo {
  id: string;
  group: Group;
  title: string;
  regAddr?: number;
  cmdCode: number;
  target: string;
  channelRange?: { param: string; base: number; count: number };
  notes?: string;
  params: ParamSpec[];
}

export interface CardStatus {
  id: string;
  label: string;
  plane: string;
  host: string;
  repliesReceived: number;
  lastSeen?: number;
  lastTrgEnable?: number;
}

export interface Status {
  state: {
    state: string;
    since: number;
    runNumber?: number;
    lastError?: string;
    history: { from: string; to: string; reason: string; at: number }[];
  };
  cards: CardStatus[];
  trigger: { failed: boolean; consecutiveInvalid: number; lastValue?: number };
  counters: {
    sent: number;
    received: number;
    rejectedUnknownSource: number;
    rejectedMalformed: Record<string, number>;
    sendErrors: number;
  };
  planes: Record<string, { total: number; responding: number }>;
  dryRun: boolean;
  registerCount: number;
  actionCount?: number;
}

export type ParamValue = number | boolean | boolean[] | number[];
export type ParamValues = Record<string, ParamValue>;

export interface FlashProgress {
  phase: string;
  recordsSent: number;
  recordsTotal: number;
  framesSent: number;
  bytesSent: number;
  message?: string;
}

/** Mirrors GET /api/actions — the operator panels. */
export interface ActionInfo {
  id: string;
  section: string;
  group: Group;
  title: string;
  description?: string;
  origin?: string;
  params: ParamSpec[];
}
