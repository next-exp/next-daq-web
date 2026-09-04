/**
 * Decoder for datagrams coming back from the cards.
 *
 * The original receive path took a reused 1024-byte array and pulled fields out
 * with `Arrays.copyOfRange(packetData, 18, 20)` without ever checking the
 * received length. Because the backing array is reused and zero-padded, a
 * truncated reply silently decoded as valid zero-valued fields. Everything here
 * therefore works from `(data, length)` and rejects frames that do not fit.
 */

/** Trailer word the cards append to status replies. */
export const EOF_MARKER = 0x7c7c;

/** Minimum viable frame: header word plus status-address word. */
export const MIN_FRAME_BYTES = 4;

export type DecodeError =
  | 'too_short'
  | 'odd_length'
  | 'too_long'
  | 'unknown_source';

export interface StatusFrame {
  /** Word 0 as received. */
  header: number;
  /** Word 1 — the status register address the reply refers to. */
  statusAddr: number;
  /** Words 2..n. */
  data: number[];
  /** True when the frame ends with the 0x7c7c trailer. */
  hasEofMarker: boolean;
  /** Raw byte length actually received. */
  length: number;
}

export type DecodeResult =
  | { ok: true; frame: StatusFrame }
  | { ok: false; error: DecodeError; detail: string };

export const MAX_FRAME_BYTES = 1024;

/**
 * Decode exactly `length` bytes of `data`. Never reads past `length`, so a short
 * datagram cannot pick up stale bytes from a reused receive buffer.
 */
export function decodeStatusFrame(data: Buffer, length: number): DecodeResult {
  if (length < MIN_FRAME_BYTES) {
    return { ok: false, error: 'too_short', detail: `${length} bytes < ${MIN_FRAME_BYTES}` };
  }
  if (length > MAX_FRAME_BYTES) {
    return { ok: false, error: 'too_long', detail: `${length} bytes > ${MAX_FRAME_BYTES}` };
  }
  if (length % 2 !== 0) {
    return { ok: false, error: 'odd_length', detail: `${length} bytes is not a whole number of words` };
  }

  const words: number[] = [];
  for (let i = 0; i < length; i += 2) words.push(data.readUInt16BE(i));

  const last = words[words.length - 1];
  const hasEofMarker = last === EOF_MARKER;

  return {
    ok: true,
    frame: {
      header: words[0],
      statusAddr: words[1],
      data: words.slice(2, hasEofMarker ? words.length - 1 : words.length),
      hasEofMarker,
      length,
    },
  };
}

/** Flash-programming acknowledgement bits carried in status register 1. */
export interface FlashAck {
  errorChk: boolean;
  eraseAck: boolean;
  writeAck: boolean;
}

/**
 * Interpret status register 1 for the flash programmer.
 *
 * The Java compared `Integer.toHexString(Reg & 0x0005)` against "4" or "5",
 * which is simply "bit 2 is set" — the mask's low bit never affects the answer.
 * Written directly as bit tests here.
 */
export function decodeFlashAck(reg: number): FlashAck {
  return {
    errorChk: (reg & 0x0001) !== 0,
    eraseAck: (reg & 0x0004) !== 0,
    writeAck: (reg & 0x0008) !== 0,
  };
}

/** Status register 0 reports whether the card booted the golden image. */
export const decodeGoldenImage = (reg: number): boolean => (reg & 0x0002) !== 0;
