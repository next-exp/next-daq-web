import { describe, expect, it } from 'vitest';
import { McsParseError, parseMcs, parseRecord, toPages } from '../src/mcs.js';

/** Build a valid Intel HEX record with a correct checksum. */
function rec(type: number, address: number, data: number[]): string {
  const bytes = [data.length, (address >> 8) & 0xff, address & 0xff, type, ...data];
  const sum = bytes.reduce((a, b) => a + b, 0);
  bytes.push((-sum) & 0xff);
  return ':' + bytes.map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join('');
}

const EOF_REC = rec(0x01, 0, []);

describe('parseRecord', () => {
  it('parses a data record', () => {
    const r = parseRecord(rec(0x00, 0x1234, [0xde, 0xad]), 1);
    expect(r).toMatchObject({ type: 0, address: 0x1234 });
    expect(r.data).toEqual(Buffer.from([0xde, 0xad]));
  });

  /** The original caught parse failures with an empty block, so bad images went unreported. */
  it('rejects a bad checksum', () => {
    // Take a valid record and corrupt only its final checksum byte.
    const good = rec(0x00, 0x0000, [0xde, 0xad]);
    const bad = good.slice(0, -2) + (good.endsWith('00') ? 'FF' : '00');
    expect(() => parseRecord(bad, 7)).toThrow(McsParseError);
    expect(() => parseRecord(bad, 7)).toThrow(/line 7: checksum mismatch/);
  });

  it('rejects a missing start code', () => {
    expect(() => parseRecord('00000001FF', 2)).toThrow(/does not start with ":"/);
  });

  it('rejects a length that disagrees with the record', () => {
    expect(() => parseRecord(':10000000DEADBEEF00', 3)).toThrow(/declared 16 data bytes/);
  });

  it('rejects non-hex characters', () => {
    expect(() => parseRecord(':0000000ZZZ', 4)).toThrow(/non-hexadecimal/);
  });
});

describe('parseMcs', () => {
  it('merges contiguous data records into one block', () => {
    const img = parseMcs(
      [rec(0, 0x0000, [1, 2, 3, 4]), rec(0, 0x0004, [5, 6, 7, 8]), EOF_REC].join('\n'),
    );
    expect(img.blocks).toHaveLength(1);
    expect(img.blocks[0].data).toEqual(Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]));
    expect(img.totalBytes).toBe(8);
  });

  it('starts a new block on an address gap', () => {
    const img = parseMcs([rec(0, 0x0000, [1, 2]), rec(0, 0x0100, [3, 4]), EOF_REC].join('\n'));
    expect(img.blocks.map((b) => b.address)).toEqual([0x0000, 0x0100]);
  });

  it('applies the extended linear address to following records', () => {
    const img = parseMcs(
      [rec(0x04, 0, [0x00, 0x01]), rec(0, 0x0000, [0xaa]), EOF_REC].join('\n'),
    );
    expect(img.blocks[0].address).toBe(0x0001_0000);
  });

  it('requires an end-of-file record', () => {
    expect(() => parseMcs(rec(0, 0, [1]))).toThrow(/no end-of-file record/);
  });

  it('rejects content after the end-of-file record', () => {
    expect(() => parseMcs([EOF_REC, rec(0, 0, [1])].join('\n'))).toThrow(/content after/);
  });

  it('reports the failing line number', () => {
    const text = [rec(0, 0, [1]), ':00', EOF_REC].join('\n');
    expect(() => parseMcs(text)).toThrow(/line 2/);
  });

  it('ignores blank lines', () => {
    expect(() => parseMcs(['', rec(0, 0, [1]), '  ', EOF_REC, ''].join('\n'))).not.toThrow();
  });
});

describe('toPages', () => {
  it('pads the final page with the erased-flash value', () => {
    const img = parseMcs([rec(0, 0, [1, 2, 3]), EOF_REC].join('\n'));
    const pages = toPages(img, 4);
    expect(pages).toHaveLength(1);
    expect(pages[0].data).toEqual(Buffer.from([1, 2, 3, 0xff]));
  });

  it('splits a block across pages with correct addresses', () => {
    const img = parseMcs([rec(0, 0x10, [1, 2, 3, 4, 5]), EOF_REC].join('\n'));
    const pages = toPages(img, 2);
    expect(pages.map((p) => p.address)).toEqual([0x10, 0x12, 0x14]);
    expect(pages[2].data).toEqual(Buffer.from([5, 0xff]));
  });
});
