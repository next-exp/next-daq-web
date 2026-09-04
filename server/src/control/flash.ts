import { EventEmitter } from 'node:events';
import {
  CMD_CONFIG,
  Words,
  decodeFlashAck,
  encode,
  getRegister,
  header,
  parseMcsRecords,
  type McsDataRecord,
} from '@next-daq/shared';
import type { CardLink, RxMessage } from '../net/link.js';

/**
 * Flash programming session.
 *
 * The original busy-waited on shared `Global` flags with no deadline
 * (`ATCAFlashProgramming NewJFrame.java:1894-1903`) and an infinite socket
 * timeout, so a lost ACK or a powered-off card hung programming forever with no
 * operator-visible outcome. This is an explicit state machine: every wait has a
 * deadline, ACK waits are retried a bounded number of times, the session can be
 * cancelled, and it always ends in a terminal state that is reported.
 */

/** Register address that flash data words are written to. */
export const FLASH_DATA_REG = 0x0101;

/** Status register carrying erase/write acknowledgements. */
export const FLASH_STATUS_REG = 0x0001;

/** Records batched into a single datagram, matching the original's 16-line groups. */
export const RECORDS_PER_FRAME = 16;

/** Each record occupies 9 words on the wire: 16 data bytes plus size and checksum. */
const WORDS_PER_RECORD = 9;

/** Records shorter than this are padded with erased-flash bytes. */
const RECORD_BYTES = 16;
const PAD_BYTE = 0xff;

export type FlashPhase =
  | 'idle'
  | 'erasing'
  | 'writing'
  | 'done'
  | 'failed'
  | 'cancelled';

export interface FlashProgress {
  phase: FlashPhase;
  recordsSent: number;
  recordsTotal: number;
  framesSent: number;
  bytesSent: number;
  message?: string;
}

export class FlashError extends Error {}

/**
 * Build one flash-write datagram from up to `RECORDS_PER_FRAME` records.
 *
 * Layout (all 16-bit big-endian), transcribed from the Java writer:
 *   word 0   sequence counter
 *   word 1   (wordCount << 8) | 0x02, wordCount = 9 * records + 4
 *   word 2   0x0101, the flash data register
 *   word 3   number of data bytes in this frame
 *   word 4   address high
 *   word 5   address low
 *   then per record: 0x10<<8 | data[0], data[1..14] as words, data[15]<<8 | checksum
 */
export function buildFlashFrame(
  records: McsDataRecord[],
  seqCnt: number,
): { bytes: Buffer; byteCount: number } {
  if (records.length === 0) throw new FlashError('Cannot build a flash frame with no records');
  if (records.length > RECORDS_PER_FRAME) {
    throw new FlashError(`A flash frame holds at most ${RECORDS_PER_FRAME} records`);
  }

  const wordCount = WORDS_PER_RECORD * records.length + 4;
  const byteCount = RECORD_BYTES * records.length;
  const address = records[0].address;

  const w = new Words();
  w.push(seqCnt, header(wordCount, CMD_CONFIG), FLASH_DATA_REG, byteCount);
  w.push(Math.floor(address / 0x10000) & 0xffff, address & 0xffff);

  for (const rec of records) {
    // Short records are padded to a full 16 bytes; the original did this with a
    // switch arm per length, each filling the remainder with 0xFF.
    const d = Buffer.alloc(RECORD_BYTES, PAD_BYTE);
    rec.data.copy(d, 0, 0, Math.min(rec.data.length, RECORD_BYTES));

    w.push((RECORD_BYTES << 8) | d[0]);
    for (let i = 1; i < RECORD_BYTES - 1; i += 2) w.push((d[i] << 8) | d[i + 1]);
    w.push((d[RECORD_BYTES - 1] << 8) | rec.checksum);
  }

  return { bytes: w.toBuffer(), byteCount };
}

export interface FlashOptions {
  /** Card to program. */
  host: string;
  port: number;
  /** Milliseconds to wait for the erase acknowledgement. */
  eraseTimeoutMs?: number;
  /** Milliseconds to wait for each write acknowledgement. */
  writeTimeoutMs?: number;
  /** Attempts per frame before the session fails. */
  maxRetries?: number;
  /** Select the alternate flash bank. */
  flashSelect?: boolean;
}

export class FlashSession extends EventEmitter<{
  progress: [FlashProgress];
  done: [FlashProgress];
}> {
  private phase: FlashPhase = 'idle';
  private cancelled = false;
  /** Set once the card has actually been put into programming mode. */
  private entered = false;
  private recordsSent = 0;
  private framesSent = 0;
  private bytesSent = 0;
  private seqCnt = 1;

  /** Resolvers waiting on an ACK; settled by `onMessage`. */
  private waiters: {
    kind: 'erase' | 'write';
    resolve: () => void;
    reject: (e: Error) => void;
  }[] = [];

  /**
   * Acknowledgements that arrived before anything was waiting for them.
   *
   * The datagram is sent before the waiter is armed, so that a send failure cannot
   * strand a promise whose timer later rejects it unhandled. That leaves a window
   * where a fast reply would be dropped, so an early ACK latches here and the next
   * wait for that kind consumes it.
   */
  private pendingAcks = { erase: false, write: false };

  /**
   * A fault that arrived before anything was waiting — a checksum error from the
   * card, or an operator cancelling. Latched for the same reason as `pendingAcks`,
   * so the next wait fails immediately instead of running to its timeout.
   */
  private fatal?: Error;

  constructor(
    private readonly link: CardLink,
    private readonly opts: FlashOptions,
  ) {
    super();
  }

  /** Feed a received datagram to the session. Safe to call for unrelated traffic. */
  onMessage(msg: RxMessage): void {
    if (msg.address !== this.opts.host) return;
    if (msg.frame.statusAddr !== FLASH_STATUS_REG) return;
    const reg = msg.frame.data[0];
    if (reg === undefined) return;

    const ack = decodeFlashAck(reg);
    if (ack.errorChk) {
      this.settleAll(new FlashError('Card reported a checksum error'));
      return;
    }
    let matchedErase = false;
    let matchedWrite = false;
    for (const waiter of this.waiters.splice(0)) {
      if (waiter.kind === 'erase' && ack.eraseAck) {
        matchedErase = true;
        waiter.resolve();
      } else if (waiter.kind === 'write' && ack.writeAck) {
        matchedWrite = true;
        waiter.resolve();
      } else {
        // Not the acknowledgement we are waiting for; keep waiting.
        this.waiters.push(waiter);
      }
    }

    // Latch an acknowledgement nothing was waiting for yet.
    if (ack.eraseAck && !matchedErase) this.pendingAcks.erase = true;
    if (ack.writeAck && !matchedWrite) this.pendingAcks.write = true;
  }

  cancel(): void {
    this.cancelled = true;
    this.settleAll(new FlashError('Cancelled by operator'));
  }

  private settleAll(err: Error): void {
    this.fatal = err;
    for (const waiter of this.waiters.splice(0)) waiter.reject(err);
  }

  /** Wait for an acknowledgement, or reject once the deadline passes. */
  private waitForAck(kind: 'erase' | 'write', timeoutMs: number): Promise<void> {
    // A fault already reported wins over any pending acknowledgement.
    if (this.fatal) return Promise.reject(this.fatal);
    // Consume an acknowledgement that already arrived.
    if (this.pendingAcks[kind]) {
      this.pendingAcks[kind] = false;
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((x) => x !== entry);
        reject(new FlashError(`Timed out after ${timeoutMs} ms waiting for the ${kind} ACK`));
      }, timeoutMs);

      const entry = {
        kind,
        resolve: () => {
          clearTimeout(timer);
          resolve();
        },
        reject: (e: Error) => {
          clearTimeout(timer);
          reject(e);
        },
      };
      this.waiters.push(entry);
    });
  }

  private report(message?: string): void {
    this.emit('progress', this.progress(message));
  }

  progress(message?: string): FlashProgress {
    return {
      phase: this.phase,
      recordsSent: this.recordsSent,
      recordsTotal: this.recordsTotal,
      framesSent: this.framesSent,
      bytesSent: this.bytesSent,
      message,
    };
  }

  private recordsTotal = 0;

  /** Run the full programming sequence. Always ends in done, failed or cancelled. */
  async run(mcsText: string): Promise<FlashProgress> {
    const {
      eraseTimeoutMs = 60_000,
      writeTimeoutMs = 5_000,
      maxRetries = 3,
      flashSelect = false,
    } = this.opts;

    try {
      const records = parseMcsRecords(mcsText);
      if (records.length === 0) throw new FlashError('Image contains no data records');
      this.recordsTotal = records.length;

      this.phase = 'erasing';
      this.report('Entering programming mode and erasing');

      const enter = encode(
        getRegister('ProgCmd'),
        { prog_on: true, prog_wron: true, flash_sel: flashSelect },
        this.seqCnt++,
      );
      // Send first, then arm the wait. Arming beforehand leaves an orphaned promise
      // if the send throws: nothing ever awaits it, and its timer later rejects it
      // as an unhandled rejection, which terminates the process under Node's
      // default policy.
      this.entered = true;
      await this.link.send(enter.bytes, this.opts.host, this.opts.port);
      await this.waitForAck('erase', eraseTimeoutMs);

      this.phase = 'writing';
      this.report('Erase acknowledged, writing image');

      for (let i = 0; i < records.length; i += RECORDS_PER_FRAME) {
        if (this.cancelled) throw new FlashError('Cancelled by operator');
        const batch = records.slice(i, i + RECORDS_PER_FRAME);
        await this.sendFrameWithRetry(batch, writeTimeoutMs, maxRetries);
        this.recordsSent += batch.length;
        this.framesSent++;
        this.bytesSent += batch.length * RECORD_BYTES;
        if (this.framesSent % 64 === 0) this.report();
      }

      // Leave programming mode so the card is not left with the flash writable.
      const leave = encode(
        getRegister('ProgCmd'),
        { prog_on: false, prog_wron: false, flash_sel: flashSelect },
        this.seqCnt++,
      );
      await this.link.send(leave.bytes, this.opts.host, this.opts.port);

      this.phase = 'done';
      const final = this.progress('Programming complete');
      this.emit('done', final);
      return final;
    } catch (err) {
      this.phase = this.cancelled ? 'cancelled' : 'failed';
      const message = err instanceof Error ? err.message : String(err);
      // Best effort: drop out of programming mode so the card is not left with the
      // flash writable. Skipped when we never entered it — a malformed image must
      // not put traffic on the detector network.
      if (this.entered) {
        try {
          const leave = encode(getRegister('ProgCmd'), {}, this.seqCnt++);
          await this.link.send(leave.bytes, this.opts.host, this.opts.port);
        } catch {
          // The card is already unreachable; the original failure is what matters.
        }
      }
      const final = this.progress(message);
      this.emit('done', final);
      return final;
    }
  }

  private async sendFrameWithRetry(
    batch: McsDataRecord[],
    timeoutMs: number,
    maxRetries: number,
  ): Promise<void> {
    let lastError: Error | undefined;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (this.cancelled) throw new FlashError('Cancelled by operator');
      const { bytes } = buildFlashFrame(batch, this.seqCnt++);
      try {
        // Same ordering as the erase step: no waiter is armed for a datagram that
        // never left the host.
        this.pendingAcks.write = false;
        await this.link.send(bytes, this.opts.host, this.opts.port);
        await this.waitForAck('write', timeoutMs);
        return;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (this.cancelled) throw lastError;
      }
    }
    throw new FlashError(
      `Frame at record ${this.recordsSent} failed after ${maxRetries + 1} attempts: ${lastError?.message}`,
    );
  }
}
