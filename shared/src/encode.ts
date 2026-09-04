import { Words, header } from './words.js';
import type { Params, ParamAccess, ParamSpec, RegisterDef } from './types.js';

/** Command code for a register write. Word 1 low byte. */
export const CMD_CONFIG = 0x02;

/**
 * Wrap a raw parameter bag in typed accessors, filling in declared defaults.
 * Shared by register encoding and by configuration-action planning.
 */
export function makeAccess(p: Params, specs: readonly ParamSpec[], label: string): ParamAccess {
  const get = (name: string): unknown => {
    if (name in p) return p[name];
    const spec = specs.find((s) => s.name === name);
    if (spec && 'default' in spec && spec.default !== undefined) return spec.default;
    if (spec?.kind === 'mask') return new Array<boolean>(spec.count).fill(false);
    if (spec?.kind === 'bool') return false;
    if (spec?.kind === 'coefArray') return [0, 0];
    if (spec) return 0;
    throw new Error(`${label}: unknown parameter "${name}"`);
  };
  return {
    int: (n) => Math.trunc(Number(get(n))) || 0,
    bool: (n) => Boolean(get(n)),
    mask: (n) => get(n) as boolean[],
    arr: (n) => get(n) as number[],
  };
}

export interface EncodedCommand {
  id: string;
  bytes: Buffer;
  hexWords: string[];
  /** Word count declared in the header, i.e. total words minus two. */
  nw: number;
  regAddr?: number;
}

/**
 * Encode one register write.
 *
 * Layout, identical for every command in the original Java:
 *   word 0  sequence counter
 *   word 1  (nw << 8) | cmd_code      where nw = totalWords - 2
 *   word 2  register address          (only when the register has one)
 *   word 3+ payload
 *
 * `nw` is derived rather than hard-coded; `registers.test.ts` asserts the derived
 * value equals the literal that each original Java class shipped.
 */
export function encode(def: RegisterDef, params: Params, seqCnt: number): EncodedCommand {
  const a = makeAccess(params, def.params, def.id);

  const payload = new Words();
  def.payload(a, payload);

  let regAddr = def.regAddr;
  if (def.channelRange) {
    const ch = a.int(def.channelRange.param);
    if (ch < 0 || ch >= def.channelRange.count) {
      throw new Error(
        `${def.id}: channel ${ch} out of range 0..${def.channelRange.count - 1}`,
      );
    }
    regAddr = def.channelRange.base + ch;
  }

  const hasReg = regAddr !== undefined;
  const total = 2 + (hasReg ? 1 : 0) + payload.length;
  const nw = total - 2;

  const out = new Words();
  out.push(seqCnt, header(nw, def.cmdCode));
  if (hasReg) out.push(regAddr!);
  out.concat(payload);

  return { id: def.id, bytes: out.toBuffer(), hexWords: out.toHexWords(), nw, regAddr };
}
