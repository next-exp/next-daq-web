import dgram from 'node:dgram';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_TOPOLOGY, type Topology } from '@next-daq/shared';
import { CardLink } from '../src/net/link.js';

/** Bind the link on the loopback interface so the tests need no detector network. */
const localTopology = (port: number): Topology => ({
  ...DEFAULT_TOPOLOGY,
  ports: { ...DEFAULT_TOPOLOGY.ports, java: port },
  cards: [{ id: 'TRG', label: 'Trigger', host: '127.0.0.1', plane: 'trg' }],
});

const PORT = 47_311;
let link: CardLink | undefined;

afterEach(async () => {
  await link?.close();
  link = undefined;
});

const frame = (...words: number[]): Buffer => {
  const b = Buffer.alloc(words.length * 2);
  words.forEach((w, i) => b.writeUInt16BE(w, i * 2));
  return b;
};

describe('CardLink', () => {
  it('receives and decodes a datagram from a configured card', async () => {
    link = new CardLink(localTopology(PORT));
    await link.start();

    const received = new Promise((resolve) => link!.once('message', resolve));
    const sender = dgram.createSocket('udp4');
    await new Promise<void>((r) => sender.send(frame(1, 0, 0x1fff), PORT, '127.0.0.1', () => r()));
    sender.close();

    const msg = (await received) as { frame: { data: number[] }; card?: { id: string } };
    expect(msg.card?.id).toBe('TRG');
    expect(msg.frame.data).toEqual([0x1fff]);
    expect(link.counters.received).toBe(1);
  });

  it('rejects a malformed datagram and counts it', async () => {
    link = new CardLink(localTopology(PORT + 1));
    await link.start();

    const rejected = new Promise((resolve) => link!.once('rejected', resolve));
    const sender = dgram.createSocket('udp4');
    // Two bytes: shorter than the minimum frame.
    await new Promise<void>((r) =>
      sender.send(Buffer.from([0x00]), PORT + 1, '127.0.0.1', () => r()),
    );
    sender.close();

    const info = (await rejected) as { reason: string };
    expect(info.reason).toMatch(/too_short/);
    expect(link.counters.rejectedMalformed.too_short).toBe(1);
    expect(link.counters.received).toBe(0);
  });

  it('closes its socket so the port is released', async () => {
    link = new CardLink(localTopology(PORT + 2));
    await link.start();
    await link.close();
    // Binding again would throw EADDRINUSE if the socket had leaked.
    const second = new CardLink(localTopology(PORT + 2));
    await expect(second.start()).resolves.toBeUndefined();
    await second.close();
  });

  it('refuses to send once closed rather than leaking a new socket', async () => {
    link = new CardLink(localTopology(PORT + 3));
    await link.start();
    await link.close();
    await expect(link.send(frame(1), '127.0.0.1', PORT + 3)).rejects.toThrow(/not running/);
  });

  it('resolves targets by plane', () => {
    const l = new CardLink(DEFAULT_TOPOLOGY);
    expect(l.resolveTargets('bf').map((t) => t.host)).toEqual([
      '10.0.88.2',
      '10.0.66.2',
      '10.0.74.2',
    ]);
    expect(l.resolveTargets('broadcast')[0].host).toBe('255.255.255.255');
  });

  it('takes the port from the register rather than the target', () => {
    // Front-end registers do not share one port, so the caller passes the register's
    // declared port; see addressing.test.ts for the per-register table.
    const t: Topology = {
      ...DEFAULT_TOPOLOGY,
      cards: [{ id: 'FE0', label: 'FEB 0', host: '10.0.100.2', plane: 'fe' }],
    };
    const link = new CardLink(t);
    expect(link.resolveTargets('fe', { port: 'fe' })[0].port).toBe(t.ports.fe);
    expect(link.resolveTargets('fe', { port: 'feCmd' })[0].port).toBe(t.ports.feCmd);
    expect(link.resolveTargets('fe')[0].port).toBe(t.ports.java);
  });

  it('requires a host for explicitly addressed commands', () => {
    const l = new CardLink(DEFAULT_TOPOLOGY);
    expect(() => l.resolveTargets('explicit')).toThrow(/requires an explicit destination/);
  });

  it('reports a plane with no configured cards instead of sending nothing', () => {
    const l = new CardLink({ ...DEFAULT_TOPOLOGY, cards: [DEFAULT_TOPOLOGY.cards[0]] });
    expect(() => l.resolveTargets('sipm')).toThrow(/No cards of type "sipm"/);
  });
});
