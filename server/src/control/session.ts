import {
  ALL_ACTIONS,
  ALL_REGISTERS,
  encode,
  getAction,
  getRegister,
  planAction,
  type Params,
  type PlannedWrite,
  type RegisterDef,
  type Topology,
} from '@next-daq/shared';
import { CardLink, type RxMessage } from '../net/link.js';
import { CardMonitor } from './monitor.js';
import { RunControl } from './state.js';
import { RunLog } from '../store/log.js';
import { SettingsStore } from '../store/settings.js';
import { computeReadiness, type Readiness } from './readiness.js';
import { FlashSession, type FlashOptions, type FlashProgress } from './flash.js';

/**
 * Owns the live control session: the socket, the run state, card monitoring and
 * any flash session in progress. One instance per server process, so there is a
 * single writer for all mutable state.
 */
export class Session {
  readonly link: CardLink;
  readonly monitor: CardMonitor;
  readonly control = new RunControl();
  readonly log: RunLog;
  /** Current values of every operator panel — the saveable configuration. */
  readonly settings: SettingsStore;

  private seqCnt = 1;
  private flash?: FlashSession;
  /** Bounded ring of recent traffic for the operator view. */
  private readonly recent: RxMessage[] = [];
  private static readonly RECENT_LIMIT = 500;

  private readonly listeners = new Set<(event: ServerEvent) => void>();

  constructor(
    readonly topology: Topology,
    private readonly dryRun: boolean,
  ) {
    this.link = new CardLink(topology);
    this.monitor = new CardMonitor(topology);
    this.log = new RunLog(topology.paths.dataDir);
    this.settings = new SettingsStore(topology.paths.dataDir);

    this.link.on('message', (msg) => this.onMessage(msg));
    this.link.on('rejected', (info) => {
      void this.log.warn('datagram_rejected', info);
      this.publish({ type: 'rejected', ...info });
    });
    this.link.on('error', (err) => {
      void this.log.error('socket_error', { message: err.message });
      this.control.fail(`Socket error: ${err.message}`);
      this.publish({ type: 'state', snapshot: this.control.snapshot() });
    });
    this.control.on('change', (snapshot) => this.publish({ type: 'state', snapshot }));
  }

  async start(): Promise<void> {
    // Restore the panel values from the previous session before accepting traffic.
    await this.settings.loadFromDisk();
    if (!this.dryRun) await this.link.start();
    await this.log.info('session_started', {
      dryRun: this.dryRun,
      cards: this.topology.cards.length,
      port: this.topology.ports.java,
    });
    this.control.moveTo('CONFIGURING', 'Server started');
  }

  private onMessage(msg: RxMessage): void {
    this.monitor.observe(msg);
    this.flash?.onMessage(msg);

    this.recent.push(msg);
    if (this.recent.length > Session.RECENT_LIMIT) this.recent.shift();

    this.publish({
      type: 'rx',
      card: msg.card?.id,
      address: msg.address,
      statusAddr: msg.frame.statusAddr,
      data: msg.frame.data,
      at: msg.receivedAt,
    });

    const health = this.monitor.triggerHealth;
    if (health.failed) {
      void this.log.error('trigger_failure', {
        consecutiveInvalid: health.consecutiveInvalid,
        lastValue: health.lastValue,
      });
    }
  }

  nextSeq(): number {
    const n = this.seqCnt;
    // The sequence counter is a 16-bit field on the wire.
    this.seqCnt = (this.seqCnt + 1) & 0xffff;
    return n;
  }

  /** Encode and send one register or command. */
  async sendRegister(
    id: string,
    params: Params,
    explicitHost?: string,
    override: { target?: RegisterDef['target']; board?: number; cardIndex?: number } = {},
  ): Promise<{ hexWords: string[]; targets: string[]; dryRun: boolean }> {
    const def = getRegister(id);
    const cmd = encode(def, params, this.nextSeq());
    const targets = this.link.resolveTargets(override.target ?? def.target, {
      host: explicitHost,
      port: def.port,
      board: override.board ?? (def.boardParam ? Number(params[def.boardParam]) : undefined),
      cardIndex: override.cardIndex,
    });

    if (!this.dryRun) {
      for (const t of targets) await this.link.send(cmd.bytes, t.host, t.port);
    }

    await this.log.info('command_sent', {
      register: id,
      words: cmd.hexWords,
      targets: targets.map((t) => `${t.host}:${t.port}`),
      dryRun: this.dryRun,
    });

    return {
      hexWords: cmd.hexWords,
      targets: targets.map((t) => `${t.host}:${t.port}`),
      dryRun: this.dryRun,
    };
  }

  /**
   * Expand a configuration action without sending anything, returning the words
   * each write would put on the wire. This is what the console previews.
   */
  planAction(id: string, params: Params): {
    writes: (PlannedWrite & { hexWords: string[]; targets: string[] })[];
  } {
    const action = getAction(id);
    const writes = planAction(
      action,
      params,
      this.settings.all(),
      this.settings.channelValues(id),
    );
    return {
      writes: writes.map((w) => {
        const def = getRegister(w.register);
        // Preview uses the live sequence counter without consuming it, so a
        // preview never perturbs the numbering of real traffic.
        const cmd = encode(def, w.params, this.seqCnt);
        return {
          ...w,
          hexWords: cmd.hexWords,
          targets: this.link
            .resolveTargets(w.target ?? def.target, {
              host: w.host,
              port: def.port,
              board: w.board ?? (def.boardParam ? Number(w.params[def.boardParam]) : undefined),
              cardIndex: w.cardIndex,
            })
            .map((t) => `${t.host}:${t.port}`),
        };
      }),
    };
  }

  /**
   * Apply a configuration action: send each planned write in order.
   *
   * A failure stops the sequence and is reported with the writes that did land,
   * rather than leaving the operator to guess how far it got.
   */
  async applyAction(
    id: string,
    params: Params,
  ): Promise<{ applied: { register: string; hexWords: string[]; targets: string[] }[]; dryRun: boolean }> {
    const action = getAction(id);
    // Store first, so a plan reading this panel's own values sees what was just set.
    this.settings.set(id, params);
    const writes = planAction(
      action,
      params,
      this.settings.all(),
      this.settings.channelValues(id),
    );
    if (writes.length === 0) {
      throw new Error(`${id}: nothing to send — no channels or targets selected`);
    }

    const applied: { register: string; hexWords: string[]; targets: string[] }[] = [];
    await this.settings.saveToDisk();
    await this.log.info('action_started', { action: id, writes: writes.length });

    for (const w of writes) {
      try {
        const res = await this.sendRegister(w.register, w.params, w.host, {
          target: w.target,
          board: w.board,
          cardIndex: w.cardIndex,
        });
        applied.push({ register: w.register, hexWords: res.hexWords, targets: res.targets });
        this.publish({
          type: 'action',
          action: id,
          step: applied.length,
          total: writes.length,
          note: w.note,
        });

        if (w.waitAfterMs && w.waitAfterMs > 0 && !this.dryRun) {
          this.publish({
            type: 'action',
            action: id,
            step: applied.length,
            total: writes.length,
            note: `Waiting ${Math.round(w.waitAfterMs / 1000)} s for the cards to return`,
            waitingMs: w.waitAfterMs,
          });
          await new Promise((resolve) => setTimeout(resolve, w.waitAfterMs));
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await this.log.error('action_failed', {
          action: id,
          register: w.register,
          completed: applied.length,
          total: writes.length,
          message,
        });
        this.publish({
          type: 'action',
          action: id,
          step: applied.length,
          total: writes.length,
          error: message,
        });
        throw new Error(
          `${id}: failed on ${w.register} after ${applied.length} of ${writes.length} writes: ${message}`,
        );
      }
    }

    // Only now is this the state the cards were actually told.
    this.settings.markApplied(id, params);
    await this.settings.saveToDisk();
    // A reset clears the cards' configured state, so previously applied panels no
    // longer describe the hardware and the run interlock must be re-satisfied.
    if (id === 'run.softReset' || id === 'run.hardReset' || id === 'fec.recover') {
      this.settings.clearApplied();
      await this.log.info('configuration_invalidated', { by: id });
    }

    await this.log.info('action_completed', { action: id, writes: applied.length });
    this.publish({ type: 'action', action: id, step: writes.length, total: writes.length, done: true });
    return { applied, dryRun: this.dryRun };
  }

  /** Whether the panels a run depends on have been applied since the last reset. */
  readiness(): Readiness {
    return computeReadiness(this.settings, this.topology);
  }

  /** Total time a plan will spend waiting, used to decide whether to detach it. */
  planWaitMs(id: string, params: Params): number {
    return planAction(
      getAction(id),
      params,
      this.settings.all(),
      this.settings.channelValues(id),
    ).reduce(
      (t, w) => t + (w.waitAfterMs ?? 0),
      0,
    );
  }

  startFlash(opts: FlashOptions, mcsText: string): FlashSession {
    if (this.flash && ['erasing', 'writing'].includes(this.flash.progress().phase)) {
      throw new Error('A flash session is already running');
    }
    const session = new FlashSession(this.link, opts);
    this.flash = session;
    session.on('progress', (p) => this.publish({ type: 'flash', progress: p }));
    session.on('done', (p) => {
      this.publish({ type: 'flash', progress: p });
      void this.log.info('flash_finished', { ...p });
    });
    void session.run(mcsText);
    return session;
  }

  cancelFlash(): void {
    this.flash?.cancel();
  }

  flashProgress(): FlashProgress | undefined {
    return this.flash?.progress();
  }

  status() {
    return {
      state: this.control.snapshot(),
      cards: this.monitor.snapshot(),
      trigger: this.monitor.triggerHealth,
      counters: this.link.counters,
      planes: this.monitor.countsByPlane(),
      dryRun: this.dryRun,
      registerCount: ALL_REGISTERS.length,
      actionCount: ALL_ACTIONS.length,
    };
  }

  subscribe(fn: (event: ServerEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private publish(event: ServerEvent): void {
    for (const fn of this.listeners) {
      try {
        fn(event);
      } catch {
        // A failing subscriber must not stop the others or the control path.
      }
    }
  }

  async stop(): Promise<void> {
    this.cancelFlash();
    await this.settings.saveToDisk();
    await this.link.close();
    await this.log.flush();
  }
}

export type ServerEvent =
  | { type: 'state'; snapshot: ReturnType<RunControl['snapshot']> }
  | { type: 'rx'; card?: string; address: string; statusAddr: number; data: number[]; at: number }
  | { type: 'rejected'; reason: string; address: string; port: number; length: number }
  | { type: 'flash'; progress: FlashProgress }
  | {
      type: 'action';
      action: string;
      step: number;
      total: number;
      note?: string;
      waitingMs?: number;
      error?: string;
      done?: boolean;
    };
