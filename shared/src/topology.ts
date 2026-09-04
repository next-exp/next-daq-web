/**
 * Detector topology and deployment settings.
 *
 * The originals hard-coded card IPs, UDP ports, `/home/next/*.sh` scripts, log
 * paths and a slow-control destination directly in source (and read several of
 * them out of Swing text fields at class-initialisation time, which made
 * `Global`'s static initialiser depend on GUI construction order). All of it is
 * configuration here, validated on load.
 */

export interface CardEndpoint {
  /** Stable identifier used in logs, status and the UI, e.g. "BF2". */
  id: string;
  label: string;
  host: string;
  plane: 'trg' | 'pmt' | 'bf' | 'sipm' | 'fe';
}

export interface Ports {
  /** Port the application binds for replies, and the destination for card traffic. */
  java: number;
  fec: number;
  /** Front-end board port used by most SiPM FE registers. */
  fe: number;
  /** Second front-end port, used by the sensor-mask and LED registers. */
  feCmd: number;
}

/**
 * How a SiPM front-end board number maps to an address.
 *
 * The original hard-coded `"10.0." + (fenum + 128) + ".1"` inside the LED register
 * class. It is configuration here so a different crate layout does not require a
 * code change.
 */
export interface FeBoardAddressing {
  /** Template with `{}` standing in for the computed octet. */
  template: string;
  /** Added to the board number before substitution. */
  offset: number;
  /** Highest valid board number, inclusive. */
  maxBoard: number;
}

export interface Topology {
  ports: Ports;
  /** Broadcast address for commands addressed to every card. */
  broadcastAddress: string;
  cards: CardEndpoint[];
  feBoards: FeBoardAddressing;
  counts: {
    fecPmt: number;
    fecBf: number;
    fecSipm: number;
    feb: number;
  };
  slowControl?: { host: string; port: number };
  /**
   * External commands the console may run at run boundaries.
   *
   * The original shelled out to fixed paths — `/home/next/scripts/stopDate.sh`
   * behind the "AutoStop DUCK" checkbox, and `elog_client.sh start` on run start.
   * They are configuration here, and only what appears in this file can ever run:
   * nothing from a request reaches a command line.
   *
   * Each entry is the program followed by its arguments, so there is no shell to
   * interpret quoting or substitution.
   */
  hooks?: {
    /** Run after acquisition starts. */
    onRunStart?: string[];
    /** Run after acquisition stops, when the operator leaves auto-stop enabled. */
    onRunStop?: string[];
  };
  paths: {
    /** Directory for run logs and saved configurations. */
    dataDir: string;
    /** File the run number is read from, if the DAQ writes one. */
    runNumberFile?: string;
  };
  timing: {
    /** Milliseconds to wait for a card ACK before retrying. */
    ackTimeoutMs: number;
    /** How many times a command is retried before the operation fails. */
    maxRetries: number;
    /** Milliseconds allowed for a card to power up before system check. */
    powerUpMs: number;
  };
}

export const DEFAULT_TOPOLOGY: Topology = {
  ports: { java: 6009, fec: 6022, fe: 6038, feCmd: 6039 },
  broadcastAddress: '255.255.255.255',
  cards: [
    { id: 'TRG', label: 'Trigger FEC', host: '10.0.0.3', plane: 'trg' },
    { id: 'PMT1', label: 'PMT FEC 1', host: '10.0.86.2', plane: 'pmt' },
    { id: 'BF1', label: 'BF FEC 1', host: '10.0.88.2', plane: 'bf' },
    { id: 'BF2', label: 'BF FEC 2', host: '10.0.66.2', plane: 'bf' },
    { id: 'BF3', label: 'BF FEC 3', host: '10.0.74.2', plane: 'bf' },
    { id: 'SIPM1', label: 'SiPM FEC 1', host: '10.0.90.2', plane: 'sipm' },
    { id: 'SIPM2', label: 'SiPM FEC 2', host: '10.0.68.2', plane: 'sipm' },
  ],
  feBoards: { template: '10.0.{}.1', offset: 128, maxBoard: 55 },
  counts: { fecPmt: 1, fecBf: 3, fecSipm: 2, feb: 13 },
  paths: { dataDir: './data' },
  timing: { ackTimeoutMs: 2000, maxRetries: 3, powerUpMs: 400 },
};

export class TopologyError extends Error {}

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function checkHost(host: string, where: string): void {
  const m = IPV4.exec(host);
  if (!m) throw new TopologyError(`${where}: "${host}" is not a dotted-quad IPv4 address`);
  for (const octet of m.slice(1)) {
    if (Number(octet) > 255) throw new TopologyError(`${where}: octet ${octet} out of range in "${host}"`);
  }
}

const checkPort = (port: number, where: string): void => {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new TopologyError(`${where}: port ${port} is not in 1..65535`);
  }
};

/**
 * Validate a topology. Throws rather than silently accepting a partial config —
 * a mistyped card address would otherwise surface as a card that never replies.
 */
export function validateTopology(t: Topology): Topology {
  checkPort(t.ports.java, 'ports.java');
  checkPort(t.ports.fec, 'ports.fec');
  checkPort(t.ports.fe, 'ports.fe');
  checkPort(t.ports.feCmd, 'ports.feCmd');
  checkHost(t.broadcastAddress, 'broadcastAddress');

  if (t.cards.length === 0) throw new TopologyError('cards: at least one card must be configured');

  const seenId = new Set<string>();
  const seenHost = new Map<string, string>();
  for (const c of t.cards) {
    if (seenId.has(c.id)) throw new TopologyError(`cards: duplicate id "${c.id}"`);
    seenId.add(c.id);
    checkHost(c.host, `cards.${c.id}.host`);
    const prev = seenHost.get(c.host);
    if (prev) {
      throw new TopologyError(`cards: "${c.id}" and "${prev}" share address ${c.host}`);
    }
    seenHost.set(c.host, c.id);
  }

  if (t.slowControl) {
    checkHost(t.slowControl.host, 'slowControl.host');
    checkPort(t.slowControl.port, 'slowControl.port');
  }
  if (!t.feBoards.template.includes('{}')) {
    throw new TopologyError('feBoards.template must contain "{}" for the board octet');
  }
  checkHost(feBoardAddress(t, 0), 'feBoards.template at board 0');
  checkHost(feBoardAddress(t, t.feBoards.maxBoard), 'feBoards.template at the highest board');

  for (const [name, cmd] of Object.entries(t.hooks ?? {})) {
    if (!Array.isArray(cmd) || cmd.length === 0 || typeof cmd[0] !== 'string' || !cmd[0]) {
      throw new TopologyError(`hooks.${name}: expected [program, ...arguments]`);
    }
  }

  if (t.timing.ackTimeoutMs <= 0) throw new TopologyError('timing.ackTimeoutMs must be positive');
  if (t.timing.maxRetries < 0) throw new TopologyError('timing.maxRetries must not be negative');
  return t;
}

/** Cards belonging to one plane, in configuration order. */
export const cardsOfPlane = (t: Topology, plane: CardEndpoint['plane']): CardEndpoint[] =>
  t.cards.filter((c) => c.plane === plane);


/** Resolve a SiPM front-end board number to its address. */
export function feBoardAddress(t: Topology, board: number): string {
  return t.feBoards.template.replace('{}', String(board + t.feBoards.offset));
}
