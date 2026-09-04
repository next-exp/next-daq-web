/**
 * Primitives for the NEXT DAQ register protocol.
 *
 * Every command on the wire is a sequence of 16-bit words, big-endian, sent as a
 * single UDP datagram. The original Java built these by hand in each of ~50
 * command classes:
 *
 *     palabra3_B[0] = (byte)((palabra3 << 16) >> 24);   // high byte
 *     palabra3_B[1] = (byte)((palabra3 << 24) >> 24);   // low byte
 *
 * which is just a big-endian 16-bit store. That is `Words.push` here.
 */

export const WORD_MASK = 0xffff;

/** Accumulates 16-bit words and renders them as a big-endian byte buffer. */
export class Words {
  private readonly words: number[] = [];

  /** Append one 16-bit word. Values are truncated to 16 bits, as Java's byte casts did. */
  push(...values: number[]): this {
    for (const v of values) this.words.push(v & WORD_MASK);
    return this;
  }

  /**
   * Append a 32-bit value as two words, high word first.
   * The Java wrote these as a 4-byte `palabra4y5_B` in the same order.
   */
  push32(value: number): this {
    return this.push(Math.floor(value / 0x10000), value);
  }

  get length(): number {
    return this.words.length;
  }

  /** Append every word of another `Words`, preserving order. */
  concat(other: Words): this {
    return this.push(...other.values);
  }

  /** The accumulated words. Copied, so callers cannot mutate the internals. */
  get values(): number[] {
    return [...this.words];
  }

  toBuffer(): Buffer {
    const buf = Buffer.alloc(this.words.length * 2);
    this.words.forEach((w, i) => buf.writeUInt16BE(w, i * 2));
    return buf;
  }

  toHexWords(): string[] {
    return this.words.map((w) => w.toString(16).padStart(4, '0'));
  }
}

/** A boolean rendered as `mask` when set and 0 when clear. */
export const flag = (on: boolean, mask: number): number => (on ? mask : 0);

/**
 * Pack a per-channel selection into one or more 16-bit words.
 *
 * Polarity differs *per register* in the original firmware protocol and is NOT
 * consistent even between registers that mean the same thing:
 *
 *   - 'high': a selected channel SETS its bit  (PMTDaqConfReg1, BFDaqConfReg1,
 *             PMTDaqConfReg16, BFDaqConfReg16, SiPMFEConfReg1)
 *   - 'low':  a selected channel CLEARS its bit, word starts at 0xFFFF
 *             (TrgConfReg1, SiPMDaqConfReg1)
 *
 * In the Java this was ~64 hand-written if/else pairs per register emitting
 * literals like "FFFE"/"FFFF" (low) or "0001"/"0000" (high), then combined with
 * `&` or `|` respectively. Normalising the two conventions would silently invert
 * the card-enable masks on real hardware, so the distinction is preserved here.
 */
export function channelMask(
  selected: readonly boolean[],
  count: number,
  polarity: 'high' | 'low',
): number[] {
  const wordCount = Math.ceil(count / 16);
  const words = new Array<number>(wordCount).fill(polarity === 'low' ? WORD_MASK : 0);
  for (let i = 0; i < count; i++) {
    if (!selected[i]) continue;
    const bit = 1 << (i % 16);
    const w = Math.floor(i / 16);
    if (polarity === 'low') words[w] &= ~bit & WORD_MASK;
    else words[w] |= bit;
  }
  return words;
}

/** Header word 1: word count in the high byte, command code in the low byte. */
export const header = (numWords: number, cmdCode: number): number =>
  ((numWords << 8) | cmdCode) & WORD_MASK;
