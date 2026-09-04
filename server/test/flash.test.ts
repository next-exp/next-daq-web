import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { buildFlashFrame, FlashSession, RECORDS_PER_FRAME } from '../src/control/flash.js';
import type { CardLink, RxMessage } from '../src/net/link.js';

/** Build a valid Intel HEX record with a correct checksum. */
function rec(type: number, address: number, data: number[]): string {
  const bytes = [data.length, (address >> 8) & 0xff, address & 0xff, type, ...data];
  bytes.push((-bytes.reduce((a, b) => a + b, 0)) & 0xff);
  return ':' + bytes.map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join('');
}
const EOF_REC = rec(0x01, 0, []);

const image = (records: number): string =>
  [
    ...Array.from({ length: records }, (_, i) =>
      rec(0x00, i * 16, Array.from({ length: 16 }, (_, j) => (i + j) & 0xff)),
    ),
    EOF_REC,
  ].join('\n');

/** A link stand-in that records sends and lets the test drive acknowledgements. */
class FakeLink extends EventEmitter {
  sent: Buffer[] = [];
  /** Set to auto-acknowledge each send with the given register value. */
  autoAck?: (session: FlashSession, n: number) => void;
  private n = 0;

  send = vi.fn(async (bytes: Buffer) => {
    this.sent.push(Buffer.from(bytes));
    const n = ++this.n;
    if (this.autoAck) queueMicrotask(() => this.autoAck!(this.sessionRef!, n));
  });

  sessionRef?: FlashSession;
}

const ackMessage = (host: string, reg: number): RxMessage => ({
  address: host,
  port: 6009,
  receivedAt: Date.now(),
  frame: { header: 1, statusAddr: 0x0001, data: [reg], hasEofMarker: false, length: 6 },
});

const ERASE_ACK = 0x0004;
const WRITE_ACK = 0x0008;
const ERROR_CHK = 0x0001;

describe('buildFlashFrame', () => {
  it('lays out the header the way the Java writer did', () => {
    const records = [{ address: 0x0001_2340, data: Buffer.alloc(16, 0xaa), checksum: 0x5c }];
    const { bytes } = buildFlashFrame(records, 7);
    const words: number[] = [];
    for (let i = 0; i < bytes.length; i += 2) words.push(bytes.readUInt16BE(i));

    expect(words[0]).toBe(7); // sequence counter
    expect(words[1]).toBe((9 * 1 + 4) << 8 | 0x02); // word count and config command
    expect(words[2]).toBe(0x0101); // flash data register
    expect(words[3]).toBe(16); // data bytes in this frame
    expect(words[4]).toBe(0x0001); // address high
    expect(words[5]).toBe(0x2340); // address low
  });

  it('emits nine words per record, ending with the record checksum', () => {
    const data = Buffer.from(Array.from({ length: 16 }, (_, i) => i));
    const { bytes } = buildFlashFrame([{ address: 0, data, checksum: 0x42 }], 1);
    const words: number[] = [];
    for (let i = 0; i < bytes.length; i += 2) words.push(bytes.readUInt16BE(i));

    expect(words).toHaveLength(6 + 9);
    expect(words[6]).toBe((0x10 << 8) | 0x00); // size marker plus first data byte
    expect(words[7]).toBe(0x0102); // data bytes 1 and 2
    expect(words[14]).toBe((0x0f << 8) | 0x42); // last data byte plus checksum
  });

  it('pads a short record with erased-flash bytes', () => {
    const { bytes } = buildFlashFrame(
      [{ address: 0, data: Buffer.from([0xde, 0xad]), checksum: 0x11 }],
      1,
    );
    const words: number[] = [];
    for (let i = 0; i < bytes.length; i += 2) words.push(bytes.readUInt16BE(i));
    expect(words[6]).toBe((0x10 << 8) | 0xde);
    expect(words[7]).toBe(0xadff);
    expect(words[8]).toBe(0xffff);
    expect(words[14]).toBe(0xff11);
  });

  it('refuses an over-long batch rather than truncating it', () => {
    const many = Array.from({ length: RECORDS_PER_FRAME + 1 }, () => ({
      address: 0,
      data: Buffer.alloc(16),
      checksum: 0,
    }));
    expect(() => buildFlashFrame(many, 1)).toThrow(/at most 16 records/);
  });
});

describe('FlashSession', () => {
  const HOST = '10.0.0.9';

  const session = (link: FakeLink, opts = {}): FlashSession => {
    const s = new FlashSession(link as unknown as CardLink, {
      host: HOST,
      port: 6009,
      eraseTimeoutMs: 200,
      writeTimeoutMs: 200,
      maxRetries: 1,
      ...opts,
    });
    link.sessionRef = s;
    return s;
  };

  it('programs an image end to end when every frame is acknowledged', async () => {
    const link = new FakeLink();
    link.autoAck = (s, n) => s.onMessage(ackMessage(HOST, n === 1 ? ERASE_ACK : WRITE_ACK));
    const s = session(link);
    const result = await s.run(image(20));

    expect(result.phase).toBe('done');
    expect(result.recordsSent).toBe(20);
    // 20 records batch into two frames of 16 and 4.
    expect(result.framesSent).toBe(2);
    expect(result.bytesSent).toBe(20 * 16);
  });

  /**
   * The original busy-waited on a global ACK flag with no deadline, so a silent
   * card hung programming forever. The session must instead fail.
   */
  it('fails with a timeout when the erase acknowledgement never arrives', async () => {
    const link = new FakeLink(); // no autoAck: the card stays silent
    const result = await session(link).run(image(1));
    expect(result.phase).toBe('failed');
    expect(result.message).toMatch(/Timed out after 200 ms waiting for the erase ACK/);
  });

  it('retries a write frame before giving up', async () => {
    const link = new FakeLink();
    let writes = 0;
    link.autoAck = (s, n) => {
      if (n === 1) return s.onMessage(ackMessage(HOST, ERASE_ACK));
      // Only data frames count as write attempts; the trailing ProgCmd that leaves
      // programming mode is not one.
      const last = link.sent[link.sent.length - 1];
      if (last.readUInt16BE(4) !== 0x0101) return;
      writes++;
      // Ignore the first write attempt, acknowledge the retry.
      if (writes > 1) s.onMessage(ackMessage(HOST, WRITE_ACK));
    };
    const result = await session(link, { maxRetries: 2 }).run(image(1));
    expect(result.phase).toBe('done');
    expect(writes).toBe(2);
  });

  it('fails after the retry budget is exhausted', async () => {
    const link = new FakeLink();
    link.autoAck = (s, n) => {
      if (n === 1) s.onMessage(ackMessage(HOST, ERASE_ACK));
    };
    const result = await session(link, { maxRetries: 1 }).run(image(1));
    expect(result.phase).toBe('failed');
    expect(result.message).toMatch(/failed after 2 attempts/);
  });

  it('aborts when the card reports a checksum error', async () => {
    const link = new FakeLink();
    link.autoAck = (s) => s.onMessage(ackMessage(HOST, ERROR_CHK));
    const result = await session(link).run(image(1));
    expect(result.phase).toBe('failed');
    expect(result.message).toMatch(/checksum error/);
  });

  it('reports a malformed image instead of failing silently', async () => {
    const link = new FakeLink();
    const result = await session(link).run(':00000001FF\n:GARBAGE');
    expect(result.phase).toBe('failed');
    expect(result.message).toMatch(/content after end-of-file record/);
    // The card was never put into programming mode.
    expect(link.sent).toHaveLength(0);
  });

  it('can be cancelled mid-programming', async () => {
    const link = new FakeLink();
    const s = session(link, { writeTimeoutMs: 5_000 });
    link.autoAck = (sess, n) => {
      if (n === 1) sess.onMessage(ackMessage(HOST, ERASE_ACK));
      else s.cancel();
    };
    const result = await s.run(image(40));
    expect(result.phase).toBe('cancelled');
  });

  it('ignores traffic from other cards', async () => {
    const link = new FakeLink();
    link.autoAck = (s) => s.onMessage(ackMessage('10.0.0.99', ERASE_ACK));
    const result = await session(link).run(image(1));
    expect(result.phase).toBe('failed');
    expect(result.message).toMatch(/Timed out/);
  });
});
