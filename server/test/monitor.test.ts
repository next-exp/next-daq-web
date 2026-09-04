import { describe, expect, it } from 'vitest';
import { DEFAULT_TOPOLOGY, type Topology } from '@next-daq/shared';
import { CardMonitor, TRG_FAILURE_THRESHOLD } from '../src/control/monitor.js';
import type { RxMessage } from '../src/net/link.js';

const topology: Topology = DEFAULT_TOPOLOGY;

const reply = (cardId: string, statusAddr = 0, data: number[] = []): RxMessage => {
  const card = topology.cards.find((c) => c.id === cardId)!;
  return {
    card,
    address: card.host,
    port: topology.ports.java,
    receivedAt: Date.now(),
    frame: { header: 1, statusAddr, data, hasEofMarker: false, length: 4 + data.length * 2 },
  };
};

describe('card classification', () => {
  /**
   * Regression test for the confirmed BF2 defect.
   *
   * `NewJFrame.java:850-859` tested BF1, BF3 and BF3 again, so no BF2 packet
   * could enter the block that counted it. Classification is driven by the
   * topology table now, so every configured card is reachable.
   */
  it('counts replies from every configured BF card, including BF2', () => {
    const m = new CardMonitor(topology);
    m.observe(reply('BF1'));
    m.observe(reply('BF2'));
    m.observe(reply('BF3'));

    const byId = Object.fromEntries(m.snapshot().map((s) => [s.id, s.repliesReceived]));
    expect(byId.BF1).toBe(1);
    expect(byId.BF2).toBe(1);
    expect(byId.BF3).toBe(1);
  });

  it('reports BF2 as responding, not missing', () => {
    const m = new CardMonitor(topology);
    m.observe(reply('BF2'));
    expect(m.missingCards().map((c) => c.id)).not.toContain('BF2');
  });

  it('counts every card in the topology without omission', () => {
    const m = new CardMonitor(topology);
    for (const card of topology.cards) m.observe(reply(card.id));
    expect(m.missingCards()).toHaveLength(0);
    for (const [, bucket] of Object.entries(m.countsByPlane())) {
      expect(bucket.responding).toBe(bucket.total);
    }
  });

  it('lists cards that have never replied', () => {
    const m = new CardMonitor(topology);
    m.observe(reply('TRG'));
    expect(m.missingCards().map((c) => c.id)).toEqual(
      topology.cards.filter((c) => c.id !== 'TRG').map((c) => c.id),
    );
  });

  it('treats a card that has gone quiet as stale', () => {
    const m = new CardMonitor(topology);
    const msg = reply('TRG');
    msg.receivedAt = 1_000;
    m.observe(msg);
    expect(m.missingCards(500, 2_000).map((c) => c.id)).toContain('TRG');
    expect(m.missingCards(5_000, 2_000).map((c) => c.id)).not.toContain('TRG');
  });
});

describe('trigger-failure debounce', () => {
  /**
   * Regression test for the confirmed counter defect.
   *
   * `NewJFrame.java:960-990` required `cnt_failure > 2` to enter the branch that
   * incremented `cnt_failure`, and the else-branch reset it to zero — so the
   * counter never left zero and `trg_failure` was never raised. Three consecutive
   * invalid samples must now declare a failure.
   */
  it('declares a failure after the threshold of consecutive invalid samples', () => {
    const m = new CardMonitor(topology);
    for (let i = 1; i < TRG_FAILURE_THRESHOLD; i++) {
      const h = m.observeTriggerEnable(0x1234);
      expect(h.consecutiveInvalid).toBe(i);
      expect(h.failed).toBe(false);
    }
    const final = m.observeTriggerEnable(0x1234);
    expect(final.consecutiveInvalid).toBe(TRG_FAILURE_THRESHOLD);
    expect(final.failed).toBe(true);
  });

  it('accepts the two healthy trigger-enable values', () => {
    const m = new CardMonitor(topology);
    for (const ok of [0x0000, 0x1fff]) {
      expect(m.observeTriggerEnable(ok).failed).toBe(false);
      expect(m.observeTriggerEnable(ok).consecutiveInvalid).toBe(0);
    }
  });

  /** The sequence the evaluation asked for: valid → three invalid → valid. */
  it('follows valid -> three invalid -> valid', () => {
    const m = new CardMonitor(topology);
    expect(m.observeTriggerEnable(0x1fff).failed).toBe(false);
    m.observeTriggerEnable(0xabcd);
    m.observeTriggerEnable(0xabcd);
    expect(m.observeTriggerEnable(0xabcd).failed).toBe(true);
    const recovered = m.observeTriggerEnable(0x0000);
    expect(recovered.failed).toBe(false);
    expect(recovered.consecutiveInvalid).toBe(0);
  });

  it('does not latch a failure across an intervening valid sample', () => {
    const m = new CardMonitor(topology);
    m.observeTriggerEnable(0xdead);
    m.observeTriggerEnable(0xdead);
    m.observeTriggerEnable(0x0000); // recovery resets the run
    m.observeTriggerEnable(0xdead);
    expect(m.triggerHealth.failed).toBe(false);
    expect(m.triggerHealth.consecutiveInvalid).toBe(1);
  });

  it('picks the trigger-enable word out of a trigger card reply', () => {
    const m = new CardMonitor(topology);
    // data[1] is the word the Java read as Cmddata2.
    for (let i = 0; i < TRG_FAILURE_THRESHOLD; i++) {
      m.observe(reply('TRG', 0x0000, [0x0001, 0x9999]));
    }
    expect(m.triggerHealth.failed).toBe(true);
    expect(m.snapshot().find((s) => s.id === 'TRG')?.lastTrgEnable).toBe(0x9999);
  });

  it('ignores trigger-enable words from non-trigger cards', () => {
    const m = new CardMonitor(topology);
    for (let i = 0; i < 5; i++) m.observe(reply('BF1', 0x0000, [0x0001, 0x9999]));
    expect(m.triggerHealth.failed).toBe(false);
  });
});
