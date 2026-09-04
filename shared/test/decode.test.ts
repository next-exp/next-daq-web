import { describe, expect, it } from 'vitest';
import {
  decodeFlashAck,
  decodeGoldenImage,
  decodeStatusFrame,
  EOF_MARKER,
} from '../src/decode.js';

const frame = (...words: number[]): Buffer => {
  const b = Buffer.alloc(words.length * 2);
  words.forEach((w, i) => b.writeUInt16BE(w, i * 2));
  return b;
};

describe('decodeStatusFrame', () => {
  it('decodes a well-formed reply', () => {
    const r = decodeStatusFrame(frame(0x0001, 0x0000, 0x1fff, 0x0002), 8);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.frame.statusAddr).toBe(0x0000);
    expect(r.frame.data).toEqual([0x1fff, 0x0002]);
    expect(r.frame.hasEofMarker).toBe(false);
  });

  it('strips the 0x7c7c trailer from the data words', () => {
    const r = decodeStatusFrame(frame(0x0001, 0x0001, 0x0005, EOF_MARKER), 8);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.frame.hasEofMarker).toBe(true);
    expect(r.frame.data).toEqual([0x0005]);
  });

  /**
   * The original read fields with Arrays.copyOfRange on a reused 1024-byte array
   * without checking the received length, so a truncated reply decoded as valid
   * zero-valued data. These three cases are that bug.
   */
  it('rejects a frame shorter than the header', () => {
    const r = decodeStatusFrame(frame(0x0001), 2);
    expect(r).toMatchObject({ ok: false, error: 'too_short' });
  });

  it('never reads past the reported length, even when the buffer is longer', () => {
    // A 1024-byte buffer whose tail holds stale data from a previous, larger packet.
    const buf = Buffer.alloc(1024, 0xab);
    buf.writeUInt16BE(0x0001, 0);
    buf.writeUInt16BE(0x0000, 2);
    const r = decodeStatusFrame(buf, 4);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Only the four bytes actually received are decoded; 0xabab must not appear.
    expect(r.frame.data).toEqual([]);
    expect(r.frame.length).toBe(4);
  });

  it('rejects an odd byte count', () => {
    expect(decodeStatusFrame(Buffer.alloc(8), 5)).toMatchObject({ ok: false, error: 'odd_length' });
  });

  it('rejects an oversized frame', () => {
    expect(decodeStatusFrame(Buffer.alloc(2048), 2048)).toMatchObject({
      ok: false,
      error: 'too_long',
    });
  });
});

describe('flash acknowledgement bits', () => {
  /**
   * The Java compared Integer.toHexString(Reg & 0x0005) to "4" or "5", which is
   * just "bit 2 set" — these cases pin that reading.
   */
  it.each([
    [0x0000, { errorChk: false, eraseAck: false, writeAck: false }],
    [0x0001, { errorChk: true, eraseAck: false, writeAck: false }],
    [0x0004, { errorChk: false, eraseAck: true, writeAck: false }],
    [0x0005, { errorChk: true, eraseAck: true, writeAck: false }],
    [0x0008, { errorChk: false, eraseAck: false, writeAck: true }],
    [0x0009, { errorChk: true, eraseAck: false, writeAck: true }],
  ])('decodes register value 0x%s', (reg, expected) => {
    expect(decodeFlashAck(reg as number)).toEqual(expected);
  });

  it('reads the golden-image flag from status register 0', () => {
    expect(decodeGoldenImage(0x0002)).toBe(true);
    expect(decodeGoldenImage(0x0003)).toBe(true);
    expect(decodeGoldenImage(0x0001)).toBe(false);
  });
});
