import type { CardEndpoint, Topology } from '@next-daq/shared';
import type { RxMessage } from '../net/link.js';

/**
 * Card reply tracking and trigger-health monitoring.
 *
 * Two confirmed defects in the original are fixed here, both with regression
 * tests in `server/test/monitor.test.ts`:
 *
 *  1. Card classification was a hand-written chain of address comparisons and
 *     `NewJFrame.java:850-859` tested BF1, BF3 and BF3 again. BF2 was created and
 *     counted inside the block, but the outer condition could never admit a BF2
 *     packet, so its replies were dropped. Classification is table-driven from the
 *     configured topology here, so a card cannot be omitted by a copy/paste slip.
 *
 *  2. The trigger-failure debounce at `NewJFrame.java:960-990` gated its own
 *     counter: the branch required `cnt_failure > 2` but `cnt_failure` was only
 *     incremented inside that branch, and the `else` reset it to zero. The counter
 *     could never leave zero and `trg_failure` was never raised. The counter is
 *     advanced on every invalid sample here and the failure asserted once it
 *     reaches the threshold.
 */

/** Status-register address whose reply carries the trigger-enable word. */
export const STATUS_ADDR_GENERAL = 0x0000;

/** Trigger-enable values the cards report when healthy. */
export const VALID_TRG_ENABLE = new Set([0x0000, 0x1fff]);

/** Consecutive invalid samples required before a trigger failure is declared. */
export const TRG_FAILURE_THRESHOLD = 3;

export interface CardStatus {
  id: string;
  label: string;
  plane: CardEndpoint['plane'];
  host: string;
  /** Replies seen from this card since the monitor was created or reset. */
  repliesReceived: number;
  lastSeen?: number;
  /** Most recent trigger-enable word, when this card reports one. */
  lastTrgEnable?: number;
}

export interface TriggerHealth {
  failed: boolean;
  consecutiveInvalid: number;
  lastValue?: number;
}

export class CardMonitor {
  private readonly statuses = new Map<string, CardStatus>();
  private trigger: TriggerHealth = { failed: false, consecutiveInvalid: 0 };

  constructor(private readonly topology: Topology) {
    this.reset();
  }

  reset(): void {
    this.statuses.clear();
    for (const c of this.topology.cards) {
      this.statuses.set(c.id, {
        id: c.id,
        label: c.label,
        plane: c.plane,
        host: c.host,
        repliesReceived: 0,
      });
    }
    this.trigger = { failed: false, consecutiveInvalid: 0 };
  }

  /** Record one decoded reply. Unknown sources are ignored by the caller. */
  observe(msg: RxMessage): void {
    if (!msg.card) return;
    const status = this.statuses.get(msg.card.id);
    if (!status) return;

    status.repliesReceived++;
    status.lastSeen = msg.receivedAt;

    if (msg.frame.statusAddr === STATUS_ADDR_GENERAL && msg.card.plane === 'trg') {
      // data[1] is the word the Java read as Cmddata2 (bytes 6-8 of the datagram).
      const trgEnable = msg.frame.data[1];
      if (trgEnable !== undefined) {
        status.lastTrgEnable = trgEnable;
        this.observeTriggerEnable(trgEnable);
      }
    }
  }

  /**
   * Advance the trigger-health debounce with one sample.
   *
   * A valid sample clears the counter and any standing failure; an invalid one
   * advances it, and the failure is asserted once the threshold is reached.
   */
  observeTriggerEnable(value: number): TriggerHealth {
    if (VALID_TRG_ENABLE.has(value)) {
      this.trigger = { failed: false, consecutiveInvalid: 0, lastValue: value };
    } else {
      const consecutiveInvalid = this.trigger.consecutiveInvalid + 1;
      this.trigger = {
        consecutiveInvalid,
        failed: consecutiveInvalid >= TRG_FAILURE_THRESHOLD,
        lastValue: value,
      };
    }
    return this.trigger;
  }

  get triggerHealth(): TriggerHealth {
    return { ...this.trigger };
  }

  /** Cards that have not replied at all, or not within `staleMs`. */
  missingCards(staleMs?: number, now = Date.now()): CardStatus[] {
    return [...this.statuses.values()].filter((s) => {
      if (s.repliesReceived === 0) return true;
      return staleMs !== undefined && s.lastSeen !== undefined && now - s.lastSeen > staleMs;
    });
  }

  snapshot(): CardStatus[] {
    return [...this.statuses.values()].map((s) => ({ ...s }));
  }

  /** Reply totals per plane, used by the system-check summary. */
  countsByPlane(): Record<string, { total: number; responding: number }> {
    const out: Record<string, { total: number; responding: number }> = {};
    for (const s of this.statuses.values()) {
      const bucket = (out[s.plane] ??= { total: 0, responding: 0 });
      bucket.total++;
      if (s.repliesReceived > 0) bucket.responding++;
    }
    return out;
  }
}
