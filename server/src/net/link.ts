import dgram from 'node:dgram';
import { EventEmitter } from 'node:events';
import {
  decodeStatusFrame,
  feBoardAddress,
  type CardEndpoint,
  type DecodeError,
  type RegisterDef,
  type StatusFrame,
  type Topology,
} from '@next-daq/shared';

/**
 * Owns the one UDP socket the application uses to talk to the cards.
 *
 * The original opened a fresh `DatagramSocket` for every command — 59 construction
 * sites in the DAQ application, none of them closed — so long configuration or
 * reset cycles leaked ephemeral ports until sends began to fail. Here a single
 * socket is bound for the process lifetime and closed deterministically on
 * shutdown, and every datagram is validated before anything reads its fields.
 */

export interface RxMessage {
  frame: StatusFrame;
  /** The configured card the datagram came from, if the source is known. */
  card?: CardEndpoint;
  address: string;
  port: number;
  receivedAt: number;
}

export interface LinkCounters {
  sent: number;
  received: number;
  rejectedUnknownSource: number;
  rejectedMalformed: Record<DecodeError, number>;
  sendErrors: number;
}

export interface CardLinkEvents {
  message: [RxMessage];
  rejected: [{ reason: string; address: string; port: number; length: number }];
  error: [Error];
}

export class CardLink extends EventEmitter<CardLinkEvents> {
  private socket?: dgram.Socket;
  private readonly byHost: Map<string, CardEndpoint>;
  private closed = false;

  readonly counters: LinkCounters = {
    sent: 0,
    received: 0,
    rejectedUnknownSource: 0,
    rejectedMalformed: { too_short: 0, odd_length: 0, too_long: 0, unknown_source: 0 },
    sendErrors: 0,
  };

  constructor(
    private readonly topology: Topology,
    /**
     * When false, datagrams from hosts not in the topology are decoded anyway and
     * delivered with `card` unset. Default rejects them, matching the source check
     * the original performed before parsing.
     */
    private readonly acceptUnknownSources = false,
  ) {
    super();
    this.byHost = new Map(topology.cards.map((c) => [c.host, c]));
  }

  async start(): Promise<void> {
    if (this.socket) throw new Error('CardLink already started');
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    this.socket = socket;

    socket.on('message', (data, rinfo) => this.onMessage(data, rinfo));
    socket.on('error', (err) => this.emit('error', err));

    await new Promise<void>((resolve, reject) => {
      socket.once('error', reject);
      socket.bind(this.topology.ports.java, () => {
        socket.removeListener('error', reject);
        resolve();
      });
    });
    socket.setBroadcast(true);
  }

  private onMessage(data: Buffer, rinfo: dgram.RemoteInfo): void {
    // `data` is a fresh Buffer per datagram in Node, so unlike the Java receive
    // loop there is no shared mutable buffer to race over. Length comes from the
    // datagram itself and bounds every field read.
    const card = this.byHost.get(rinfo.address);
    if (!card && !this.acceptUnknownSources) {
      this.counters.rejectedUnknownSource++;
      this.emit('rejected', {
        reason: 'unknown_source',
        address: rinfo.address,
        port: rinfo.port,
        length: rinfo.size,
      });
      return;
    }

    const result = decodeStatusFrame(data, rinfo.size);
    if (!result.ok) {
      this.counters.rejectedMalformed[result.error]++;
      this.emit('rejected', {
        reason: `${result.error}: ${result.detail}`,
        address: rinfo.address,
        port: rinfo.port,
        length: rinfo.size,
      });
      return;
    }

    this.counters.received++;
    this.emit('message', {
      frame: result.frame,
      card,
      address: rinfo.address,
      port: rinfo.port,
      receivedAt: Date.now(),
    });
  }

  /** Send one datagram. Resolves once the socket has accepted it for transmission. */
  async send(bytes: Buffer, host: string, port: number): Promise<void> {
    const socket = this.socket;
    if (!socket || this.closed) throw new Error('CardLink is not running');
    await new Promise<void>((resolve, reject) => {
      socket.send(bytes, port, host, (err) => {
        if (err) {
          this.counters.sendErrors++;
          reject(err);
        } else {
          this.counters.sent++;
          resolve();
        }
      });
    });
  }

  /**
   * Resolve a command's destinations.
   *
   * The port is whatever the register declares, because the front-end boards do not
   * all listen on one: most FE registers go to 6038 while the sensor-mask and LED
   * registers go to 6039.
   */
  resolveTargets(
    target: RegisterDef['target'] | string,
    opts: { host?: string; board?: number; port?: RegisterDef['port'] } = {},
  ): { host: string; port: number }[] {
    const { ports, broadcastAddress, cards, feBoards } = this.topology;
    const port =
      opts.port === 'fe'
        ? ports.fe
        : opts.port === 'feCmd'
          ? ports.feCmd
          : opts.port === 'fec'
            ? ports.fec
            : ports.java;

    if (target === 'broadcast') return [{ host: broadcastAddress, port }];

    if (target === 'explicit') {
      if (!opts.host) throw new Error('This command requires an explicit destination host');
      return [{ host: opts.host, port }];
    }

    if (target === 'feBoard') {
      const board = opts.board;
      if (board === undefined || !Number.isInteger(board)) {
        throw new Error('This command must name the front-end board it addresses');
      }
      if (board < 0 || board > feBoards.maxBoard) {
        throw new Error(`Front-end board ${board} is outside 0..${feBoards.maxBoard}`);
      }
      return [{ host: feBoardAddress(this.topology, board), port }];
    }

    const plane = cards.filter((c) => c.plane === target);
    if (plane.length === 0) {
      throw new Error(`No cards of type "${target}" are configured`);
    }
    return plane.map((c) => ({ host: c.host, port }));
  }

  async close(): Promise<void> {
    if (!this.socket || this.closed) return;
    this.closed = true;
    await new Promise<void>((resolve) => this.socket!.close(() => resolve()));
    this.socket = undefined;
  }
}
