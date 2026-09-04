/**
 * Intel HEX (.mcs) parsing for FPGA flash programming.
 *
 * The original parsed these files with hand-unrolled `substring` calls — a
 * separate `case "01".."0F"` arm for every possible record length, each padding
 * the remainder with 0xFFFF — and caught `IOException | NumberFormatException`
 * with an empty body, so a malformed image produced no operator-visible failure.
 * Here a record is parsed once, checksum-verified, and errors are typed.
 */

export const RECORD_DATA = 0x00;
export const RECORD_EOF = 0x01;
export const RECORD_EXT_SEGMENT = 0x02;
export const RECORD_EXT_LINEAR = 0x04;

/** Unwritten flash reads as 1s, so short records are padded with 0xFF. */
export const FLASH_ERASED_BYTE = 0xff;

export class McsParseError extends Error {
  constructor(
    message: string,
    readonly line: number,
  ) {
    super(`line ${line}: ${message}`);
    this.name = 'McsParseError';
  }
}

export interface McsRecord {
  type: number;
  address: number;
  data: Buffer;
  /** Checksum byte as it appeared in the file; the flash frame retransmits it. */
  checksum: number;
}

/** Parse one Intel HEX record, verifying its checksum. */
export function parseRecord(text: string, lineNo: number): McsRecord {
  if (!text.startsWith(':')) throw new McsParseError('record does not start with ":"', lineNo);
  const body = text.slice(1).trim();
  if (body.length % 2 !== 0) throw new McsParseError('odd number of hex digits', lineNo);
  if (!/^[0-9a-fA-F]*$/.test(body)) throw new McsParseError('non-hexadecimal character', lineNo);

  const bytes = Buffer.from(body, 'hex');
  if (bytes.length < 5) throw new McsParseError(`record too short (${bytes.length} bytes)`, lineNo);

  const count = bytes[0];
  if (bytes.length !== count + 5) {
    throw new McsParseError(
      `declared ${count} data bytes but record holds ${bytes.length - 5}`,
      lineNo,
    );
  }

  // Intel HEX checksum: the two's complement of the sum of all preceding bytes.
  const sum = bytes.subarray(0, bytes.length - 1).reduce((a, b) => a + b, 0);
  const expected = (-sum) & 0xff;
  const actual = bytes[bytes.length - 1];
  if (expected !== actual) {
    throw new McsParseError(
      `checksum mismatch: expected ${expected.toString(16).padStart(2, '0')}, got ${actual
        .toString(16)
        .padStart(2, '0')}`,
      lineNo,
    );
  }

  return {
    type: bytes[3],
    address: (bytes[1] << 8) | bytes[2],
    data: bytes.subarray(4, 4 + count),
    checksum: actual,
  };
}

export interface McsImage {
  /** Flat blocks of contiguous flash content, in file order. */
  blocks: { address: number; data: Buffer }[];
  totalBytes: number;
  recordCount: number;
}

/**
 * A block under construction. Chunks are accumulated and joined once at the end:
 * concatenating on every record would be quadratic, and real images run to
 * several hundred thousand records.
 */
interface PendingBlock {
  address: number;
  chunks: Buffer[];
  length: number;
}

/**
 * Parse a complete .mcs image.
 *
 * Extended-linear-address records (type 04) set the upper 16 bits of the address,
 * which the original tracked as a separate `Prog_addh` string.
 */
export function parseMcs(text: string): McsImage {
  const pending: PendingBlock[] = [];
  let upper = 0;
  let totalBytes = 0;
  let recordCount = 0;
  let sawEof = false;

  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === '') continue;
    if (sawEof) throw new McsParseError('content after end-of-file record', i + 1);

    const rec = parseRecord(line, i + 1);
    recordCount++;

    switch (rec.type) {
      case RECORD_DATA: {
        const address = upper * 0x10000 + rec.address;
        const prev = pending[pending.length - 1];
        // Merge with the previous block when the data is contiguous.
        if (prev && prev.address + prev.length === address) {
          prev.chunks.push(rec.data);
          prev.length += rec.data.length;
        } else {
          pending.push({ address, chunks: [rec.data], length: rec.data.length });
        }
        totalBytes += rec.data.length;
        break;
      }
      case RECORD_EOF:
        sawEof = true;
        break;
      case RECORD_EXT_LINEAR:
        if (rec.data.length !== 2) {
          throw new McsParseError('extended linear address record must hold 2 bytes', i + 1);
        }
        upper = (rec.data[0] << 8) | rec.data[1];
        break;
      case RECORD_EXT_SEGMENT:
        if (rec.data.length !== 2) {
          throw new McsParseError('extended segment address record must hold 2 bytes', i + 1);
        }
        upper = ((rec.data[0] << 8) | rec.data[1]) >> 12;
        break;
      default:
        throw new McsParseError(`unsupported record type 0x${rec.type.toString(16)}`, i + 1);
    }
  }

  if (!sawEof) throw new McsParseError('image has no end-of-file record', lines.length);
  const blocks = pending.map((b) => ({ address: b.address, data: Buffer.concat(b.chunks, b.length) }));
  return { blocks, totalBytes, recordCount };
}

/**
 * Split an image into fixed-size pages for transmission, padding the final page
 * with the erased-flash value.
 */
export function toPages(image: McsImage, pageBytes: number): { address: number; data: Buffer }[] {
  const pages: { address: number; data: Buffer }[] = [];
  for (const block of image.blocks) {
    for (let off = 0; off < block.data.length; off += pageBytes) {
      const chunk = block.data.subarray(off, off + pageBytes);
      const page = Buffer.alloc(pageBytes, FLASH_ERASED_BYTE);
      chunk.copy(page);
      pages.push({ address: block.address + off, data: page });
    }
  }
  return pages;
}


/** A data record together with the absolute address it targets. */
export interface McsDataRecord {
  address: number;
  data: Buffer;
  checksum: number;
}

/**
 * Parse an image into its individual data records, preserving each record's
 * address and checksum.
 *
 * `parseMcs` merges records into contiguous blocks, which is what a verifier
 * wants; the flash writer instead transmits one 9-word group per original record
 * and echoes that record's checksum, so it needs the records intact.
 */
export function parseMcsRecords(text: string): McsDataRecord[] {
  const out: McsDataRecord[] = [];
  let upper = 0;
  let sawEof = false;
  const lines = text.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === '') continue;
    if (sawEof) throw new McsParseError('content after end-of-file record', i + 1);
    const rec = parseRecord(line, i + 1);
    switch (rec.type) {
      case RECORD_DATA:
        out.push({
          address: upper * 0x10000 + rec.address,
          data: Buffer.from(rec.data),
          checksum: rec.checksum,
        });
        break;
      case RECORD_EOF:
        sawEof = true;
        break;
      case RECORD_EXT_LINEAR:
        upper = (rec.data[0] << 8) | rec.data[1];
        break;
      case RECORD_EXT_SEGMENT:
        upper = ((rec.data[0] << 8) | rec.data[1]) >> 12;
        break;
      default:
        throw new McsParseError(`unsupported record type 0x${rec.type.toString(16)}`, i + 1);
    }
  }
  if (!sawEof) throw new McsParseError('image has no end-of-file record', lines.length);
  return out;
}
